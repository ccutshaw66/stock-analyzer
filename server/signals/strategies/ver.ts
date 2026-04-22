/**
 * VER — Volume Exhaustion Reversal strategy (single source of truth).
 *
 * Entry:
 *   BUY  — bullish RSI divergence (price lower low, RSI higher low, RSI < 40)
 *          + volume ≥ 2× 20-bar avg + touched lower Bollinger (20,2) band
 *          + closed back inside (above lower band)
 *   SELL — bearish RSI divergence (price higher high, RSI lower high, RSI > 60)
 *          + volume ≥ 2× 20-bar avg + touched upper Bollinger band
 *          + closed back inside (below upper band)
 *
 * This is the ONLY place VER is computed. Trade Analysis and Scanner
 * call into here. Do NOT inline VER in routes.ts or pages.
 *
 * History: VER was duplicated across two routes with subtle variable-name
 * drift (bbUpper vs bbUpperS, volAvg20 vs volAvg20S). Extracted in PR #18
 * (Phase 1.10).
 */

export type VERSignal = "BUY" | "SELL" | null;
export type VERTopSignal = "HOLD" | "ENTER" | "SELL";

export interface VERInput {
  closes: number[];
  highs: number[];
  lows: number[];
  volumes: number[];
  rsi14: number[];
  bbUpper: number[];
  bbLower: number[];
  volAvg20: number[];
}

export interface VERResult {
  /** Per-bar signals, same length as closes. null where no event. */
  signals: VERSignal[];
  /** Most recent non-null signal, or null if none. */
  lastSignal: VERSignal;
  /** UI-level summary of lastSignal: ENTER on BUY, SELL on SELL, HOLD otherwise. */
  topSignal: VERTopSignal;
}

/**
 * Compute the full VER signal series.
 *
 * Assumes inputs are aligned (same length) and indicator arrays have NaN for
 * warmup bars. The loop skips bars where any required indicator is NaN.
 */
export function computeVER(input: VERInput): VERResult {
  const { closes, highs, lows, volumes, rsi14, bbUpper, bbLower, volAvg20 } = input;
  const signals: VERSignal[] = new Array(closes.length).fill(null);

  for (let i = 2; i < closes.length; i++) {
    if (
      isNaN(rsi14[i]) ||
      isNaN(rsi14[i - 1]) ||
      isNaN(bbUpper[i]) ||
      isNaN(bbLower[i]) ||
      isNaN(volAvg20[i])
    ) continue;

    const volumeSpike = (volumes[i] || 0) >= volAvg20[i] * 2;

    // Bullish Reversal
    if (i >= 5) {
      let hasBullishDiv = false;
      for (let lookback = 5; lookback <= Math.min(20, i); lookback++) {
        const prevIdx = i - lookback;
        if (prevIdx < 0 || isNaN(rsi14[prevIdx])) continue;
        if (closes[i] < closes[prevIdx] && rsi14[i] > rsi14[prevIdx] && rsi14[i] < 40) {
          hasBullishDiv = true;
          break;
        }
      }

      const touchedLowerBB = lows[i] <= bbLower[i] || closes[i - 1] <= bbLower[i - 1];
      const closedBackInside = closes[i] > bbLower[i];

      if (hasBullishDiv && volumeSpike && touchedLowerBB && closedBackInside) {
        signals[i] = "BUY";
      }
    }

    // Bearish Reversal
    if (i >= 5) {
      let hasBearishDiv = false;
      for (let lookback = 5; lookback <= Math.min(20, i); lookback++) {
        const prevIdx = i - lookback;
        if (prevIdx < 0 || isNaN(rsi14[prevIdx])) continue;
        if (closes[i] > closes[prevIdx] && rsi14[i] < rsi14[prevIdx] && rsi14[i] > 60) {
          hasBearishDiv = true;
          break;
        }
      }

      const touchedUpperBB = highs[i] >= bbUpper[i] || closes[i - 1] >= bbUpper[i - 1];
      const closedBackInsideUpper = closes[i] < bbUpper[i];

      if (hasBearishDiv && volumeSpike && touchedUpperBB && closedBackInsideUpper) {
        signals[i] = "SELL";
      }
    }
  }

  // Summarize the most recent event
  let lastSignal: VERSignal = null;
  for (let i = closes.length - 1; i >= 0; i--) {
    if (signals[i]) {
      lastSignal = signals[i];
      break;
    }
  }

  let topSignal: VERTopSignal = "HOLD";
  if (lastSignal === "BUY") topSignal = "ENTER";
  else if (lastSignal === "SELL") topSignal = "SELL";

  return { signals, lastSignal, topSignal };
}
