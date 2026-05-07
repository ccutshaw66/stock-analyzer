/**
 * VER — Volume Exhaustion Reversal strategy (single source of truth).
 *
 * Tiered entries (strict vs watch) + position-aware exit.
 *
 * Entry tiers:
 *   BUY        — bullish RSI divergence + volume ≥ 2× 20-bar avg + lower BB
 *                touch + closed back inside, with RSI < 30 (true oversold).
 *   WATCH_BUY  — same conditions but RSI 30-40 (slightly oversold).
 *   SELL       — bearish RSI divergence + volume ≥ 2× 20-bar avg + upper BB
 *                touch + closed back inside, with RSI > 70 (true overbought).
 *   WATCH_SELL — same conditions but RSI 60-70 (slightly overbought).
 *
 * Exit:
 *   STOP_HIT   — fired only when an active VER position (entered on BUY,
 *                NOT WATCH_BUY) breaches a 2× ATR stop OR a -7% hard stop
 *                from entry. Means "this VER buy went wrong; don't keep
 *                showing the green dot as if the trade is still on."
 *
 * This is the ONLY place VER is computed. Trade Analysis and Scanner
 * call into here. Do NOT inline VER in routes.ts or pages.
 */

export type VERSignal = "BUY" | "WATCH_BUY" | "SELL" | "WATCH_SELL" | "STOP_HIT" | null;
export type VERTopSignal = "HOLD" | "ENTER" | "WATCH" | "SELL" | "STOPPED";

export interface VERInput {
  closes: number[];
  highs: number[];
  lows: number[];
  volumes: number[];
  rsi14: number[];
  bbUpper: number[];
  bbLower: number[];
  volAvg20: number[];
  /** ATR(14). Used for the per-bar stop check on active VER positions.
   *  Optional — when absent, falls back to a -7% hard stop only. */
  atr14?: number[];
}

export interface VERResult {
  /** Per-bar signals, same length as closes. null where no event. */
  signals: VERSignal[];
  /** Most recent non-null signal, or null if none. */
  lastSignal: VERSignal;
  /** UI-level summary of lastSignal. */
  topSignal: VERTopSignal;
}

const STOP_PCT = 0.07;       // -7% hard stop from entry
const STOP_ATR_MULT = 2.0;   // 2× ATR stop (when ATR is available)

/**
 * Compute the full VER signal series.
 *
 * Inputs must be aligned (same length) with NaN for warmup bars.
 */
export function computeVER(input: VERInput): VERResult {
  const { closes, highs, lows, volumes, rsi14, bbUpper, bbLower, volAvg20, atr14 } = input;
  const n = closes.length;
  const signals: VERSignal[] = new Array(n).fill(null);

  // Position state — entered on a strict BUY (long) or strict SELL (short).
  // WATCH_BUY / WATCH_SELL do NOT enter position state; they're just visible
  // tags. The exit check fires per-bar while in position and emits a
  // STOP_HIT in either direction:
  //   long busted  → price fell to entry × (1 - 7%)  OR  entry - 2×ATR
  //   short busted → price rose to entry × (1 + 7%)  OR  entry + 2×ATR
  let position: "long" | "short" | null = null;
  let entryPrice = 0;

  for (let i = 2; i < n; i++) {
    if (
      isNaN(rsi14[i]) ||
      isNaN(rsi14[i - 1]) ||
      isNaN(bbUpper[i]) ||
      isNaN(bbLower[i]) ||
      isNaN(volAvg20[i])
    ) continue;

    // ─── Position-aware exit check (runs every bar while in a position) ───
    if (position === "long") {
      const pctStopBreached = closes[i] <= entryPrice * (1 - STOP_PCT);
      const atrStopBreached =
        atr14 && !isNaN(atr14[i])
          ? closes[i] <= entryPrice - STOP_ATR_MULT * atr14[i]
          : false;
      if (pctStopBreached || atrStopBreached) {
        signals[i] = "STOP_HIT";
        position = null;
        entryPrice = 0;
        continue;
      }
    } else if (position === "short") {
      const pctStopBreached = closes[i] >= entryPrice * (1 + STOP_PCT);
      const atrStopBreached =
        atr14 && !isNaN(atr14[i])
          ? closes[i] >= entryPrice + STOP_ATR_MULT * atr14[i]
          : false;
      if (pctStopBreached || atrStopBreached) {
        signals[i] = "STOP_HIT";
        position = null;
        entryPrice = 0;
        continue;
      }
    }

    const volumeSpike = (volumes[i] || 0) >= volAvg20[i] * 2;

    // ─── Bullish reversal entry (BUY or WATCH_BUY) ────────────────────────
    if (i >= 5) {
      // Look for a higher-low RSI divergence vs price's lower low.
      let hasBullishDiv = false;
      for (let lookback = 5; lookback <= Math.min(20, i); lookback++) {
        const prevIdx = i - lookback;
        if (prevIdx < 0 || isNaN(rsi14[prevIdx])) continue;
        // Note: divergence requires RSI[i] > RSI[prevIdx]. RSI threshold
        // applies separately below to bucket strict vs watch.
        if (closes[i] < closes[prevIdx] && rsi14[i] > rsi14[prevIdx] && rsi14[i] < 40) {
          hasBullishDiv = true;
          break;
        }
      }

      const touchedLowerBB = lows[i] <= bbLower[i] || closes[i - 1] <= bbLower[i - 1];
      const closedBackInside = closes[i] > bbLower[i];

      if (hasBullishDiv && volumeSpike && touchedLowerBB && closedBackInside) {
        // RSI tier decides BUY vs WATCH_BUY.
        if (rsi14[i] < 30) {
          signals[i] = "BUY";
          // Strong BUY enters a LONG position (overrides any active short).
          position = "long";
          entryPrice = closes[i];
        } else {
          signals[i] = "WATCH_BUY";
          // WATCH_BUY does NOT enter position state — it's just a watch tag.
        }
      }
    }

    // ─── Bearish reversal entry (SELL or WATCH_SELL) ──────────────────────
    if (i >= 5 && signals[i] === null) {
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
        if (rsi14[i] > 70) {
          signals[i] = "SELL";
          // Strong SELL enters a SHORT position (overrides any active long).
          position = "short";
          entryPrice = closes[i];
        } else {
          signals[i] = "WATCH_SELL";
        }
      }
    }
  }

  // Summarize the most recent event.
  let lastSignal: VERSignal = null;
  for (let i = n - 1; i >= 0; i--) {
    if (signals[i]) {
      lastSignal = signals[i];
      break;
    }
  }

  let topSignal: VERTopSignal = "HOLD";
  if (lastSignal === "BUY") topSignal = "ENTER";
  else if (lastSignal === "SELL") topSignal = "SELL";
  else if (lastSignal === "WATCH_BUY" || lastSignal === "WATCH_SELL") topSignal = "WATCH";
  else if (lastSignal === "STOP_HIT") topSignal = "STOPPED";

  return { signals, lastSignal, topSignal };
}
