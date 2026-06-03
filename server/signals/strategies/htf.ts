/**
 * HTF — High Tight Flag detector (Givens-loosened variant).
 *
 * 1:1 TypeScript port of `backend/patterns/htf_givens.py`. The Python remains
 * the reference implementation; this file is the production path consumed by
 * the nightly scanner, `/api/htf/*` endpoints, and the /htf page.
 *
 * Setup rules (Ross Givens' loosening of Bulkowski's #1-ranked pattern):
 *   1. Pole — 30%+ price rise in 5–60 days
 *   2. Flag — 3–30 day consolidation with ≤25% pullback from pole high
 *   3. Breakout — close above flag high on volume ≥1.3× 30-day average
 *
 * Strategy diverges from VOLUME_MA_PERIOD=20: HTF-specific 30-day window
 * matches what the algorithm was authored and backtested against.
 */

import type { OHLCV } from "../../data/types";

// ─── Identification thresholds (must match htf_givens.py) ──────────────
export const POLE_MIN_GAIN = 0.3;       // +30% qualifies
export const POLE_MAX_DAYS = 60;        // ~3 months
export const POLE_MIN_DAYS = 5;
export const FLAG_MIN_DAYS = 3;
export const FLAG_MAX_DAYS = 30;
export const FLAG_MAX_PULLBACK = 0.25;
export const BREAKOUT_PAD = 0.001;      // 0.1% above flag high
// 2026-05-20 throwback fix (piece 1a — gate threshold drop, isolated):
// 1.3 → 1.0 (still ≥average vol as a sanity floor). Bulkowski's HTF data:
// light-volume breakouts outperform heavy 79% vs 63% — the 1.3× requirement
// filtered out the alpha cohort. NOTE: keeping the volume score bonus intact
// in this piece. Piece 1 (which removed both gate AND score) failed the ship-
// keep gate because removing the +15 score bonus dropped many heavy-vol
// HTFs below minScore=70. That score change must be tested in isolation
// later, after piece 1a baseline is established.
export const MIN_BREAKOUT_VOL_RATIO = 1.0;
export const HTF_VOL_AVG_WINDOW = 30;   // Givens uses 30-bar avg
// 2026-05-20 throwback fix piece 3 — overhead-resistance detection (INFO ONLY).
// Records prior peaks within 10% above the breakout price so future sizing /
// UI logic can use it. **Does NOT affect quality score in this version** —
// the original bundle's −10 score penalty was too aggressive (filtered out
// 50% of setups). Detection-only ships behavior-neutrally; future iteration
// can layer it into position-size logic.
export const OVERHEAD_RESISTANCE_PCT = 0.10;
export const OVERHEAD_RESISTANCE_LOOKBACK_BARS = 252;

export interface HtfExtras {
  poleStartPrice: number;
  poleEndPrice: number;
  poleGainPct: number;
  poleDays: number;
  flagDays: number;
  flagHigh: number;
  flagLow: number;
  flagPullbackPct: number;
  breakoutVolRatio: number;
  /**
   * Piece 3 (info-only): true if a prior local-max peak sits above the
   * breakout price but within OVERHEAD_RESISTANCE_PCT. Reserved for future
   * sizing / UI logic — does NOT affect quality score in this version.
   * Per Bulkowski: 54% throwback rate, throwback trades rise 49% vs 100%.
   */
  hasOverheadResistance: boolean;
  /** Distance from breakout to nearest overhead peak (% above), or null. */
  nearestResistancePct: number | null;
}

export type HtfPattern = "HTF_Givens" | "HTF_Givens_Forming";

export interface HtfHit {
  symbol: string;
  /**
   * Detector tag. `HTF_Givens` = breakout has fired (close > flag_high).
   * `HTF_Givens_Forming` = pole + flag valid right now, no breakout yet
   * (set by the orchestrator when the forming detector returns a hit).
   */
  pattern: HtfPattern;
  direction: "long";
  breakoutDate: Date;
  breakoutPrice: number;        // close on breakout day
  targetPrice: number;          // measure rule: entry + 0.5 × pole height
  stopPrice: number;            // flag_low × 0.98
  qualityScore: number;         // 0–100
  patternStart: Date;           // pole start (lowest low in lookback)
  patternEnd: Date;             // breakout day
  extras: HtfExtras;
}

export interface HtfScanOptions {
  lookbackDays?: number;        // default 252
  requireBreakout?: boolean;    // default true
  minScore?: number;            // default 0
}

/** Price ran >10% past the breakout = too late to enter cleanly (chase risk). */
export const HTF_MAX_CHASE_PCT = 0.10;

export type HtfLiveStatus =
  | { live: true; daysSince: number }
  | { live: false; reason: "stopped" | "target-hit" | "chased" | "stale"; daysSince: number };

/**
 * Is a *fired* HTF hit still an actionable long RIGHT NOW?  Pure function and the
 * single source of truth shared by the nightly scanner (orchestrator) and the
 * on-demand Trigger Check, so the two can never silently drift.
 *
 * The price-based guards (stopped / target already hit / chased too far past the
 * breakout) are universal. Recency is parameterised because consumers differ: the
 * nightly scanner wants same-day breakouts only (1 day); the Trigger Check tolerates
 * a wider window before it stops calling a setup "fresh".
 *
 * @param maxDaysSinceBreakout  recency window in CALENDAR days.
 */
export function htfLiveStatus(
  hit: HtfHit,
  currentPrice: number,
  currentDate: Date,
  maxDaysSinceBreakout: number,
): HtfLiveStatus {
  const dayMs = 24 * 60 * 60 * 1000;
  const daysSince = Math.round((currentDate.getTime() - hit.breakoutDate.getTime()) / dayMs);
  // Order matters only for which reason is reported when several apply: surface
  // the most decision-relevant (trade already resolved) before mere staleness.
  if (currentPrice <= hit.stopPrice) return { live: false, reason: "stopped", daysSince };
  if (currentPrice >= hit.targetPrice) return { live: false, reason: "target-hit", daysSince };
  if (currentPrice > hit.breakoutPrice * (1 + HTF_MAX_CHASE_PCT)) return { live: false, reason: "chased", daysSince };
  if (daysSince > maxDaysSinceBreakout) return { live: false, reason: "stale", daysSince };
  return { live: true, daysSince };
}

/** Rolling N-bar average volume; NaN until window is fully populated (>= N/3 bars min). */
function rollingVolAvg(volumes: number[], window: number): number[] {
  const out = new Array(volumes.length).fill(NaN);
  const minPeriods = Math.max(5, Math.floor(window / 3));
  let sum = 0;
  for (let i = 0; i < volumes.length; i++) {
    sum += volumes[i];
    if (i >= window) sum -= volumes[i - window];
    const count = Math.min(i + 1, window);
    if (count >= minPeriods) out[i] = sum / count;
  }
  return out;
}

function clampScore(s: number): number {
  return Math.max(0, Math.min(100, Math.round(s)));
}

/**
 * Piece 3 (info-only): scan backward from a candidate bar for prior local-max
 * peaks above the price but within OVERHEAD_RESISTANCE_PCT. Returns the
 * nearest peak's distance so future sizing / UI logic can grade by proximity.
 *
 * Peak = bar whose high strictly exceeds the highs of the K bars on each side
 * (K=3 → local 7-bar maximum). Filters minor jitter, catches real swing highs.
 *
 * This does NOT affect quality scoring in piece 3 — the original bundle's
 * −10/−5 penalty was too aggressive. Recorded for future use.
 */
function detectOverheadResistance(
  highs: number[],
  fromIdx: number,
  refPrice: number,
  lookbackBars = OVERHEAD_RESISTANCE_LOOKBACK_BARS,
  withinPct = OVERHEAD_RESISTANCE_PCT,
): { hasResistance: boolean; nearestPct: number | null } {
  const PEAK_K = 3;
  const ceiling = refPrice * (1 + withinPct);
  const startIdx = Math.max(PEAK_K, fromIdx - lookbackBars);
  let nearestPct: number | null = null;
  for (let k = startIdx; k < fromIdx - PEAK_K; k++) {
    const h = highs[k];
    if (h <= refPrice || h > ceiling) continue;
    let isPeak = true;
    for (let j = 1; j <= PEAK_K; j++) {
      if (highs[k - j] >= h || highs[k + j] >= h) {
        isPeak = false;
        break;
      }
    }
    if (!isPeak) continue;
    const pct = (h - refPrice) / refPrice;
    if (nearestPct == null || pct < nearestPct) nearestPct = pct;
  }
  return { hasResistance: nearestPct != null, nearestPct };
}

/**
 * Scan a chronological OHLCV series for HTF setups.
 *
 * @param bars  OHLCV bars sorted oldest → newest.
 * @param symbol  Informational ticker for the returned hits.
 * @param opts  lookbackDays (default 252), requireBreakout (default true), minScore (default 0).
 * @returns  HtfHits sorted newest → oldest.
 */
export function scanHtf(
  bars: OHLCV[],
  symbol = "",
  opts: HtfScanOptions = {},
): HtfHit[] {
  const lookbackDays = opts.lookbackDays ?? 252;
  const requireBreakout = opts.requireBreakout ?? true;
  const minScore = opts.minScore ?? 0;

  const minBars = POLE_MAX_DAYS + FLAG_MAX_DAYS + 5;
  if (bars.length < minBars) return [];

  // Match Python: tail(lookback + POLE_MAX + FLAG_MAX)
  const sliceFrom = Math.max(0, bars.length - (lookbackDays + POLE_MAX_DAYS + FLAG_MAX_DAYS));
  const df = bars.slice(sliceFrom);

  const highs = df.map(b => b.h);
  const lows = df.map(b => b.l);
  const closes = df.map(b => b.c);
  const vols = df.map(b => b.v);
  const volAvg = rollingVolAvg(vols, HTF_VOL_AVG_WINDOW);

  const hits: HtfHit[] = [];
  let lastIdx = -999;

  for (let i = POLE_MAX_DAYS + FLAG_MAX_DAYS; i < df.length; i++) {
    // Find longest valid flag window ending at i-1 with pullback ≤ 25%.
    let bestFlagHigh: number | null = null;
    let bestFlagLow = 0;
    let bestFlagDays = 0;
    let bestFlagStart = 0;

    for (let flagDays = FLAG_MIN_DAYS; flagDays <= FLAG_MAX_DAYS; flagDays++) {
      const flagStart = i - flagDays;
      if (flagStart < POLE_MIN_DAYS) continue;
      // flag window = [flagStart, i) — excludes breakout bar itself
      let fh = -Infinity;
      let fl = Infinity;
      for (let k = flagStart; k < i; k++) {
        if (highs[k] > fh) fh = highs[k];
        if (lows[k] < fl) fl = lows[k];
      }
      if (fh <= 0 || fl <= 0 || !isFinite(fh) || !isFinite(fl)) continue;
      const pullback = (fh - fl) / fh;
      if (pullback > FLAG_MAX_PULLBACK) continue;
      if (flagDays > bestFlagDays) {
        bestFlagDays = flagDays;
        bestFlagHigh = fh;
        bestFlagLow = fl;
        bestFlagStart = flagStart;
      }
    }

    if (bestFlagHigh === null) continue;

    // Pole = run leading into the flag — lowest low in [flag_start - POLE_MAX, flag_start]
    const flagHighIdx = bestFlagStart;
    const poleSearchStart = Math.max(0, flagHighIdx - POLE_MAX_DAYS);
    let poleLowIdx = poleSearchStart;
    let poleLow = lows[poleSearchStart];
    for (let k = poleSearchStart + 1; k <= flagHighIdx; k++) {
      if (lows[k] < poleLow) {
        poleLow = lows[k];
        poleLowIdx = k;
      }
    }
    if (flagHighIdx - poleSearchStart + 1 < POLE_MIN_DAYS) continue;
    const poleDays = flagHighIdx - poleLowIdx;
    if (poleDays < POLE_MIN_DAYS || poleDays > POLE_MAX_DAYS) continue;
    const poleGain = poleLow > 0 ? (bestFlagHigh - poleLow) / poleLow : 0;
    if (poleGain < POLE_MIN_GAIN) continue;

    // Breakout
    const isBreakout = closes[i] > bestFlagHigh * (1 + BREAKOUT_PAD);
    if (!isBreakout && requireBreakout) continue;

    // Volume confirmation
    const va = volAvg[i];
    const volRatio = va && !isNaN(va) ? vols[i] / va : 0;
    if (isBreakout && volRatio < MIN_BREAKOUT_VOL_RATIO && requireBreakout) continue;

    // Anti-overlap
    if (i - lastIdx < FLAG_MIN_DAYS) continue;

    // Measure rule + stop
    const target = closes[i] + 0.5 * (bestFlagHigh - poleLow);
    const stop = bestFlagLow * 0.98;

    // Scoring rubric — verbatim from htf_givens.py.
    // 2026-05-20 piece 1a restored the volume bonus after piece 1's
    // combined change failed validation. Volume-score-removal will be
    // its own piece (1b) tested after 1a's gate-drop is validated.
    let score = 50;
    if (poleGain >= 1.0) score += 15;
    else if (poleGain >= 0.6) score += 10;
    else if (poleGain >= 0.3) score += 5;
    if (bestFlagDays >= 10) score += 10;
    else if (bestFlagDays >= 5) score += 5;
    const pullbackPct = (bestFlagHigh - bestFlagLow) / bestFlagHigh;
    if (pullbackPct <= 0.1) score += 10;
    else if (pullbackPct <= 0.15) score += 5;
    if (volRatio >= 2.0) score += 15;
    else if (volRatio >= 1.5) score += 10;
    else if (volRatio >= 1.3) score += 5;

    const finalScore = clampScore(score);
    if (finalScore < minScore) continue;

    // Piece 3 (info-only) — record overhead resistance for downstream use.
    const { hasResistance, nearestPct } = detectOverheadResistance(highs, i, closes[i]);

    hits.push({
      symbol,
      pattern: "HTF_Givens",
      direction: "long",
      breakoutDate: df[i].t,
      breakoutPrice: closes[i],
      targetPrice: target,
      stopPrice: stop,
      qualityScore: finalScore,
      patternStart: df[poleLowIdx].t,
      patternEnd: df[i].t,
      extras: {
        poleStartPrice: poleLow,
        poleEndPrice: bestFlagHigh,
        poleGainPct: poleGain * 100,
        poleDays,
        flagDays: bestFlagDays,
        flagHigh: bestFlagHigh,
        flagLow: bestFlagLow,
        flagPullbackPct: pullbackPct * 100,
        breakoutVolRatio: volRatio,
        hasOverheadResistance: hasResistance,
        nearestResistancePct: nearestPct != null ? Number((nearestPct * 100).toFixed(2)) : null,
      },
    });
    lastIdx = i;
  }

  hits.sort((a, b) => b.breakoutDate.getTime() - a.breakoutDate.getTime());
  return hits;
}

/**
 * Detect a pattern that's still FORMING — the pole has run, the flag is
 * consolidating right now, but price hasn't broken above flag_high yet.
 *
 * Unlike `scanHtf` which treats bar i as a candidate breakout day, this
 * function treats the latest bar as the LAST day of an ongoing flag.
 * If pole + flag conditions hold AND current price is still inside the
 * flag range (below the breakout level), returns one hit with hypothetical
 * entry / target / stop levels — what you'd buy if price breaks out
 * tomorrow.
 *
 * Returns `null` when no valid forming pattern exists. The hit's
 * `breakoutPrice` is the *hypothetical* trigger level (flag_high + pad)
 * rather than an actual close; `breakoutDate` is the latest bar's date.
 */
export function scanFormingHtf(bars: OHLCV[], symbol = ""): HtfHit | null {
  if (bars.length < POLE_MAX_DAYS + FLAG_MAX_DAYS + 5) return null;

  const N = bars.length;
  const highs = bars.map(b => b.h);
  const lows = bars.map(b => b.l);
  const closes = bars.map(b => b.c);
  const vols = bars.map(b => b.v);
  const volAvg = rollingVolAvg(vols, HTF_VOL_AVG_WINDOW);

  // Try every flag width ending at TODAY (bar N-1 is the last flag bar).
  let bestFlagHigh: number | null = null;
  let bestFlagLow = 0;
  let bestFlagDays = 0;
  let bestFlagStart = 0;

  for (let flagDays = FLAG_MIN_DAYS; flagDays <= FLAG_MAX_DAYS; flagDays++) {
    const flagStart = N - flagDays;
    if (flagStart < POLE_MIN_DAYS) continue;
    let fh = -Infinity;
    let fl = Infinity;
    for (let k = flagStart; k < N; k++) {
      if (highs[k] > fh) fh = highs[k];
      if (lows[k] < fl) fl = lows[k];
    }
    if (!isFinite(fh) || !isFinite(fl) || fh <= 0 || fl <= 0) continue;
    const pullback = (fh - fl) / fh;
    if (pullback > FLAG_MAX_PULLBACK) continue;
    if (flagDays > bestFlagDays) {
      bestFlagDays = flagDays;
      bestFlagHigh = fh;
      bestFlagLow = fl;
      bestFlagStart = flagStart;
    }
  }
  if (bestFlagHigh === null) return null;

  // Pole = run before the flag
  const flagHighIdx = bestFlagStart;
  const poleSearchStart = Math.max(0, flagHighIdx - POLE_MAX_DAYS);
  let poleLowIdx = poleSearchStart;
  let poleLow = lows[poleSearchStart];
  for (let k = poleSearchStart + 1; k <= flagHighIdx; k++) {
    if (lows[k] < poleLow) {
      poleLow = lows[k];
      poleLowIdx = k;
    }
  }
  if (flagHighIdx - poleSearchStart + 1 < POLE_MIN_DAYS) return null;
  const poleDays = flagHighIdx - poleLowIdx;
  if (poleDays < POLE_MIN_DAYS || poleDays > POLE_MAX_DAYS) return null;
  const poleGain = poleLow > 0 ? (bestFlagHigh - poleLow) / poleLow : 0;
  if (poleGain < POLE_MIN_GAIN) return null;

  // Today's price must still be IN the flag (not already broken out or stopped)
  const currentPrice = closes[N - 1];
  if (currentPrice > bestFlagHigh * (1 + BREAKOUT_PAD)) return null; // already fired
  if (currentPrice < bestFlagLow) return null;                       // already stopped

  // Hypothetical entry = the breakout trigger level
  const triggerPrice = bestFlagHigh * (1 + BREAKOUT_PAD);
  const stop = bestFlagLow * 0.98;
  const target = triggerPrice + 0.5 * (bestFlagHigh - poleLow);
  const pullbackPct = (bestFlagHigh - bestFlagLow) / bestFlagHigh;
  const lastVa = volAvg[N - 1];
  const lastVolRatio = lastVa && !isNaN(lastVa) ? vols[N - 1] / lastVa : 0;

  // Scoring — same rubric minus the breakout-vol bonus (no fire yet).
  let score = 50;
  if (poleGain >= 1.0) score += 15;
  else if (poleGain >= 0.6) score += 10;
  else if (poleGain >= 0.3) score += 5;
  if (bestFlagDays >= 10) score += 10;
  else if (bestFlagDays >= 5) score += 5;
  if (pullbackPct <= 0.1) score += 10;
  else if (pullbackPct <= 0.15) score += 5;

  // Piece 3 (info-only) — record overhead resistance at the trigger level.
  const { hasResistance: fHasResistance, nearestPct: fNearestPct } =
    detectOverheadResistance(highs, N - 1, triggerPrice);

  return {
    symbol,
    pattern: "HTF_Givens",     // shape unchanged — orchestrator overrides to mark forming
    direction: "long",
    breakoutDate: bars[N - 1].t,
    breakoutPrice: triggerPrice,
    targetPrice: target,
    stopPrice: stop,
    qualityScore: clampScore(score),
    patternStart: bars[poleLowIdx].t,
    patternEnd: bars[N - 1].t,
    extras: {
      poleStartPrice: poleLow,
      poleEndPrice: bestFlagHigh,
      poleGainPct: poleGain * 100,
      poleDays,
      flagDays: bestFlagDays,
      flagHigh: bestFlagHigh,
      flagLow: bestFlagLow,
      flagPullbackPct: pullbackPct * 100,
      breakoutVolRatio: lastVolRatio,
      hasOverheadResistance: fHasResistance,
      nearestResistancePct: fNearestPct != null ? Number((fNearestPct * 100).toFixed(2)) : null,
    },
  };
}
