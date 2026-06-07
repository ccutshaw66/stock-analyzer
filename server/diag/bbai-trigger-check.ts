/**
 * One-off diagnostic: dump BBTC + VER triggers for a ticker (default BBAI)
 * with forward returns, to settle whether entries are inverted vs. just
 * whipsawing. Mirrors the EXACT indicator computation in the
 * /api/trade-analysis route (routes.ts ~3240-3283) and runs the real
 * computeBBTC / computeVER. Run: npx tsx server/diag/bbai-trigger-check.ts [TICKER]
 */
import "dotenv/config";
import { fmpGet } from "../data/providers/fmp.client";
import { computeBBTC } from "../signals/strategies/bbtc";
import { computeVER } from "../signals/strategies/ver";

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
function computeSMA(data: number[], period: number): number[] {
  const out = new Array(data.length).fill(NaN);
  for (let i = period - 1; i < data.length; i++) {
    let s = 0;
    for (let j = i - period + 1; j <= i; j++) s += data[j];
    out[i] = s / period;
  }
  return out;
}
function computeATR(highs: number[], lows: number[], closes: number[], period: number): number[] {
  const tr = new Array(closes.length).fill(NaN);
  for (let i = 1; i < closes.length; i++) {
    tr[i] = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
  }
  const atr = new Array(closes.length).fill(NaN);
  if (closes.length <= period) return atr;
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += tr[i];
  atr[period] = sum / period;
  for (let i = period + 1; i < closes.length; i++) atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
  return atr;
}
function computeRSI(closes: number[], period: number): number[] {
  const rsi = new Array(closes.length).fill(NaN);
  if (closes.length <= period) return rsi;
  let gainSum = 0, lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const ch = closes[i] - closes[i - 1];
    if (ch > 0) gainSum += ch; else lossSum -= ch;
  }
  let avgGain = gainSum / period, avgLoss = lossSum / period;
  rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1];
    const g = ch > 0 ? ch : 0, l = ch < 0 ? -ch : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return rsi;
}

const fmt = (x: number) => (isNaN(x) ? " n/a" : (x >= 0 ? "+" : "") + x.toFixed(1) + "%");
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);

async function analyzeTicker(ticker: string, allBuyRsi: number[], allBuyFwd: number[]) {
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 700 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const raw: any = await fmpGet(`/historical-price-eod/full`, { symbol: ticker, from, to });
  const rows: any[] = Array.isArray(raw) ? raw : (raw?.historical || []);
  if (!rows.length) { console.log(`${ticker}: no data`); return; }
  const asc = [...rows].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const dates = asc.map(r => String(r.date));
  const closes = asc.map(r => Number(r.close));
  const highs = asc.map(r => Number(r.high));
  const lows = asc.map(r => Number(r.low));
  const volumes = asc.map(r => Number(r.volume));

  const ema9 = computeEMA(closes, 9), ema21 = computeEMA(closes, 21), ema50 = computeEMA(closes, 50);
  const atr14 = computeATR(highs, lows, closes, 14);
  const rsi14 = computeRSI(closes, 14);
  const bbSma = computeSMA(closes, 20);
  const bbUpper = new Array(closes.length).fill(NaN), bbLower = new Array(closes.length).fill(NaN);
  for (let i = 19; i < closes.length; i++) {
    let s = 0; for (let j = i - 19; j <= i; j++) s += (closes[j] - bbSma[i]) ** 2;
    const sd = Math.sqrt(s / 20); bbUpper[i] = bbSma[i] + 2 * sd; bbLower[i] = bbSma[i] - 2 * sd;
  }
  const volAvg20 = new Array(closes.length).fill(NaN);
  for (let i = 19; i < closes.length; i++) { let s = 0; for (let j = i - 19; j <= i; j++) s += volumes[j] || 0; volAvg20[i] = s / 20; }

  const bbtc = computeBBTC({ closes, highs, lows, ema9, ema21, ema50, atr14, rsi14 });
  const fwd = (i: number, n: number) => (i + n < closes.length ? (closes[i + n] - closes[i]) / closes[i] * 100 : NaN);

  const buyRsi: number[] = [], buyFwd: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (bbtc.signals[i] === "BUY" && bbtc.signalSides[i] === "LONG") {
      const f10 = fwd(i, 10);
      if (!isNaN(rsi14[i])) { buyRsi.push(rsi14[i]); allBuyRsi.push(rsi14[i]); }
      if (!isNaN(f10)) { buyFwd.push(f10); allBuyFwd.push(f10); }
    }
  }
  const overbought = buyRsi.filter(r => r >= 65).length;
  console.log(`${ticker.padEnd(6)} ${dates[0]}→${dates[dates.length-1]}  BUYs=${String(buyRsi.length).padStart(2)}  avg entry RSI=${avg(buyRsi).toFixed(0)}  RSI>=65 entries=${overbought}/${buyRsi.length}  avg fwd+10d=${fmt(avg(buyFwd))}`);
}

async function main() {
  const tickers = (process.argv.slice(2).length ? process.argv.slice(2) : ["BBAI", "SOUN", "RGTI", "IONQ", "LAZR", "CHPT"]).map(t => t.toUpperCase());
  const allBuyRsi: number[] = [], allBuyFwd: number[] = [];
  console.log(`BBTC long-entry quality across ${tickers.length} volatile low-price names:\n`);
  for (const t of tickers) { try { await analyzeTicker(t, allBuyRsi, allBuyFwd); } catch (e: any) { console.log(`${t}: ${e.message}`); } }
  const ob = allBuyRsi.filter(r => r >= 65).length;
  console.log(`\n=== AGGREGATE across all BUYs (the "over and over" test) ===`);
  console.log(`Total BUY entries: ${allBuyRsi.length}`);
  console.log(`Average entry RSI: ${avg(allBuyRsi).toFixed(1)}   (a sound trend entry should sit ~45-60, NOT overbought)`);
  console.log(`Entries at RSI >= 65 (overbought): ${ob}/${allBuyRsi.length} = ${(ob / allBuyRsi.length * 100).toFixed(0)}%`);
  console.log(`Average forward +10d return after BUY: ${fmt(avg(allBuyFwd))}   (should be clearly POSITIVE if entries are good)`);
}
main().catch(e => { console.error(e); process.exit(1); });
