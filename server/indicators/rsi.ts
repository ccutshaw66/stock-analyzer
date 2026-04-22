/**
 * Single source of truth for RSI.
 *
 * This is the ONLY place RSI is computed in the entire codebase.
 * Do not inline RSI in scanner, verdict, watchlist, track-record, signal-engine,
 * or anywhere else. Import from here.
 *
 * Standard: Wilder's RSI with configurable period (default 14).
 * Matches TradingView / ThinkOrSwim default RSI.
 */
import type { OHLCV } from "../data/types";

export interface RSIOptions {
  period?: number; // default 14
}

/**
 * Core Wilder's RSI series computation over an array of closes.
 * Returns an array of the same length as `closes`, with NaN for indices
 * before the first valid value (i.e. indices < period).
 *
 * This is the primitive that both `computeRSI` and `computeRSISeries` use
 * under the hood so every RSI in the app uses the same math.
 */
function wildersRSISeries(closes: number[], period: number): number[] {
  const rsi: number[] = new Array(closes.length).fill(NaN);
  if (closes.length < period + 1) return rsi;

  // Initial simple average over first `period` deltas
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const delta = closes[i] - closes[i - 1];
    if (delta >= 0) gains += delta;
    else losses -= delta;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  // Wilder smoothing for the rest
  for (let i = period + 1; i < closes.length; i++) {
    const delta = closes[i] - closes[i - 1];
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? -delta : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }

  return rsi;
}

/**
 * Compute the most recent RSI value from an array of OHLCV bars.
 * Returns null if there aren't enough bars.
 *
 * Use this when you just need the latest RSI (e.g. gate checks, single-quote UI).
 */
export function computeRSI(bars: OHLCV[], opts: RSIOptions = {}): number | null {
  const period = opts.period ?? 14;
  if (bars.length < period + 1) return null;
  const closes = bars.map(b => b.c);
  const series = wildersRSISeries(closes, period);
  const last = series[series.length - 1];
  return Number.isFinite(last) ? last : null;
}

/**
 * Compute the full RSI series from an array of closes.
 * Returns an array of the same length, NaN for indices before first valid value.
 *
 * Use this when you need RSI at every bar (e.g. divergence detection,
 * backtests, scanner loops).
 */
export function computeRSISeries(closes: number[], opts: RSIOptions = {}): number[] {
  const period = opts.period ?? 14;
  return wildersRSISeries(closes, period);
}
