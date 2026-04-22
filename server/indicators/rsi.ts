/**
 * Single source of truth for RSI.
 *
 * This is the ONLY place RSI is computed in the entire codebase.
 * Do not inline RSI in scanner, verdict, watchlist, or anywhere else.
 *
 * Standard: Wilder's RSI with configurable period (default 14).
 */
import type { OHLCV } from "../data/types";

export interface RSIOptions {
  period?: number; // default 14
}

export function computeRSI(bars: OHLCV[], opts: RSIOptions = {}): number | null {
  const period = opts.period ?? 14;
  if (bars.length < period + 1) return null;

  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const delta = bars[i].c - bars[i - 1].c;
    if (delta >= 0) gains += delta;
    else losses -= delta;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < bars.length; i++) {
    const delta = bars[i].c - bars[i - 1].c;
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? -delta : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}
