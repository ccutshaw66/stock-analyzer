/**
 * BBTC — EMA Pyramid Risk strategy (single source of truth).
 *
 * Entry:   EMA9 crosses EMA21 with price on correct side of EMA50
 * Manage:  ATR(14) hard stop at 2×ATR, trailing stop at 1.5×ATR from high,
 *          profit target at 3×ATR, re-entry on additional crosses
 *
 * This is the ONLY place BBTC is computed. Scanner, Trade Analysis,
 * Track Record, and any future caller must import from here.
 *
 * Do NOT inline BBTC in routes.ts or pages. History: BBTC was duplicated
 * across three routes (PR #17, Phase 1.9) with subtle copy-paste drift.
 */

export type BBTCSignal =
  | "BUY"        // open long
  | "SELL"       // open short (or close long)
  | "ADD_LONG"   // pyramid on additional cross while in LONG
  | "REDUCE"     // hit 3×ATR target while in LONG
  | "STOP_HIT"   // stop or trailing-stop hit
  | null;

export type BBTCTopSignal = "HOLD" | "ENTER" | "SELL";
export type BBTCTrend = "UP" | "DOWN" | "SIDEWAYS";
export type BBTCBias = "LONG" | "SHORT" | "FLAT";

export interface BBTCInput {
  closes: number[];
  highs: number[];
  lows: number[];
  ema9: number[];
  ema21: number[];
  ema50: number[];
  atr14: number[];
}

export interface BBTCResult {
  /** Per-bar signals, same length as closes. null where no event. */
  signals: BBTCSignal[];
  /** Most recent non-null signal, or null if none. */
  lastSignal: BBTCSignal;
  /** UI-level summary of lastSignal: ENTER on entries/adds, SELL on exits, HOLD otherwise. */
  topSignal: BBTCTopSignal;
  /** EMA-stack-based trend at the last bar. */
  trend: BBTCTrend;
  /** LONG/SHORT/FLAT bias at the last bar (same logic as trend, different naming). */
  bias: BBTCBias;
  /** Entry price of the most recent position (0 if never entered). Used by callers to compute stop/target prices. */
  entryPrice: number;
  /** Highest high seen since the most recent entry (0 if never entered). Used by callers to compute trailing stop. */
  highestSinceEntry: number;
}

/**
 * Compute the full BBTC signal series.
 *
 * Assumes inputs are already aligned (same length) and indicator arrays have
 * NaN for warmup bars. The internal loop skips bars where any required
 * indicator is NaN.
 */
export function computeBBTC(input: BBTCInput): BBTCResult {
  const { closes, highs, lows, ema9, ema21, ema50, atr14 } = input;
  const signals: BBTCSignal[] = new Array(closes.length).fill(null);

  let inPosition = false;
  let positionSide: "LONG" | "SHORT" | null = null;
  let entryPrice = 0;
  let highestSinceEntry = 0;

  for (let i = 1; i < closes.length; i++) {
    if (isNaN(ema9[i]) || isNaN(ema21[i]) || isNaN(ema50[i]) || isNaN(atr14[i])) continue;

    const crossAbove = ema9[i] > ema21[i] && ema9[i - 1] <= ema21[i - 1];
    const crossBelow = ema9[i] < ema21[i] && ema9[i - 1] >= ema21[i - 1];

    if (!inPosition) {
      if (crossAbove && closes[i] > ema50[i]) {
        signals[i] = "BUY";
        inPosition = true;
        positionSide = "LONG";
        entryPrice = closes[i];
        highestSinceEntry = highs[i];
      } else if (crossBelow && closes[i] < ema50[i]) {
        signals[i] = "SELL";
        inPosition = true;
        positionSide = "SHORT";
        entryPrice = closes[i];
        highestSinceEntry = highs[i];
      }
    } else {
      highestSinceEntry = Math.max(highestSinceEntry, highs[i]);
      if (positionSide === "LONG") {
        const stopLoss = entryPrice - atr14[i] * 2.0;
        const trailStop = highestSinceEntry - atr14[i] * 1.5;
        const target = entryPrice + atr14[i] * 3.0;
        if (lows[i] <= stopLoss || lows[i] <= trailStop) {
          signals[i] = "STOP_HIT";
          inPosition = false;
          positionSide = null;
        } else if (highs[i] >= target) {
          signals[i] = "REDUCE";
        } else if (crossAbove && closes[i] > ema50[i]) {
          signals[i] = "ADD_LONG";
        } else if (crossBelow && closes[i] < ema50[i]) {
          signals[i] = "SELL";
          inPosition = false;
          positionSide = null;
        }
      } else if (positionSide === "SHORT") {
        if (crossAbove && closes[i] > ema50[i]) {
          signals[i] = "BUY";
          inPosition = false;
          positionSide = null;
        } else if (crossBelow && closes[i] < ema50[i]) {
          signals[i] = "ADD_LONG";
        }
      }
    }
  }

  // Summarize the most recent event
  let lastSignal: BBTCSignal = null;
  for (let i = closes.length - 1; i >= 0; i--) {
    if (signals[i]) {
      lastSignal = signals[i];
      break;
    }
  }

  let topSignal: BBTCTopSignal = "HOLD";
  if (lastSignal === "BUY" || lastSignal === "ADD_LONG") topSignal = "ENTER";
  else if (lastSignal === "SELL" || lastSignal === "STOP_HIT" || lastSignal === "REDUCE") topSignal = "SELL";

  const lastIdx = closes.length - 1;
  const stackReady =
    !isNaN(ema9[lastIdx]) && !isNaN(ema21[lastIdx]) && !isNaN(ema50[lastIdx]);

  const trend: BBTCTrend = stackReady
    ? ema9[lastIdx] > ema21[lastIdx] && closes[lastIdx] > ema50[lastIdx]
      ? "UP"
      : ema9[lastIdx] < ema21[lastIdx] && closes[lastIdx] < ema50[lastIdx]
        ? "DOWN"
        : "SIDEWAYS"
    : "SIDEWAYS";

  const bias: BBTCBias = stackReady
    ? ema9[lastIdx] > ema21[lastIdx] && closes[lastIdx] > ema50[lastIdx]
      ? "LONG"
      : ema9[lastIdx] < ema21[lastIdx] && closes[lastIdx] < ema50[lastIdx]
        ? "SHORT"
        : "FLAT"
    : "FLAT";

  return { signals, lastSignal, topSignal, trend, bias, entryPrice, highestSinceEntry };
}
