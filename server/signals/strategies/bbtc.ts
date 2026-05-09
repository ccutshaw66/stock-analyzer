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
   *  reject chop-market crossings. Computed inline from highs/lows/closes
   *  if not passed. */
  adx14?: number[];
  /** Optional RSI(14). When provided, BBTC requires RSI < 65 on long
   *  entries (BUY/ADD_LONG) and RSI > 35 on short entries to filter out
   *  late-cycle entries chasing extended momentum. Per 10-year eval, the
   *  60-70 and >70 RSI buckets are the lower-edge entries we want to cut. */
  rsi14?: number[];
}

export interface BBTCResult {
  /** Per-bar signals, same length as closes. null where no event. */
  signals: BBTCSignal[];
  /** Per-bar side of the trade the signal pertains to. Same length as signals.
   *  "LONG" for long entries / long exits / long stops / pyramid adds.
   *  "SHORT" for short entries / short exits / short stops.
   *  Null where signals[i] is null. Used by chart rendering to filter
   *  STOP_HIT and exit dots into the correct long/short view. */
  signalSides: BBTCSignalSide[];
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
 * **Both-sides, regime-gated as of 2026-05-08 (revised same day).**
 *
 * Earlier in the day shorts were dropped entirely after the eval showed
 * BBTC_SELL at 47% +5d win rate. That call was flawed: the eval window was
 * a +26% SPY year — shorts losing money in a 12-month bull tape doesn't
 * prove shorts don't work, it proves shorts don't work *in bull regimes*.
 * Restored with a market-regime gate.
 *
 * Long entries:
 *   - EMA9 crosses up through EMA21 with price > EMA50
 *   - ADX(14) ≥ 20 (real trend strength, filters chop)
 *
 * Short entries:
 *   - EMA9 crosses down through EMA21 with price < EMA50
 *   - ADX(14) ≥ 20
 *   - **NEW: price < SMA200** (long-term bearish regime confirmation).
 *     Without this gate, every cross-down in a bull market fires a short
 *     that gets overrun. Requiring SMA200 = below filters out
 *     bull-market false shorts; in bear markets, SMA200 will be above
 *     price for most names and shorts can fire freely.
 *
 * Other tunings retained from earlier:
 *   - ATR stop 2.5× (was 2.0× — too tight, forward returns after stop were
 *     positive meaning premature)
 *   - REDUCE target 5.0× ATR (was 3.0× — was exiting winners early)
 *   - ADX gate on initial BUY only, NOT on ADD_LONG (pullbacks legitimately
 *     drag ADX below 20 even inside strong trends)
 */

// Wilder's ADX series (14-period). Self-contained so callers don't have to
// thread it through. Returns NaN for warmup bars.
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
  // ADX = Wilder smooth of DX
  let sum = 0;
  for (let i = period; i < period * 2; i++) sum += dx[i];
  adx[period * 2 - 1] = sum / period;
  for (let i = period * 2; i < len; i++) {
    adx[i] = (adx[i - 1] * (period - 1) + dx[i]) / period;
  }
  return adx;
}

const ATR_STOP_MULT = 2.5;       // was 2.0 — too tight
const ATR_TRAIL_MULT = 1.5;      // unchanged
const ATR_TARGET_MULT = 5.0;     // was 3.0 — was reducing too early
const MIN_ADX_FOR_ENTRY = 20;    // ADX < 20 = chop, skip entry
const MAX_RSI_FOR_LONG_ENTRY = 65;  // RSI ceiling for long entries (10y eval cut)
const MIN_RSI_FOR_SHORT_ENTRY = 35; // RSI floor for short entries (mirror)
const MIN_STOP_PCT = 0.05;       // 5% percent floor on the hard stop. Low-rel-volatility
                                 // names (AAPL ~1.4% daily ATR) had 2.5×ATR = ~3.5% stops,
                                 // tighter than normal in-trend pullbacks. AAPL 5y eval
                                 // showed 11/11 entries stopped, 0 REDUCE hits. Floor
                                 // ensures stops give at least 5% room regardless of ATR;
                                 // for high-vol names (ATR > 2%), 2.5×ATR is still wider
                                 // and dominates, so this is purely a low-vol fix.

// RSI(14) — Wilder's. Self-contained so callers don't have to thread it.
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

// SMA200 — long-term regime indicator. Self-contained for the same reason
// ADX is: callers don't need to thread it through.
function computeSMA(data: number[], period: number): number[] {
  const out = new Array(data.length).fill(NaN);
  if (data.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += data[i];
  out[period - 1] = sum / period;
  for (let i = period; i < data.length; i++) out[i] = out[i - 1] + (data[i] - data[i - period]) / period;
  return out;
}

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
  let entryATR = 0; // ATR at the entry bar — locks the hard stop level for the
                    // life of the position so an ATR contraction post-entry
                    // doesn't pull the stop in closer to entry. Trail stop
                    // continues to use the current bar's ATR (it should adapt).
  let highestSinceEntry = 0;
  let lowestSinceEntry = Number.POSITIVE_INFINITY;

  for (let i = 1; i < closes.length; i++) {
    if (isNaN(ema9[i]) || isNaN(ema21[i]) || isNaN(ema50[i]) || isNaN(atr14[i])) continue;

    const crossAbove = ema9[i] > ema21[i] && ema9[i - 1] <= ema21[i - 1];
    const crossBelow = ema9[i] < ema21[i] && ema9[i - 1] >= ema21[i - 1];
    const trendStrong = !isNaN(adx14[i]) && adx14[i] >= MIN_ADX_FOR_ENTRY;
    // Regime gates. Symmetric: when SMA200 is NaN (early in series, before
    // 200-bar warmup completes), both sides default to true and rely on the
    // other entry conditions (EMA50 side + ADX). Without this symmetry the
    // SMA200=NaN bars silently blocked all shorts on charts shorter than
    // 200 bars (Trade Analysis 1Y fetches give SMA200 valid only for the
    // last ~50 bars), producing the "no short dots ever" UI bug.
    const longRegimeOk = isNaN(sma200[i]) ? true : closes[i] > sma200[i];
    const shortRegimeOk = isNaN(sma200[i]) ? true : closes[i] < sma200[i];
    // RSI gate. NaN bars (early in series) default to true so warmup doesn't
    // silently block all entries — same defensive pattern as SMA200 above.
    const longRSIok = isNaN(rsi14[i]) ? true : rsi14[i] < MAX_RSI_FOR_LONG_ENTRY;
    const shortRSIok = isNaN(rsi14[i]) ? true : rsi14[i] > MIN_RSI_FOR_SHORT_ENTRY;

    if (!inPosition) {
      if (crossAbove && closes[i] > ema50[i] && trendStrong && longRegimeOk && longRSIok) {
        signals[i] = "BUY";
        signalSides[i] = "LONG";
        inPosition = true;
        positionSide = "LONG";
        entryPrice = closes[i];
        entryATR = atr14[i];
        highestSinceEntry = highs[i];
        lowestSinceEntry = lows[i];
      } else if (crossBelow && closes[i] < ema50[i] && trendStrong && shortRegimeOk && shortRSIok) {
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
      highestSinceEntry = Math.max(highestSinceEntry, highs[i]);
      // Hard stop locked at entry-bar ATR — does NOT shrink if ATR contracts
      // post-entry (a real bug Chris hit on AAPL 5Y: enter on a volatile bar
      // when ATR=$5, ATR contracts to $3 the next week, stop pulls in from
      // $187.50 → $192.50 and a normal pullback inside trend triggers it).
      // Plus a 5% percent floor: max(2.5×entryATR, 5%×entryPrice). Low-vol
      // names (AAPL ATR 1.4%) get 5% breathing room; high-vol names where
      // 2.5×ATR exceeds 5% are unchanged.
      const stopDistance = Math.max(entryATR * ATR_STOP_MULT, entryPrice * MIN_STOP_PCT);
      const stopLoss = entryPrice - stopDistance;
      // Trail stop uses CURRENT ATR — it should adapt to live volatility, and
      // it's gated below to only activate once it has ratcheted above entry.
      const rawTrailStop = highestSinceEntry - atr14[i] * ATR_TRAIL_MULT;
      const trailActive = rawTrailStop > entryPrice;
      const target = entryPrice + entryATR * ATR_TARGET_MULT;
      if (lows[i] <= stopLoss || (trailActive && lows[i] <= rawTrailStop)) {
        signals[i] = "STOP_HIT";
        signalSides[i] = "LONG"; // long stop — show in long view only
        inPosition = false;
        positionSide = null;
      } else if (highs[i] >= target) {
        signals[i] = "REDUCE";
        signalSides[i] = "LONG"; // long profit-take
      } else if (crossAbove && closes[i] > ema50[i] && longRSIok) {
        // ADD_LONG: pullback re-entry within an existing long. ADX is NOT
        // required here — pullbacks legitimately drag ADX below 20 inside
        // strong trends. RSI ceiling IS applied — adding to a long at
        // RSI > 65 is exactly the late-cycle chase we want to avoid.
        signals[i] = "ADD_LONG";
        signalSides[i] = "LONG";
      } else if (crossBelow && closes[i] < ema50[i]) {
        // Cross-down while in long = exit. Does NOT auto-flip to short.
        signals[i] = "SELL";
        signalSides[i] = "LONG"; // long exit, NOT a short entry — show in long view
        inPosition = false;
        positionSide = null;
      }
    } else if (positionSide === "SHORT") {
      lowestSinceEntry = Math.min(lowestSinceEntry, lows[i]);
      // Mirror of long-side stop math, just flipped. Hard stop uses entry-bar
      // ATR (locked) plus 5% percent floor; trail uses current ATR (adapts)
      // and only activates once it has ratcheted BELOW entry (profit-lock).
      const stopDistance = Math.max(entryATR * ATR_STOP_MULT, entryPrice * MIN_STOP_PCT);
      const stopLoss = entryPrice + stopDistance;
      const rawTrailStop = lowestSinceEntry + atr14[i] * ATR_TRAIL_MULT;
      const trailActive = rawTrailStop < entryPrice;
      const target = entryPrice - entryATR * ATR_TARGET_MULT;
      if (highs[i] >= stopLoss || (trailActive && highs[i] >= rawTrailStop)) {
        signals[i] = "STOP_HIT";
        signalSides[i] = "SHORT"; // short stop — show in short view only
        inPosition = false;
        positionSide = null;
      } else if (lows[i] <= target) {
        signals[i] = "REDUCE";
        signalSides[i] = "SHORT"; // short profit-take
      } else if (crossAbove && closes[i] > ema50[i]) {
        // Cross-up while in short = exit. Does NOT auto-flip to long.
        signals[i] = "BUY";
        signalSides[i] = "SHORT"; // short exit, NOT a long entry — show in short view
        inPosition = false;
        positionSide = null;
      }
      // Note: no pyramid-the-short branch. Pre-2026-05-08 code emitted
      // "ADD_LONG" while in SHORT for added-bearishness — that was a label
      // bug and inflated the eval's ADD_LONG count. Cleaner to skip the
      // short-pyramid entirely than to introduce a new ADD_SHORT type.
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

  return { signals, signalSides, lastSignal, topSignal, trend, bias, entryPrice, highestSinceEntry };
}
