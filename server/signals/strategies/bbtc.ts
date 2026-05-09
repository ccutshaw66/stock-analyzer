/**
 * BBTC — Trend-following strategy (single source of truth).
 *
 * **Major rewrite 2026-05-08:** pivoted from "balanced edge" (event-based
 * entries with capped winners) to a real trend follower:
 *   - State-based entries (no fresh EMA cross required — fires on first
 *     bar where the trend stack is aligned). Catches sustained trends
 *     that the event-based design was missing entirely (NVDA 2022-2024,
 *     AAPB recoveries).
 *   - Two-stop framework: hard stop locks in max loss at entry, trailing
 *     stop ratchets up and takes over once it climbs above the hard stop
 *     level. Classic futures stop-ladder.
 *   - No profit target. Winners run as long as the trail allows.
 *
 * This is the ONLY place BBTC is computed. Scanner, Trade Analysis,
 * Track Record, and any future caller must import from here.
 */

export type BBTCSignal =
  | "BUY"        // open long
  | "SELL"       // open short (or close long via state weakening)
  | "ADD_LONG"   // legacy — no longer emitted (kept in type for downstream tolerance)
  | "REDUCE"     // legacy — no longer emitted (no profit target)
  | "STOP_HIT"   // stop or trailing-stop hit
  | null;

export type BBTCTopSignal = "HOLD" | "ENTER" | "SELL";
export type BBTCTrend = "UP" | "DOWN" | "SIDEWAYS";
export type BBTCBias = "LONG" | "SHORT" | "FLAT";
export type BBTCSignalSide = "LONG" | "SHORT" | null;

export interface BBTCInput {
  closes: number[];
  highs: number[];
  lows: number[];
  ema9: number[];
  ema21: number[];
  ema50: number[];
  atr14: number[];
  /** Optional ADX(14). When provided, BBTC requires ADX >= 20 at entry to
   *  reject chop-market entries. Computed inline from highs/lows/closes
   *  if not passed. */
  adx14?: number[];
  /** Optional RSI(14). Used as a soft chase-filter (see entry conditions). */
  rsi14?: number[];
}

export interface BBTCResult {
  signals: BBTCSignal[];
  signalSides: BBTCSignalSide[];
  lastSignal: BBTCSignal;
  topSignal: BBTCTopSignal;
  trend: BBTCTrend;
  bias: BBTCBias;
  entryPrice: number;
  highestSinceEntry: number;
}

// ─── Tunable constants ─────────────────────────────────────────────────
const ATR_STOP_MULT = 2.5;        // hard stop distance from entry, in entryATR units
const ATR_TRAIL_MULT = 3.0;       // trail distance below highestSinceEntry, in current ATR units
                                  // wider than hard stop so trail starts BELOW hard stop
                                  // and the hard stop is the active level early in the trade.
                                  // As price runs up, trail ratchets up and eventually
                                  // takes over. Classic futures stop-ladder.
const MIN_ADX_FOR_ENTRY = 20;     // ADX < 20 = chop, skip entry
const RSI_CEILING_LONG = 65;      // base RSI ceiling for long entries
const RSI_CEILING_LONG_RISING = 75;  // higher ceiling allowed when RSI is turning up
                                     // from a pullback (catches continuation entries
                                     // where the underlying trend is intact and RSI
                                     // is recovering from a dip).
const RSI_FLOOR_SHORT = 35;
const RSI_FLOOR_SHORT_FALLING = 25;
const SMA200_SLOPE_LOOKBACK = 20; // bars to compare SMA200 vs SMA200[i-N] for slope check

// ─── Helpers ───────────────────────────────────────────────────────────

// Wilder's ADX(14). Self-contained.
function computeADX(highs: number[], lows: number[], closes: number[], period = 14): number[] {
  const len = closes.length;
  const adx = new Array(len).fill(NaN);
  if (len < period * 2 + 1) return adx;

  const tr = new Array(len).fill(0);
  tr[0] = highs[0] - lows[0];
  for (let i = 1; i < len; i++) {
    tr[i] = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1]),
    );
  }
  const plusDM = new Array(len).fill(0);
  const minusDM = new Array(len).fill(0);
  for (let i = 1; i < len; i++) {
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    plusDM[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDM[i] = downMove > upMove && downMove > 0 ? downMove : 0;
  }
  let smoothTR = 0, smoothPlusDM = 0, smoothMinusDM = 0;
  for (let i = 1; i <= period; i++) {
    smoothTR += tr[i];
    smoothPlusDM += plusDM[i];
    smoothMinusDM += minusDM[i];
  }
  const dx = new Array(len).fill(NaN);
  const plusDI0 = (smoothPlusDM / smoothTR) * 100;
  const minusDI0 = (smoothMinusDM / smoothTR) * 100;
  dx[period] = (Math.abs(plusDI0 - minusDI0) / Math.max(plusDI0 + minusDI0, 1e-9)) * 100;
  for (let i = period + 1; i < len; i++) {
    smoothTR = smoothTR - smoothTR / period + tr[i];
    smoothPlusDM = smoothPlusDM - smoothPlusDM / period + plusDM[i];
    smoothMinusDM = smoothMinusDM - smoothMinusDM / period + minusDM[i];
    const plusDI = (smoothPlusDM / Math.max(smoothTR, 1e-9)) * 100;
    const minusDI = (smoothMinusDM / Math.max(smoothTR, 1e-9)) * 100;
    dx[i] = (Math.abs(plusDI - minusDI) / Math.max(plusDI + minusDI, 1e-9)) * 100;
  }
  let sum = 0;
  for (let i = period; i < period * 2; i++) sum += dx[i];
  adx[period * 2 - 1] = sum / period;
  for (let i = period * 2; i < len; i++) {
    adx[i] = (adx[i - 1] * (period - 1) + dx[i]) / period;
  }
  return adx;
}

// RSI(14) — Wilder's. Self-contained.
function computeRSISeries(closes: number[], period: number): number[] {
  const rsi = new Array(closes.length).fill(NaN);
  if (closes.length <= period) return rsi;
  let gainSum = 0, lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const ch = closes[i] - closes[i - 1];
    if (ch > 0) gainSum += ch; else lossSum -= ch;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1];
    const g = ch > 0 ? ch : 0;
    const l = ch < 0 ? -ch : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return rsi;
}

// SMA series. Used for SMA200 (regime check).
function computeSMA(data: number[], period: number): number[] {
  const out = new Array(data.length).fill(NaN);
  if (data.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += data[i];
  out[period - 1] = sum / period;
  for (let i = period; i < data.length; i++) out[i] = out[i - 1] + (data[i] - data[i - period]) / period;
  return out;
}

// ─── Main strategy ─────────────────────────────────────────────────────
export function computeBBTC(input: BBTCInput): BBTCResult {
  const { closes, highs, lows, ema9, ema21, ema50, atr14 } = input;
  const adx14 = input.adx14 ?? computeADX(highs, lows, closes, 14);
  const rsi14 = input.rsi14 ?? computeRSISeries(closes, 14);
  const sma200 = computeSMA(closes, 200);
  const signals: BBTCSignal[] = new Array(closes.length).fill(null);
  const signalSides: BBTCSignalSide[] = new Array(closes.length).fill(null);

  let inPosition = false;
  let positionSide: "LONG" | "SHORT" | null = null;
  let entryPrice = 0;
  let entryATR = 0;
  let highestSinceEntry = 0;
  let lowestSinceEntry = Number.POSITIVE_INFINITY;

  for (let i = 1; i < closes.length; i++) {
    if (isNaN(ema9[i]) || isNaN(ema21[i]) || isNaN(ema50[i]) || isNaN(atr14[i])) continue;

    // ─── Indicator state at this bar ─────────────────────────────────
    const trendStrong = !isNaN(adx14[i]) && adx14[i] >= MIN_ADX_FOR_ENTRY;

    // SMA200 regime: above-or-rising (longs), below-or-falling (shorts).
    // Slope-based check catches early-stage recoveries before price has
    // fully reclaimed SMA200 — fixes the NVDA 2022-2024 dead-zone where
    // EMAs crossed up multiple times but price was still below SMA200.
    const sma200Now = sma200[i];
    const sma200Past = i >= SMA200_SLOPE_LOOKBACK ? sma200[i - SMA200_SLOPE_LOOKBACK] : NaN;
    const sma200Rising = !isNaN(sma200Past) && !isNaN(sma200Now) && sma200Now > sma200Past;
    const sma200Falling = !isNaN(sma200Past) && !isNaN(sma200Now) && sma200Now < sma200Past;
    const longRegimeOk = isNaN(sma200Now) ? true : (closes[i] > sma200Now || sma200Rising);
    const shortRegimeOk = isNaN(sma200Now) ? true : (closes[i] < sma200Now || sma200Falling);

    // RSI direction over last 3 bars. Used as the "rising from pullback"
    // / "falling from rebound" qualifier that lets entries fire at a
    // higher absolute RSI than the base ceiling/floor would normally allow.
    const rsiTurningUp =
      i >= 2 && !isNaN(rsi14[i]) && !isNaN(rsi14[i - 1]) && !isNaN(rsi14[i - 2]) &&
      rsi14[i] > rsi14[i - 1] && rsi14[i - 1] > rsi14[i - 2];
    const rsiTurningDown =
      i >= 2 && !isNaN(rsi14[i]) && !isNaN(rsi14[i - 1]) && !isNaN(rsi14[i - 2]) &&
      rsi14[i] < rsi14[i - 1] && rsi14[i - 1] < rsi14[i - 2];
    const longRSIok = isNaN(rsi14[i])
      ? true
      : (rsi14[i] < RSI_CEILING_LONG) ||
        (rsi14[i] < RSI_CEILING_LONG_RISING && rsiTurningUp);
    const shortRSIok = isNaN(rsi14[i])
      ? true
      : (rsi14[i] > RSI_FLOOR_SHORT) ||
        (rsi14[i] > RSI_FLOOR_SHORT_FALLING && rsiTurningDown);

    // EMA stack state (no cross-event required — state-based, fires on
    // first bar where stack is aligned, catching sustained-trend re-entries
    // that the prior cross-event design missed entirely).
    const longStackOk = ema9[i] > ema21[i] && closes[i] > ema50[i];
    const shortStackOk = ema9[i] < ema21[i] && closes[i] < ema50[i];

    if (!inPosition) {
      // ─── Entry: state-based ─────────────────────────────────────────
      if (longStackOk && trendStrong && longRegimeOk && longRSIok) {
        signals[i] = "BUY";
        signalSides[i] = "LONG";
        inPosition = true;
        positionSide = "LONG";
        entryPrice = closes[i];
        entryATR = atr14[i];
        highestSinceEntry = highs[i];
        lowestSinceEntry = lows[i];
      } else if (shortStackOk && trendStrong && shortRegimeOk && shortRSIok) {
        signals[i] = "SELL";
        signalSides[i] = "SHORT";
        inPosition = true;
        positionSide = "SHORT";
        entryPrice = closes[i];
        entryATR = atr14[i];
        highestSinceEntry = highs[i];
        lowestSinceEntry = lows[i];
      }
    } else if (positionSide === "LONG") {
      // ─── Long management: two-stop framework ────────────────────────
      highestSinceEntry = Math.max(highestSinceEntry, highs[i]);
      // Hard stop locked at entry-bar ATR. Defines max loss. Doesn't move.
      const hardStop = entryPrice - entryATR * ATR_STOP_MULT;
      // Trail stop: ratchets up with new highs, uses current ATR (adapts
      // to live volatility). Wider multiplier than hard stop so trail
      // starts BELOW hard stop — hard stop active early, trail takes
      // over once it climbs above hard stop level.
      const trailStop = highestSinceEntry - atr14[i] * ATR_TRAIL_MULT;
      // Effective stop = whichever is HIGHER (closer to current price).
      // Early in trade: hardStop > trailStop, hard active.
      // After price runs: trailStop > hardStop, trail active.
      const effectiveStop = Math.max(hardStop, trailStop);

      if (lows[i] <= effectiveStop) {
        signals[i] = "STOP_HIT";
        signalSides[i] = "LONG";
        inPosition = false;
        positionSide = null;
      } else if (ema9[i] < ema21[i] && closes[i] < ema50[i]) {
        // State-based exit: trend stack inverted (EMA9 below EMA21 AND
        // close below EMA50). Confirms genuine trend weakness, not a
        // single-bar dip. Mirrors the entry stack check.
        signals[i] = "SELL";
        signalSides[i] = "LONG";
        inPosition = false;
        positionSide = null;
      }
      // Note: no REDUCE / profit target. Trail handles profit-taking.
      // Note: no ADD_LONG. State-based entries don't pyramid.
    } else if (positionSide === "SHORT") {
      // ─── Short management: mirror of long ───────────────────────────
      lowestSinceEntry = Math.min(lowestSinceEntry, lows[i]);
      const hardStop = entryPrice + entryATR * ATR_STOP_MULT;
      const trailStop = lowestSinceEntry + atr14[i] * ATR_TRAIL_MULT;
      // For shorts, effective stop = whichever is LOWER (closer to current).
      const effectiveStop = Math.min(hardStop, trailStop);

      if (highs[i] >= effectiveStop) {
        signals[i] = "STOP_HIT";
        signalSides[i] = "SHORT";
        inPosition = false;
        positionSide = null;
      } else if (ema9[i] > ema21[i] && closes[i] > ema50[i]) {
        // State-based exit: trend stack flipped to bullish.
        signals[i] = "BUY";
        signalSides[i] = "SHORT"; // short cover, NOT a new long entry
        inPosition = false;
        positionSide = null;
      }
    }
  }

  // ─── Summarize last event for UI ─────────────────────────────────────
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

  return { signals, signalSides, lastSignal, topSignal, trend, bias, entryPrice, highestSinceEntry };
}
