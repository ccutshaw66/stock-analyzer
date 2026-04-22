/**
 * AMC — Adaptive Momentum Confluence strategy (single source of truth).
 *
 * AMC scores a bar 0–5 based on:
 *   1. MACD histogram positive AND accelerating
 *   2. RSI in the 45–65 "sweet spot"
 *   3. Trend stack (close > shortEMA > longEMA)
 *   4. VAMI positive and rising
 *   5. Trend strength: |shortEMA − referenceEMA| / close > 0.5 %
 *
 * Entry:
 *   momentum  — score ≥ 4 AND green close
 *   reversion — RSI < 30 AND price near reversion reference AND green close AND VAMI rising
 * Exit:
 *   RSI > 75  OR  MACD histogram flips negative after being ≥ 0 prior bar
 *
 * Callers can tune which EMAs feed conditions 3 + 5 and which reference
 * (SMA200 proximity or lower Bollinger band) feeds the reversion entry,
 * because historically Trade Analysis used EMA9/50 + SMA200 and the dedicated
 * AMC Scanner used EMA20/50 + lower BB.
 *
 * History: AMC was duplicated in Trade Analysis (routes.ts:2362) and the
 * AMC Scanner route (routes.ts:3194) with subtle drift. Extracted in PR #19
 * (Phase 1.11). The two drift-points are preserved via explicit inputs:
 *   - trendShortEma / trendStrengthRefEma
 *   - reversionRefLevel[] (what counts as "near reversion reference")
 */

export type AMCSignal = "ENTER" | "HOLD" | "SELL";
export type AMCMode = "momentum" | "reversion" | "flat";

export interface AMCInput {
  closes: number[];
  /** MACD histogram, same length as closes, NaN where not available. */
  histogram: number[];
  /** RSI(14) or equivalent, same length as closes, NaN where not available. */
  rsi14: number[];
  /**
   * Short-period EMA used in the trend-stack condition (close > EMAshort > EMAlong).
   * Trade Analysis uses EMA9, AMC Scanner uses EMA20.
   */
  trendShortEma: number[];
  /** Long-period EMA used in trend stack AND (by default) trend-strength. Both routes use EMA50. */
  trendLongEma: number[];
  /**
   * Reference EMA for the trend-strength condition — |EMAshort − ref| / close * 100 > 0.5.
   * Trade Analysis uses EMA21 (different from the trend stack), AMC Scanner uses EMA50.
   */
  trendStrengthRefEma: number[];
  /** Pre-scaled VAMI series (commonly multiplied by 8). */
  vamiScaled: number[];
  /**
   * Per-bar reversion reference level. At bar i, reversionEntry requires
   * closes[i] to be "near" reversionRefLevel[i]. Trade Analysis feeds
   * sma200Daily[i] * 0.95 (the 5 % proximity is baked in); AMC Scanner feeds
   * bbLo[i] * 1.01 (1 % proximity). Callers do the scaling and we just
   * evaluate closes[i] ≥ reference for longs (bullish reversion).
   *
   * A NaN at bar i disables the reversion branch for that bar.
   * The direction of the comparison is controlled by `reversionDirection`.
   */
  reversionRefLevel: number[];
  /**
   * How to compare `closes[i]` vs `reversionRefLevel[i]` for the reversion
   * branch:
   *   - "above"  → closes[i] > reversionRefLevel[i]   (Trade Analysis: above SMA200*0.95)
   *   - "below"  → closes[i] <= reversionRefLevel[i]  (AMC Scanner: at or below lower BB*1.01)
   */
  reversionDirection: "above" | "below";
}

export interface AMCResult {
  /** Score in [0,5] at the last bar. */
  score: number;
  /** Current entry/exit signal. */
  signal: AMCSignal;
  /** Which entry fired (if any). */
  mode: AMCMode;
  /** True when closes[last] > closes[last-1]. Many callers need this downstream. */
  greenClose: boolean;
}

/** Evaluate the 5 AMC conditions at bar i; returns 0–5. */
export function scoreAMC(i: number, input: AMCInput): number {
  const { closes, histogram, rsi14, trendShortEma, trendLongEma, trendStrengthRefEma, vamiScaled } = input;
  if (i < 1) return 0;
  let score = 0;
  if (!isNaN(histogram[i]) && histogram[i] > 0 && histogram[i] > (histogram[i - 1] || 0)) score++;
  if (!isNaN(rsi14[i]) && rsi14[i] >= 45 && rsi14[i] <= 65) score++;
  if (
    !isNaN(trendShortEma[i]) &&
    !isNaN(trendLongEma[i]) &&
    closes[i] > trendShortEma[i] &&
    trendShortEma[i] > trendLongEma[i]
  ) score++;
  if (vamiScaled[i] > 0 && vamiScaled[i] > vamiScaled[i - 1]) score++;
  if (
    !isNaN(trendShortEma[i]) &&
    !isNaN(trendStrengthRefEma[i]) &&
    (Math.abs(trendShortEma[i] - trendStrengthRefEma[i]) / closes[i]) * 100 > 0.5
  ) score++;
  return score;
}

/**
 * Compute the current-bar AMC signal.
 * Caller is responsible for feeding the right knobs (see AMCInput).
 */
export function computeAMC(input: AMCInput): AMCResult {
  const { closes, histogram, rsi14, vamiScaled, reversionRefLevel, reversionDirection } = input;
  const li = closes.length - 1;

  if (li < 1) {
    return { score: 0, signal: "HOLD", mode: "flat", greenClose: false };
  }

  const score = scoreAMC(li, input);
  const greenClose = closes[li] > closes[li - 1];

  const momentumEntry = score >= 4 && greenClose;

  let reversionEntry = false;
  if (!isNaN(rsi14[li]) && rsi14[li] < 30 && !isNaN(reversionRefLevel[li]) && greenClose && vamiScaled[li] > vamiScaled[li - 1]) {
    if (reversionDirection === "above") {
      reversionEntry = closes[li] > reversionRefLevel[li];
    } else {
      reversionEntry = closes[li] <= reversionRefLevel[li];
    }
  }

  let signal: AMCSignal = "HOLD";
  let mode: AMCMode = "flat";
  if (momentumEntry) { signal = "ENTER"; mode = "momentum"; }
  else if (reversionEntry) { signal = "ENTER"; mode = "reversion"; }

  // Exit conditions override entries (order matches both original sites)
  if (!isNaN(rsi14[li]) && rsi14[li] > 75) signal = "SELL";
  if (
    !isNaN(histogram[li]) &&
    histogram[li] < 0 &&
    !isNaN(histogram[li - 1]) &&
    histogram[li - 1] >= 0
  ) signal = "SELL";

  return { score, signal, mode, greenClose };
}
