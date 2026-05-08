/**
 * VER — Volume Exhaustion Reversal strategy (single source of truth).
 *
 * **Long-only as of 2026-05-08** — short side dropped after the strategy-eval
 * diag showed VER_SELL had a 0% +20d win rate (4/4 went the wrong way) and
 * VER_WATCH_SELL decayed from positive at +5d to 39% win at +20d. Shorting
 * overbought conditions in this market regime is a losing strategy.
 *
 * Tiered entries (strict vs watch) + position-aware exit.
 *
 * Entry tiers:
 *   BUY        — bullish RSI divergence + volume ≥ 2× 20-bar avg + lower BB
 *                touch + closed back inside, with RSI < 35 (oversold zone).
 *                Was < 30; relaxed to 35 because strict <30 only fired 4
 *                times in 365 days × 80 tickers — too rare to be useful.
 *   WATCH_BUY  — same conditions but RSI 35-45 (slightly oversold).
 *
 * Exit:
 *   STOP_HIT   — fired only when an active VER long (entered on BUY, NOT
 *                WATCH_BUY) breaches a 2× ATR stop OR a -7% hard stop from
 *                entry.
 *
 * Removed types (existed pre-2026-05-08): SELL, WATCH_SELL.
 *
 * This is the ONLY place VER is computed. Trade Analysis and Scanner call
 * into here. Do NOT inline VER in routes.ts or pages.
 */

export type VERSignal = "BUY" | "WATCH_BUY" | "STOP_HIT" | null;
export type VERTopSignal = "HOLD" | "ENTER" | "WATCH" | "STOPPED";

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

  // Position state — long-only (see header). Entered on a strict BUY.
  // WATCH_BUY does NOT enter position state; it's a visible tag. The exit
  // check fires per-bar while in position:
  //   long busted → price fell to entry × (1 - 7%) OR entry - 2×ATR
  let position: "long" | null = null;
  let entryPrice = 0;

  for (let i = 2; i < n; i++) {
    if (
      isNaN(rsi14[i]) ||
      isNaN(rsi14[i - 1]) ||
      isNaN(bbUpper[i]) ||
      isNaN(bbLower[i]) ||
      isNaN(volAvg20[i])
    ) continue;

    // ─── Position-aware exit check (runs every bar while in a long) ───────
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
    }

    const volumeSpike = (volumes[i] || 0) >= volAvg20[i] * 2;

    // ─── Bullish reversal entry (BUY or WATCH_BUY) ────────────────────────
    if (i >= 5) {
      // Look for a higher-low RSI divergence vs price's lower low. Threshold
      // for the divergence search is < 45 (covers BUY < 35 + WATCH < 45).
      let hasBullishDiv = false;
      for (let lookback = 5; lookback <= Math.min(20, i); lookback++) {
        const prevIdx = i - lookback;
        if (prevIdx < 0 || isNaN(rsi14[prevIdx])) continue;
        if (closes[i] < closes[prevIdx] && rsi14[i] > rsi14[prevIdx] && rsi14[i] < 45) {
          hasBullishDiv = true;
          break;
        }
      }

      const touchedLowerBB = lows[i] <= bbLower[i] || closes[i - 1] <= bbLower[i - 1];
      const closedBackInside = closes[i] > bbLower[i];

      if (hasBullishDiv && volumeSpike && touchedLowerBB && closedBackInside) {
        // RSI tier decides BUY vs WATCH_BUY.
        if (rsi14[i] < 35) {
          signals[i] = "BUY";
          position = "long";
          entryPrice = closes[i];
        } else {
          signals[i] = "WATCH_BUY";
          // Watch doesn't enter position state — it's a visible tag only.
        }
      }
    }
    // Short-side entries (SELL / WATCH_SELL) removed 2026-05-08 — see header.
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
  else if (lastSignal === "WATCH_BUY") topSignal = "WATCH";
  else if (lastSignal === "STOP_HIT") topSignal = "STOPPED";

  return { signals, lastSignal, topSignal };
}
