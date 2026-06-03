/**
 * Client-side oscillator math for CandlePane's MACD/RSI sub-panes.
 *
 * Mirrors the server's `server/diag/chart-data.ts` exactly (Wilder RSI(14),
 * MACD 12/26/9) so a chart whose endpoint already emits `rsi`/`macd*` on its
 * bars (e.g. /api/chart) and a chart that lets CandlePane compute them from
 * closes both render IDENTICAL oscillators. CandlePane uses a bar's own field
 * when present and falls back to this only when it's missing — so adding
 * `subPanes` to any chart is plug-and-play, no data plumbing required.
 */

function computeEMA(data: number[], period: number): number[] {
  const out = new Array(data.length).fill(NaN);
  if (data.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += data[i];
  out[period - 1] = sum / period;
  const k = 2 / (period + 1);
  for (let i = period; i < data.length; i++) out[i] = data[i] * k + out[i - 1] * (1 - k);
  return out;
}

function computeRSI(closes: number[], period: number): number[] {
  const rsi = new Array(closes.length).fill(NaN);
  if (closes.length <= period) return rsi;
  let gainSum = 0, lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const ch = closes[i] - closes[i - 1];
    if (ch > 0) gainSum += ch; else lossSum -= ch;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1];
    const g = ch > 0 ? ch : 0;
    const l = ch < 0 ? -ch : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return rsi;
}

export interface OscillatorSeries {
  rsi: number[];
  macd: number[];
  macdSignal: number[];
  macdHist: number[];
}

/** RSI(14) + MACD(12,26,9) aligned to `closes`. NaN where not yet defined. */
export function computeChartOscillators(closes: number[]): OscillatorSeries {
  const ema12 = computeEMA(closes, 12);
  const ema26 = computeEMA(closes, 26);
  const macd = closes.map((_, i) =>
    !isNaN(ema12[i]) && !isNaN(ema26[i]) ? ema12[i] - ema26[i] : NaN);
  const validMacd: number[] = [];
  const validIdx: number[] = [];
  macd.forEach((v, i) => { if (!isNaN(v)) { validMacd.push(v); validIdx.push(i); } });
  const sigEma = computeEMA(validMacd, 9);
  const macdSignal = new Array(closes.length).fill(NaN);
  validIdx.forEach((idx, j) => { macdSignal[idx] = sigEma[j]; });
  const macdHist = closes.map((_, i) =>
    !isNaN(macd[i]) && !isNaN(macdSignal[i]) ? macd[i] - macdSignal[i] : NaN);
  return { rsi: computeRSI(closes, 14), macd, macdSignal, macdHist };
}
