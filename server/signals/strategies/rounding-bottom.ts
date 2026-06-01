/**
 * Rounding Bottom (Saucer) detector — Bulkowski Ch. 39.
 * Rank #8 overall bull market, 43% avg rise, 5% break-even failure, 40%
 * throwback (the lowest throwback rate of the top patterns — fewer overhead-
 * resistance worries).
 *
 * A long, gently-curved U-shaped bottom, typically 3+ months. Detection fits a
 * quadratic (parabola) to the lows over a sliding window; a valid saucer needs
 * the parabola to open upward, its vertex to sit inside the window, and the fit
 * to be reasonably clean (R²). Breakout = close above the "rim" (the lower of
 * the left/right edge highs).
 *
 * Ported from the Python reference `backend/patterns/rounding_bottom.py`,
 * matching the project's TS detector shape (see wyckoff-spring.ts). The numpy
 * polyfit is replaced by a closed-form degree-2 least-squares solve. Pure
 * function — no I/O. Daily bars.
 *
 * Lifecycle (long):
 *   Entry  = next day's open after the breakout bar
 *   Stop   = bowl_low × 0.97
 *   Target = breakout_close + (rim − bowl_low)   [measure rule, informational]
 */

import type { OHLCV } from "../../data/types";

// ─── Bulkowski thresholds ───────────────────────────────────────────────────
export const MIN_BOWL_DAYS = 60;       // 3 months minimum
export const MAX_BOWL_DAYS = 250;      // 1 year maximum
export const MIN_R2 = 0.55;            // parabola must fit at least this well
export const MIN_HEIGHT = 0.10;        // rim ≥ 10% above bowl low
export const BREAKOUT_PAD = 0.001;
export const BREAKOUT_LOOKAHEAD_BARS = 30;
export const VOL_AVG_WINDOW = 30;
export const WINDOW_STEP = 5;          // slide window endpoints by 5 bars to save work
export const WIDTHS = [60, 80, 100, 130, 160, 200, 250];

export const OVERHEAD_RESISTANCE_PCT = 0.10;
export const OVERHEAD_RESISTANCE_LOOKBACK_BARS = 252;

export interface RoundingBottomExtras {
  bowlLow: number;
  rimPrice: number;
  bowlDays: number;
  fitR2: number;
  /** True if volume also formed a U shape (lower in the middle of the bowl). */
  uVolume: boolean;
  breakoutVolRatio: number;
  hasOverheadResistance: boolean;
  nearestResistancePct: number | null;
}

export type RoundingBottomPattern = "Rounding_Bottom";

export interface RoundingBottomHit {
  symbol: string;
  pattern: RoundingBottomPattern;
  direction: "long";
  breakoutDate: Date;
  breakoutPrice: number;
  targetPrice: number;
  stopPrice: number;
  qualityScore: number;
  patternStart: Date;
  patternEnd: Date;
  extras: RoundingBottomExtras;
}

export interface RoundingBottomScanOptions {
  lookbackDays?: number;     // default 504 (~2y)
  minScore?: number;         // default 0
  requireBreakout?: boolean; // default true
}

function clampScore(s: number): number {
  return Math.max(0, Math.min(100, Math.round(s)));
}

/**
 * Closed-form degree-2 least-squares fit: returns [a, b, c] for y ≈ a·x² + b·x + c
 * by solving the 3×3 normal equations via Gaussian elimination. Returns null if
 * the system is singular.
 */
function polyfit2(x: number[], y: number[]): [number, number, number] | null {
  const n = x.length;
  if (n < 3) return null;
  let S0 = n, S1 = 0, S2 = 0, S3 = 0, S4 = 0;
  let T0 = 0, T1 = 0, T2 = 0;
  for (let i = 0; i < n; i++) {
    const xi = x[i];
    const xi2 = xi * xi;
    S1 += xi;
    S2 += xi2;
    S3 += xi2 * xi;
    S4 += xi2 * xi2;
    T0 += y[i];
    T1 += xi * y[i];
    T2 += xi2 * y[i];
  }
  // Solve M · [a,b,c] = R, where
  // M = [[S4,S3,S2],[S3,S2,S1],[S2,S1,S0]], R = [T2,T1,T0]
  const M = [
    [S4, S3, S2, T2],
    [S3, S2, S1, T1],
    [S2, S1, S0, T0],
  ];
  // Gaussian elimination with partial pivoting.
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let r = col + 1; r < 3; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (Math.abs(M[pivot][col]) < 1e-12) return null;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const factor = M[r][col] / M[col][col];
      for (let k = col; k < 4; k++) M[r][k] -= factor * M[col][k];
    }
  }
  const a = M[0][3] / M[0][0];
  const b = M[1][3] / M[1][1];
  const c = M[2][3] / M[2][2];
  return [a, b, c];
}

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

function mean(arr: number[], from: number, to: number): number {
  let s = 0;
  let c = 0;
  for (let i = from; i < to; i++) {
    s += arr[i];
    c++;
  }
  return c > 0 ? s / c : 0;
}

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
 * Scan a chronological DAILY OHLCV series for Rounding Bottom setups.
 * Returns hits newest → oldest, de-duplicated by (breakoutDate, breakoutPrice).
 */
export function scanRoundingBottom(
  bars: OHLCV[],
  symbol = "",
  opts: RoundingBottomScanOptions = {},
): RoundingBottomHit[] {
  const lookbackDays = opts.lookbackDays ?? 504;
  const minScore = opts.minScore ?? 0;
  const requireBreakout = opts.requireBreakout ?? true;

  if (bars.length < MAX_BOWL_DAYS + 5) return [];
  const sliceFrom = Math.max(0, bars.length - (lookbackDays + MAX_BOWL_DAYS));
  const df = bars.slice(sliceFrom);

  const highs = df.map(b => b.h);
  const lows = df.map(b => b.l);
  const closes = df.map(b => b.c);
  const vols = df.map(b => b.v);
  const volAvg = rollingVolAvg(vols, VOL_AVG_WINDOW);

  const hits: RoundingBottomHit[] = [];
  let lastIdx = -999;

  for (const width of WIDTHS) {
    if (width >= df.length) continue;
    for (let end = width; end < df.length; end += WINDOW_STEP) {
      const start = end - width;
      const windowLows = lows.slice(start, end + 1);
      const xs = windowLows.map((_, idx) => idx);

      const coeffs = polyfit2(xs, windowLows);
      if (!coeffs) continue;
      const [a, b, c] = coeffs;
      if (a <= 0) continue; // not an upward-opening bowl

      // Vertex must lie inside the central 20–80% of the window.
      const vx = -b / (2 * a);
      if (vx < width * 0.2 || vx > width * 0.8) continue;

      // R² of the fit.
      let ssRes = 0;
      let ssTot = 0;
      const yMean = windowLows.reduce((s, v) => s + v, 0) / windowLows.length;
      for (let idx = 0; idx < windowLows.length; idx++) {
        const fitted = a * idx * idx + b * idx + c;
        ssRes += (windowLows[idx] - fitted) ** 2;
        ssTot += (windowLows[idx] - yMean) ** 2;
      }
      if (ssTot === 0) continue;
      const r2 = 1 - ssRes / ssTot;
      if (r2 < MIN_R2) continue;

      // Rim and bowl. Breakout is over the LOWER of the left/right rim highs.
      const bowlLow = Math.min(...windowLows);
      const leftRimEnd = start + Math.floor(width / 4);
      let leftRim = -Infinity;
      for (let k = start; k < leftRimEnd; k++) if (highs[k] > leftRim) leftRim = highs[k];
      let rightRim = -Infinity;
      for (let k = start + Math.floor((3 * width) / 4); k <= end; k++) if (highs[k] > rightRim) rightRim = highs[k];
      const rim = Math.min(leftRim, rightRim);
      const height = rim - bowlLow;
      if (bowlLow <= 0 || height / bowlLow < MIN_HEIGHT) continue;

      // Breakout: close above rim within N bars.
      let breakoutIdx: number | null = null;
      const scanEnd = Math.min(df.length, end + BREAKOUT_LOOKAHEAD_BARS);
      for (let j = end; j < scanEnd; j++) {
        if (closes[j] > rim * (1 + BREAKOUT_PAD)) {
          breakoutIdx = j;
          break;
        }
      }
      if (breakoutIdx == null) {
        if (requireBreakout) continue;
        breakoutIdx = end;
      }

      if (breakoutIdx - lastIdx < Math.floor(width / 4)) continue;

      const target = closes[breakoutIdx] + height;
      const stop = bowlLow * 0.97;
      const vr = volAvg[breakoutIdx] && volAvg[breakoutIdx] > 0 ? vols[breakoutIdx] / volAvg[breakoutIdx] : 1.0;

      // U-shaped volume: middle third lighter than both edges (Bulkowski).
      const t1 = start + Math.floor(width / 3);
      const t2 = start + Math.floor((2 * width) / 3);
      const volFirst = mean(vols, start, t1);
      const volMid = mean(vols, t1, t2);
      const volLast = mean(vols, t2, end);
      const uVolume = volMid < volFirst && volMid < volLast;

      let score = 50;
      score += Math.round((r2 - MIN_R2) * 100); // +0..+45 by fit quality
      if (uVolume) score += 10;
      if (vr > 1.5) score += 10;
      else if (vr > 1.2) score += 5;
      if (height / bowlLow > 0.25) score += 5;

      const finalScore = clampScore(score);
      if (finalScore < minScore) continue;

      const { hasResistance, nearestPct } = detectOverheadResistance(highs, breakoutIdx, closes[breakoutIdx]);

      hits.push({
        symbol,
        pattern: "Rounding_Bottom",
        direction: "long",
        breakoutDate: df[breakoutIdx].t,
        breakoutPrice: Number(closes[breakoutIdx].toFixed(4)),
        targetPrice: Number(target.toFixed(4)),
        stopPrice: Number(stop.toFixed(4)),
        qualityScore: finalScore,
        patternStart: df[start].t,
        patternEnd: df[breakoutIdx].t,
        extras: {
          bowlLow: Number(bowlLow.toFixed(4)),
          rimPrice: Number(rim.toFixed(4)),
          bowlDays: width,
          fitR2: Number(r2.toFixed(3)),
          uVolume,
          breakoutVolRatio: Number(vr.toFixed(2)),
          hasOverheadResistance: hasResistance,
          nearestResistancePct: nearestPct != null ? Number((nearestPct * 100).toFixed(2)) : null,
        },
      });
      lastIdx = breakoutIdx;
    }
  }

  // De-dup by (breakoutDate, breakoutPrice), newest first.
  hits.sort((a, b) => b.breakoutDate.getTime() - a.breakoutDate.getTime());
  const seen = new Set<string>();
  const out: RoundingBottomHit[] = [];
  for (const h of hits) {
    const key = `${h.breakoutDate.getTime()}:${h.breakoutPrice.toFixed(2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h);
  }
  return out;
}
