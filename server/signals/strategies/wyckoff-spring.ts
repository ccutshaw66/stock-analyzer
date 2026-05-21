/**
 * Wyckoff Spring detector.
 *
 * Implements the spec at `docs/strategies/wyckoff-spring-SPEC.md`. Pattern is
 * Wyckoff's classic accumulation Spring: a multi-week trading range followed
 * by a false breakdown (the "spring") that pierces below support intraday
 * and closes back inside the range, then a Sign of Strength (SOS) bar that
 * closes above the range midpoint on confirming volume.
 *
 * Fire signal = SOS bar. Entry happens at the next day's open in the
 * backtest harness; this detector only identifies the SOS bar.
 *
 * Phases per detected hit:
 *   1. Trading range (TR)  — TR_MIN_DAYS..TR_MAX_DAYS of oscillation
 *   2. Spring              — single bar pierces TR_low intraday, closes back inside
 *   3. Test (optional)     — later bar revisits spring low on lighter volume
 *   4. SOS                 — closes above TR midpoint on volume > range avg
 *
 * Stop / target match the spec: stop = spring_low × 0.98,
 * target = entry + (TR_high − TR_low).
 */

import type { OHLCV } from "../../data/types";

// ─── Trading range ─────────────────────────────────────────────────────
export const TR_MIN_DAYS = 20;            // ≥ 4 weeks of oscillation
export const TR_MAX_DAYS = 120;           // ≤ ~6 months
export const TR_MAX_WIDTH_PCT = 0.25;     // top within 25% of bottom (tight range)
export const TR_MIN_TOUCHES = 4;          // ≥2 highs near top + ≥2 lows near bottom
export const TR_TOUCH_BAND_PCT = 0.02;    // "touch" = within 2% of boundary

// ─── Spring (the false-breakdown bar) ──────────────────────────────────
export const SPRING_PIERCE_MIN_PCT = 0.005;   // pierce ≥ 0.5% below TR_low intraday
export const SPRING_CLOSE_MAX_BELOW_PCT = 0.01; // close within 1% below TR_low (or above)
export const SPRING_VOL_MIN_RATIO = 1.0;      // ≥ avg range volume

// ─── Test (optional; adds quality but not required) ───────────────────
export const TEST_LOOKAHEAD_MAX_BARS = 10;    // test must occur within 10 bars of spring
export const TEST_VOL_MAX_RATIO = 0.7;        // test volume ≤ 70% of spring volume
export const TEST_PRICE_BAND_PCT = 0.02;      // test low within 2% of spring low

// ─── Sign of Strength (SOS) — the FIRE bar ─────────────────────────────
export const SOS_MAX_BARS_AFTER_SPRING = 15;  // SOS must come within 15 bars of spring
export const SOS_VOL_MIN_RATIO = 1.2;         // ≥ 1.2× range average volume

// ─── Overhead resistance (info-only, mirrors htf.ts piece 3) ──────────
export const OVERHEAD_RESISTANCE_PCT = 0.10;
export const OVERHEAD_RESISTANCE_LOOKBACK_BARS = 252;

export interface WyckoffSpringExtras {
  /** TR_high — highest high inside the trading range window. */
  trHigh: number;
  /** TR_low — lowest low inside the trading range window. */
  trLow: number;
  /** TR width as percent of TR_low. Tight ranges score higher. */
  trWidthPct: number;
  /** Length of the trading range in bars. */
  trDays: number;
  /** Date the spring bar printed (the false-breakdown). */
  springDate: Date;
  /** Lowest price the spring bar reached. Used as the stop reference. */
  springLow: number;
  /** Spring bar volume / TR-average volume. */
  springVolRatio: number;
  /** Spring pierce depth as percent below TR_low (positive number). */
  springPiercePct: number;
  /** True if a clean test bar was found between spring and SOS. */
  hasTest: boolean;
  /** Date of the test bar, if `hasTest`. */
  testDate: Date | null;
  /** SOS bar volume / TR-average volume. */
  sosVolRatio: number;
  /** Same info-only resistance check as HTF — for future sizing logic. */
  hasOverheadResistance: boolean;
  nearestResistancePct: number | null;
}

export type WyckoffSpringPattern = "Wyckoff_Spring";

export interface WyckoffSpringHit {
  symbol: string;
  pattern: WyckoffSpringPattern;
  direction: "long";
  /** SOS bar date — the fire signal. */
  breakoutDate: Date;
  /** Close on the SOS bar. */
  breakoutPrice: number;
  /** Measure rule: SOS close + (TR_high − TR_low). */
  targetPrice: number;
  /** spring_low × 0.98. */
  stopPrice: number;
  /** 0–100; ≥ 70 = production fire. */
  qualityScore: number;
  /** First bar of the trading range. */
  patternStart: Date;
  /** SOS bar (= breakoutDate). */
  patternEnd: Date;
  extras: WyckoffSpringExtras;
}

export interface WyckoffSpringScanOptions {
  lookbackDays?: number;        // default 252
  minScore?: number;            // default 0
}

/** Rolling N-bar average volume; NaN until window is fully populated. */
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
 * Mirror of `detectOverheadResistance` in htf.ts. Scans backward for prior
 * local-max peaks above `refPrice` but within `withinPct`. Returns the
 * nearest peak's distance so future sizing logic can grade by proximity.
 * Info-only on this detector; does not affect quality score.
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

interface TrCandidate {
  start: number;        // first bar of the TR (inclusive)
  end: number;          // last bar of the TR before the spring (inclusive)
  high: number;
  low: number;
  widthPct: number;     // (high − low) / low
  days: number;
  avgVol: number;       // mean volume across [start, end]
  touches: number;      // boundary touches (highs near top + lows near bottom)
}

/**
 * Find the LONGEST valid trading range ending at `endIdx` (the bar just
 * before the spring candidate). Returns null if no valid TR exists.
 *
 * We prefer the longest range because longer accumulation = more energy =
 * higher quality, and the duration component of the scoring rubric
 * rewards it.
 */
function findTradingRange(
  highs: number[],
  lows: number[],
  volumes: number[],
  endIdx: number,
): TrCandidate | null {
  let best: TrCandidate | null = null;

  for (let days = TR_MAX_DAYS; days >= TR_MIN_DAYS; days--) {
    const start = endIdx - days + 1;
    if (start < 0) continue;

    let hi = -Infinity;
    let lo = Infinity;
    let volSum = 0;
    for (let k = start; k <= endIdx; k++) {
      if (highs[k] > hi) hi = highs[k];
      if (lows[k] < lo) lo = lows[k];
      volSum += volumes[k];
    }
    if (!isFinite(hi) || !isFinite(lo) || lo <= 0) continue;

    const widthPct = (hi - lo) / lo;
    if (widthPct > TR_MAX_WIDTH_PCT) continue;

    // Count touches: bars within TR_TOUCH_BAND_PCT of either boundary.
    let highTouches = 0;
    let lowTouches = 0;
    const hiBand = hi * (1 - TR_TOUCH_BAND_PCT);
    const loBand = lo * (1 + TR_TOUCH_BAND_PCT);
    for (let k = start; k <= endIdx; k++) {
      if (highs[k] >= hiBand) highTouches++;
      if (lows[k] <= loBand) lowTouches++;
    }
    const touches = highTouches + lowTouches;
    if (highTouches < 2 || lowTouches < 2) continue;
    if (touches < TR_MIN_TOUCHES) continue;

    best = {
      start,
      end: endIdx,
      high: hi,
      low: lo,
      widthPct,
      days,
      avgVol: volSum / days,
      touches,
    };
    // Found the longest valid range — stop.
    break;
  }

  return best;
}

/**
 * Scan a chronological OHLCV series for Wyckoff Spring setups (SOS-fired).
 *
 * @param bars  OHLCV bars sorted oldest → newest.
 * @param symbol  Informational ticker for the returned hits.
 * @param opts  lookbackDays (default 252), minScore (default 0).
 * @returns  WyckoffSpringHits sorted newest → oldest.
 */
export function scanWyckoffSpring(
  bars: OHLCV[],
  symbol = "",
  opts: WyckoffSpringScanOptions = {},
): WyckoffSpringHit[] {
  const lookbackDays = opts.lookbackDays ?? 252;
  const minScore = opts.minScore ?? 0;

  const minBars = TR_MAX_DAYS + SOS_MAX_BARS_AFTER_SPRING + 5;
  if (bars.length < minBars) return [];

  const sliceFrom = Math.max(0, bars.length - (lookbackDays + TR_MAX_DAYS + SOS_MAX_BARS_AFTER_SPRING));
  const df = bars.slice(sliceFrom);

  const highs = df.map(b => b.h);
  const lows = df.map(b => b.l);
  const closes = df.map(b => b.c);
  const vols = df.map(b => b.v);

  const hits: WyckoffSpringHit[] = [];
  let lastIdx = -999;

  // `i` is the SOS bar candidate.
  for (let i = TR_MIN_DAYS + 1; i < df.length; i++) {
    // Walk backward looking for a spring bar within window.
    let bestHit: { tr: TrCandidate; springIdx: number; hasTest: boolean; testIdx: number | null; score: number; volRatioSos: number; volRatioSpring: number; piercePct: number } | null = null;

    for (let off = 1; off <= SOS_MAX_BARS_AFTER_SPRING; off++) {
      const s = i - off;
      if (s < TR_MIN_DAYS) break;

      // Trading range ends one bar BEFORE the spring.
      const tr = findTradingRange(highs, lows, vols, s - 1);
      if (!tr) continue;

      // Spring criteria.
      const piercePct = (tr.low - lows[s]) / tr.low;       // positive when low < TR_low
      if (piercePct < SPRING_PIERCE_MIN_PCT) continue;

      const closeBelowPct = (tr.low - closes[s]) / tr.low; // positive when close < TR_low
      if (closeBelowPct > SPRING_CLOSE_MAX_BELOW_PCT) continue;

      const springVolRatio = tr.avgVol > 0 ? vols[s] / tr.avgVol : 0;
      if (springVolRatio < SPRING_VOL_MIN_RATIO) continue;

      // SOS criteria — bar i closes above range midpoint on confirming vol.
      const mid = (tr.high + tr.low) / 2;
      if (closes[i] <= mid) continue;

      const sosVolRatio = tr.avgVol > 0 ? vols[i] / tr.avgVol : 0;
      if (sosVolRatio < SOS_VOL_MIN_RATIO) continue;

      // Optional test bar between spring and SOS.
      let hasTest = false;
      let testIdx: number | null = null;
      const testBand = lows[s] * (1 + TEST_PRICE_BAND_PCT);
      const testVolCeiling = vols[s] * TEST_VOL_MAX_RATIO;
      const testEnd = Math.min(i - 1, s + TEST_LOOKAHEAD_MAX_BARS);
      for (let t = s + 1; t <= testEnd; t++) {
        if (lows[t] <= testBand && lows[t] >= lows[s] && vols[t] <= testVolCeiling) {
          hasTest = true;
          testIdx = t;
          break;
        }
      }

      // Scoring (rubric mirrors HTF: base 50, max bonus 50, max total 100).
      let score = 50;
      // Spring pierce depth — linear 0.5% → 0pt, 5% → 10pt.
      score += Math.max(0, Math.min(10, ((piercePct - 0.005) / 0.045) * 10));
      // Spring vol surge — linear above 1.0× → 10pt at 2.5×.
      score += Math.max(0, Math.min(10, (springVolRatio - 1) * (10 / 1.5)));
      // Test bar present — binary.
      if (hasTest) score += 10;
      // SOS vol confirmation — linear above 1.2× → 10pt at 2.5×.
      score += Math.max(0, Math.min(10, (sosVolRatio - 1.2) * (10 / 1.3)));
      // Range tightness — linear 25% width → 0pt, 8% → 5pt.
      score += Math.max(0, Math.min(5, ((TR_MAX_WIDTH_PCT - tr.widthPct) / (TR_MAX_WIDTH_PCT - 0.08)) * 5));
      // Range duration — linear 20d → 0pt, 60d+ → 5pt.
      score += Math.max(0, Math.min(5, ((tr.days - TR_MIN_DAYS) / (60 - TR_MIN_DAYS)) * 5));

      const finalScore = clampScore(score);

      // Prefer the highest-scoring (springIdx, TR) combo for this SOS bar.
      if (!bestHit || finalScore > bestHit.score) {
        bestHit = {
          tr,
          springIdx: s,
          hasTest,
          testIdx,
          score: finalScore,
          volRatioSos: sosVolRatio,
          volRatioSpring: springVolRatio,
          piercePct,
        };
      }
    }

    if (!bestHit) continue;
    if (bestHit.score < minScore) continue;

    // Anti-overlap: don't emit two hits within TR_MIN_DAYS of each other.
    if (i - lastIdx < TR_MIN_DAYS) continue;

    const tr = bestHit.tr;
    const s = bestHit.springIdx;
    const entryRef = closes[i];
    const target = entryRef + (tr.high - tr.low);
    const stop = lows[s] * 0.98;

    const { hasResistance, nearestPct } = detectOverheadResistance(highs, i, entryRef);

    hits.push({
      symbol,
      pattern: "Wyckoff_Spring",
      direction: "long",
      breakoutDate: df[i].t,
      breakoutPrice: entryRef,
      targetPrice: target,
      stopPrice: stop,
      qualityScore: bestHit.score,
      patternStart: df[tr.start].t,
      patternEnd: df[i].t,
      extras: {
        trHigh: tr.high,
        trLow: tr.low,
        trWidthPct: Number((tr.widthPct * 100).toFixed(2)),
        trDays: tr.days,
        springDate: df[s].t,
        springLow: lows[s],
        springVolRatio: Number(bestHit.volRatioSpring.toFixed(2)),
        springPiercePct: Number((bestHit.piercePct * 100).toFixed(2)),
        hasTest: bestHit.hasTest,
        testDate: bestHit.testIdx != null ? df[bestHit.testIdx].t : null,
        sosVolRatio: Number(bestHit.volRatioSos.toFixed(2)),
        hasOverheadResistance: hasResistance,
        nearestResistancePct: nearestPct != null ? Number((nearestPct * 100).toFixed(2)) : null,
      },
    });
    lastIdx = i;
  }

  hits.sort((a, b) => b.breakoutDate.getTime() - a.breakoutDate.getTime());
  return hits;
}
