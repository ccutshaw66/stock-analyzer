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
export const MIN_BREAKOUT_VOL_RATIO = 1.3;
export const HTF_VOL_AVG_WINDOW = 30;   // Givens uses 30-bar avg

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
}

export interface HtfHit {
  symbol: string;
  pattern: "HTF_Givens";
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

    // Scoring rubric — verbatim from htf_givens.py
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
      },
    });
    lastIdx = i;
  }

  hits.sort((a, b) => b.breakoutDate.getTime() - a.breakoutDate.getTime());
  return hits;
}
