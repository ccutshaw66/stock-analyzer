/**
 * Fib-retracement pullback classifier, matching the tweaks-thread spec:
 *   0 - 38.2%    shallow
 *   38.2 - 61.8% healthy
 *   61.8 - 78.6% deep
 *   > 78.6%      failed / GATES CLOSED
 */
import type { OHLCV } from "../data/types";

export type PullbackState = "shallow" | "healthy" | "deep" | "failed";

export interface PullbackResult {
  state: PullbackState;
  retracementPct: number;
  impulseLow: number;
  impulseHigh: number;
  currentPrice: number;
}

export function classifyPullback(bars: OHLCV[], impulseLookback = 60): PullbackResult | null {
  if (bars.length < impulseLookback) return null;
  const window = bars.slice(-impulseLookback);
  const low = Math.min(...window.map((b) => b.l));
  const high = Math.max(...window.map((b) => b.h));
  const current = bars[bars.length - 1].c;

  const impulse = high - low;
  if (impulse <= 0) return null;

  const retracePct = (high - current) / impulse;

  let state: PullbackState;
  if (retracePct <= 0.382) state = "shallow";
  else if (retracePct <= 0.618) state = "healthy";
  else if (retracePct <= 0.786) state = "deep";
  else state = "failed";

  return {
    state,
    retracementPct: retracePct,
    impulseLow: low,
    impulseHigh: high,
    currentPrice: current,
  };
}
