/**
 * VER — Volume Exhaustion Reversal strategy (single source of truth).
 *
 * **Tightened thresholds, WATCH_SELL info-only (revised 2026-05-08).**
 *
 * Per the 10-year backtest (3,006 fires across 80 tickers, 2015-2026):
 *   - VER_BUY: 67% win rate at +20d, +2.26% median return — strongest signal in the system
 *   - VER_SELL: 14% win rate at +20d (n=7), -4.53% median return — kept but tightened
 *   - VER_WATCH_SELL: 43% win rate at +20d (n=82), -1.06% median — net loser across all
 *     three tested windows (2y, 5y, 10y). Demoted to info-only; still computed for the
 *     UI tooltip/legend but excluded from "tradeable signal" UX surfaces.
 *
 * Entry tiers (long side):
 *   BUY        — bullish RSI divergence + volume ≥ 2× 20-bar avg + lower BB
 *                touch + closed back inside, with RSI < 35.
 *   WATCH_BUY  — same conditions, RSI 35-45.
 *
 * Entry tiers (short side):
 *   SELL       — bearish RSI divergence + volume ≥ 2× 20-bar avg + upper BB
 *                touch + closed back inside, with RSI > 80 (was 75 — tightened
 *                further so only the most extreme exhaustion fires).
 *   WATCH_SELL — same conditions, RSI 65-80. Info-only; not tradeable.
 *                See `tradeable` flag on the result. Slated for full rebuild
 *                in a follow-up — current rule has been a net loser across
 *                every backtested window.
 *
 * Exit:
 *   STOP_HIT   — fires when an active long (BUY) or short (SELL) busts. Long
 *                stop = -7% or -2× ATR; short stop = +7% or +2× ATR.
 *
 * Note: WATCH_BUY and WATCH_SELL never enter position state — they're
 * informational tags only.
 */

export type VERSignal = "BUY" | "WATCH_BUY" | "SELL" | "WATCH_SELL" | "STOP_HIT" | null;
export type VERTopSignal = "HOLD" | "ENTER" | "WATCH" | "SELL" | "STOPPED";
export type VERSignalSide = "LONG" | "SHORT" | null;

/**
 * Whether a VER signal represents a tradeable action (entry/exit) vs an
 * informational marker. WATCH_SELL is info-only as of the 2026-05-08 rebuild
 * decision — net-loser across all backtested windows, kept for awareness only.
 */
export function isTradeableVERSignal(sig: VERSignal): boolean {
  if (sig === "WATCH_SELL") return false;
  return sig !== null;
}

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
  /** Per-bar side of the trade the signal pertains to. Same length as signals.
   *  "LONG" for BUY/WATCH_BUY/long-stop. "SHORT" for SELL/WATCH_SELL/short-stop.
   *  Null where signals[i] is null. Used by chart rendering to filter
   *  STOP_HIT into the correct long/short view. */
  signalSides: VERSignalSide[];
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
  const signalSides: VERSignalSide[] = new Array(n).fill(null);

  // Position state — long or short. Entered on a strict BUY/SELL.
  // WATCH_BUY/WATCH_SELL never enter position state; they're tags only.
  //   long busted  → price fell to entry × (1 - 7%) OR entry - 2×ATR
  //   short busted → price rose to entry × (1 + 7%) OR entry + 2×ATR
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

    // ─── Position-aware exit check (runs every bar while in a position) ──
    if (position === "long") {
      const pctStopBreached = closes[i] <= entryPrice * (1 - STOP_PCT);
      const atrStopBreached =
        atr14 && !isNaN(atr14[i])
          ? closes[i] <= entryPrice - STOP_ATR_MULT * atr14[i]
          : false;
      if (pctStopBreached || atrStopBreached) {
        signals[i] = "STOP_HIT";
        signalSides[i] = "LONG"; // long stop — show in long view only
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
        signalSides[i] = "SHORT"; // short stop — show in short view only
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
        if (rsi14[i] < 35) {
          signals[i] = "BUY";
          signalSides[i] = "LONG";
          position = "long";
          entryPrice = closes[i];
        } else {
          signals[i] = "WATCH_BUY";
          signalSides[i] = "LONG";
        }
      }
    }

    // ─── Bearish reversal entry (SELL / WATCH_SELL) ───────────────────────
    if (i >= 5 && signals[i] === null) {
      // Look for a lower-high RSI divergence vs price's higher high. Threshold
      // for divergence search is > 55 (covers WATCH_SELL > 65 + SELL > 75).
      let hasBearishDiv = false;
      for (let lookback = 5; lookback <= Math.min(20, i); lookback++) {
        const prevIdx = i - lookback;
        if (prevIdx < 0 || isNaN(rsi14[prevIdx])) continue;
        if (closes[i] > closes[prevIdx] && rsi14[i] < rsi14[prevIdx] && rsi14[i] > 55) {
          hasBearishDiv = true;
          break;
        }
      }

      const touchedUpperBB = highs[i] >= bbUpper[i] || closes[i - 1] >= bbUpper[i - 1];
      const closedBackInsideUpper = closes[i] < bbUpper[i];

      if (hasBearishDiv && volumeSpike && touchedUpperBB && closedBackInsideUpper) {
        if (rsi14[i] > 80) {
          // VER_SELL demoted to info-only on 2026-05-08 alongside BBTC short
          // demote. Per broad-basket eval, short side has no edge in current
          // regime. Signal still emits so users see the bearish exhaustion
          // setup; strategy does NOT enter a short position. Chart renders
          // as hollow magenta dashed dot, marked "not tradeable" in legend.
          signals[i] = "SELL";
          signalSides[i] = "SHORT";
          // position = "short"; entryPrice = closes[i]; ← intentionally not entering
        } else if (rsi14[i] > 65) {
          // WATCH_SELL — info-only marker. RSI 65-80 with the divergence /
          // volume / BB-touch pattern. Same info-only treatment as full SELL.
          signals[i] = "WATCH_SELL";
          signalSides[i] = "SHORT";
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

  return { signals, signalSides, lastSignal, topSignal };
}
