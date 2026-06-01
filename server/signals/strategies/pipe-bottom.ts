/**
 * Pipe Bottom detector — Bulkowski Ch. 41 (Encyclopedia of Chart Patterns).
 * Rank #5 overall bull market, 45% avg rise, 5% break-even failure, 44% throwback.
 *
 * WEEKLY BARS ONLY. Bulkowski is explicit (p. 537): daily Pipe Bottoms are
 * unprofitable (18% failure, 33% rise) — only the weekly version has edge. This
 * detector resamples the incoming daily OHLCV series to weekly (W-FRI) before
 * scanning.
 *
 * Pattern: two ADJACENT weekly bars, each a long downward price spike (long
 * lower shadow), bottoming at approximately the same low, occurring after a
 * downtrend. The breakout fires when a later weekly bar closes above the higher
 * of the two pipe-bar highs.
 *
 * Ported from the Python reference `backend/patterns/pipe_bottom.py`, matching
 * the project's TS detector shape (see wyckoff-spring.ts). Pure function — no I/O.
 *
 * Lifecycle (mean-reversion long):
 *   Entry  = next weekly bar's open after the breakout week
 *   Stop   = pipe_low × 0.97
 *   Target = breakout_close + (pipe_high − pipe_low)   [measure rule, informational]
 */

import type { OHLCV } from "../../data/types";

// ─── Bulkowski Table 41.1 thresholds ───────────────────────────────────────
export const PIPE_TOLERANCE = 0.02;       // the two pipe lows within 2% of each other
export const SPIKE_BODY_MAX_FRAC = 0.5;   // body sits in upper ≤50% of the bar (long lower shadow)
export const MIN_SPIKE_FACTOR = 1.5;      // each pipe bar's range ≥ 1.5× prior-12-week avg range
export const DOWNTREND_BARS = 12;         // require a prior downtrend of N weeks
export const DOWNTREND_MIN_DROP = 0.10;   // ≥10% drop into the pipe
export const BREAKOUT_PAD = 0.001;        // close must clear pipe_high by 0.1%
export const BREAKOUT_LOOKAHEAD_WEEKS = 8; // breakout must arrive within N weeks
export const VOL_AVG_WINDOW = 10;         // weekly rolling volume window

// ─── Overhead resistance (info-only, mirrors htf.ts / wyckoff-spring.ts) ────
export const OVERHEAD_RESISTANCE_PCT = 0.10;
export const OVERHEAD_RESISTANCE_LOOKBACK_BARS = 104; // ~2y of weekly bars

export interface PipeBottomExtras {
  /** Average of the two pipe-bar lows. Stop reference. */
  pipeLow: number;
  /** Higher of the two pipe-bar highs. Breakout reference. */
  pipeHigh: number;
  /** Depth of the prior downtrend into the pipe, percent. */
  priorDowntrendPct: number;
  /** Combined volume of the two pipe bars / weekly avg volume. */
  spikeVolRatio: number;
  /** Breakout-week volume / weekly avg volume. */
  breakoutVolRatio: number;
  /** Always true — this strategy is weekly-only. */
  weekly: boolean;
  hasOverheadResistance: boolean;
  nearestResistancePct: number | null;
}

export type PipeBottomPattern = "Pipe_Bottom";

export interface PipeBottomHit {
  symbol: string;
  pattern: PipeBottomPattern;
  direction: "long";
  /** Breakout WEEK date (Friday of the breakout week). */
  breakoutDate: Date;
  /** Close on the breakout week. */
  breakoutPrice: number;
  /** Measure rule: breakout_close + (pipe_high − pipe_low). */
  targetPrice: number;
  /** pipe_low × 0.97. */
  stopPrice: number;
  /** 0–100; ≥ 70 = production fire. */
  qualityScore: number;
  /** First pipe-bar week. */
  patternStart: Date;
  /** Breakout week (= breakoutDate). */
  patternEnd: Date;
  extras: PipeBottomExtras;
}

export interface PipeBottomScanOptions {
  lookbackWeeks?: number;   // default 104 (~2y)
  minScore?: number;        // default 0
  requireBreakout?: boolean; // default true
}

// ─── Weekly resample (W-FRI), matching the Python _to_weekly ────────────────
//
// Groups daily bars into ISO weeks. Open = first day's open, High = max,
// Low = min, Close = last day's close, Volume = sum. Week is keyed by the
// Friday (or last available trading day) of that week.
export function resampleWeekly(bars: OHLCV[]): OHLCV[] {
  if (bars.length === 0) return [];
  const weeks = new Map<string, OHLCV[]>();
  for (const b of bars) {
    const d = b.t;
    // ISO week key: year + week number. Use Thursday-based ISO week.
    const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const day = tmp.getUTCDay() || 7; // Mon=1..Sun=7
    tmp.setUTCDate(tmp.getUTCDate() + 4 - day); // shift to Thursday of this week
    const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    const key = `${tmp.getUTCFullYear()}-${String(weekNo).padStart(2, "0")}`;
    const arr = weeks.get(key);
    if (arr) arr.push(b);
    else weeks.set(key, [b]);
  }
  const out: OHLCV[] = [];
  for (const arr of Array.from(weeks.values())) {
    arr.sort((a: OHLCV, b: OHLCV) => a.t.getTime() - b.t.getTime());
    let h = -Infinity;
    let l = Infinity;
    let v = 0;
    for (const b of arr) {
      if (b.h > h) h = b.h;
      if (b.l < l) l = b.l;
      v += b.v;
    }
    out.push({
      t: arr[arr.length - 1].t, // last trading day of the week
      o: arr[0].o,
      h,
      l,
      c: arr[arr.length - 1].c,
      v,
    });
  }
  out.sort((a, b) => a.t.getTime() - b.t.getTime());
  return out;
}

function rollingVolAvg(volumes: number[], window: number): number[] {
  const out = new Array(volumes.length).fill(NaN);
  const minPeriods = Math.max(3, Math.floor(window / 3));
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

function detectOverheadResistance(
  highs: number[],
  fromIdx: number,
  refPrice: number,
  lookbackBars = OVERHEAD_RESISTANCE_LOOKBACK_BARS,
  withinPct = OVERHEAD_RESISTANCE_PCT,
): { hasResistance: boolean; nearestPct: number | null } {
  const PEAK_K = 2;
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
 * Scan a chronological DAILY OHLCV series for Pipe Bottom setups. The series
 * is resampled to weekly internally. Returns hits newest → oldest.
 */
export function scanPipeBottom(
  dailyBars: OHLCV[],
  symbol = "",
  opts: PipeBottomScanOptions = {},
): PipeBottomHit[] {
  const lookbackWeeks = opts.lookbackWeeks ?? 104;
  const minScore = opts.minScore ?? 0;
  const requireBreakout = opts.requireBreakout ?? true;

  const weekly = resampleWeekly(dailyBars);
  if (weekly.length < DOWNTREND_BARS + 5) return [];

  // Trim to the lookback window plus downtrend warmup.
  const sliceFrom = Math.max(0, weekly.length - (lookbackWeeks + DOWNTREND_BARS));
  const df = weekly.slice(sliceFrom);

  const opens = df.map(b => b.o);
  const highs = df.map(b => b.h);
  const lows = df.map(b => b.l);
  const closes = df.map(b => b.c);
  const vols = df.map(b => b.v);
  const volAvg = rollingVolAvg(vols, VOL_AVG_WINDOW);

  const hits: PipeBottomHit[] = [];
  let lastIdx = -999;

  for (let i = DOWNTREND_BARS + 1; i < df.length - 1; i++) {
    // Two adjacent pipe bars: i-1 and i.
    const l1 = lows[i - 1];
    const l2 = lows[i];
    const h1 = highs[i - 1];
    const h2 = highs[i];
    const avgLow = (l1 + l2) / 2;
    if (avgLow <= 0) continue;

    // Lows must be similar.
    if (Math.abs(l1 - l2) / avgLow > PIPE_TOLERANCE) continue;

    // Long lower shadows — body in upper portion of each bar.
    const bar1 = h1 - l1;
    const bar2 = h2 - l2;
    if (bar1 <= 0 || bar2 <= 0) continue;
    const spike1 = Math.min(opens[i - 1], closes[i - 1]) - l1;
    const spike2 = Math.min(opens[i], closes[i]) - l2;
    if (spike1 / bar1 < SPIKE_BODY_MAX_FRAC || spike2 / bar2 < SPIKE_BODY_MAX_FRAC) continue;

    // Each spike must exceed 1.5× avg bar range of prior 12 weeks.
    let rangeSum = 0;
    let rangeCount = 0;
    for (let k = i - DOWNTREND_BARS - 1; k < i - 1; k++) {
      if (k < 0) continue;
      rangeSum += highs[k] - lows[k];
      rangeCount++;
    }
    if (rangeCount < 5) continue;
    const avgRange = rangeSum / rangeCount;
    if (avgRange <= 0) continue;
    if (bar1 < MIN_SPIKE_FACTOR * avgRange || bar2 < MIN_SPIKE_FACTOR * avgRange) continue;

    // Require a prior downtrend into the pipe.
    let priorHigh = -Infinity;
    for (let k = i - DOWNTREND_BARS - 1; k < i - 1; k++) {
      if (k < 0) continue;
      if (highs[k] > priorHigh) priorHigh = highs[k];
    }
    if (!Number.isFinite(priorHigh) || priorHigh <= 0) continue;
    const drop = (priorHigh - avgLow) / priorHigh;
    if (drop < DOWNTREND_MIN_DROP) continue;

    const pipeHigh = Math.max(h1, h2);

    // Breakout: close above pipe_high within N weeks.
    let breakoutIdx: number | null = null;
    const scanEnd = Math.min(df.length, i + 1 + BREAKOUT_LOOKAHEAD_WEEKS);
    for (let j = i + 1; j < scanEnd; j++) {
      if (closes[j] > pipeHigh * (1 + BREAKOUT_PAD)) {
        breakoutIdx = j;
        break;
      }
    }
    if (breakoutIdx == null) {
      if (requireBreakout) continue;
      breakoutIdx = df.length - 1; // forming
    }

    if (breakoutIdx - lastIdx < 4) continue;

    const patternHeight = pipeHigh - avgLow;
    const target = closes[breakoutIdx] + patternHeight;
    const stop = avgLow * 0.97;

    const vr = volAvg[breakoutIdx] && volAvg[breakoutIdx] > 0 ? vols[breakoutIdx] / volAvg[breakoutIdx] : 1.0;
    const spikeVolRatio = volAvg[i] && volAvg[i] > 0 ? (vols[i - 1] + vols[i]) / (2 * volAvg[i]) : 1.0;

    // Score (mirrors the Python rubric; base 55, ±bonuses).
    let score = 55;
    if (drop >= 0.20) score += 10;
    else if (drop >= 0.15) score += 5;
    if (bar1 >= 2 * avgRange && bar2 >= 2 * avgRange) score += 10;
    if (Math.abs(l1 - l2) / avgLow < 0.005) score += 5; // very tight low match
    if (spikeVolRatio > 1.5) score += 10;
    else if (spikeVolRatio > 1.2) score += 5;
    if (vr > 1.5) score += 5;
    if (drop < 0.08) score -= 10;

    const finalScore = clampScore(score);
    if (finalScore < minScore) continue;

    const { hasResistance, nearestPct } = detectOverheadResistance(highs, breakoutIdx, closes[breakoutIdx]);

    hits.push({
      symbol,
      pattern: "Pipe_Bottom",
      direction: "long",
      breakoutDate: df[breakoutIdx].t,
      breakoutPrice: Number(closes[breakoutIdx].toFixed(4)),
      targetPrice: Number(target.toFixed(4)),
      stopPrice: Number(stop.toFixed(4)),
      qualityScore: finalScore,
      patternStart: df[i - 1].t,
      patternEnd: df[breakoutIdx].t,
      extras: {
        pipeLow: Number(avgLow.toFixed(4)),
        pipeHigh: Number(pipeHigh.toFixed(4)),
        priorDowntrendPct: Number((drop * 100).toFixed(2)),
        spikeVolRatio: Number(spikeVolRatio.toFixed(2)),
        breakoutVolRatio: Number(vr.toFixed(2)),
        weekly: true,
        hasOverheadResistance: hasResistance,
        nearestResistancePct: nearestPct != null ? Number((nearestPct * 100).toFixed(2)) : null,
      },
    });
    lastIdx = breakoutIdx;
  }

  hits.sort((a, b) => b.breakoutDate.getTime() - a.breakoutDate.getTime());
  return hits;
}
