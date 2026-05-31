/**
 * Predictive-score validation harness — does a composite score have
 * directional EDGE on forward returns?
 *
 * Goal: validate the predictive indicator BEFORE building a UI for it.
 * Per the project north star, the dashboard predictive gauge needs ≥55%
 * directional accuracy on a held-out window. This endpoint measures that.
 *
 * Approach:
 *   For every (ticker, bar) in the basket, compute two candidate composite
 *   scores using only data available at that bar (no look-ahead). Then look
 *   AT the forward 1d/5d/20d return. Aggregate per score-decile so we can
 *   see whether high-score samples actually outperform low-score samples.
 *
 *   Candidate A — strategy votes only (the existing lagging stack):
 *     HTF (forming or just-fired) + Wyckoff Spring SOS + BBTC BUY + VER BUY
 *     + (AMC score ≥ 3). Each contributes 0 or 1 → score 0..5.
 *
 *   Candidate B — strategy votes PLUS volume divergence (the leading layer):
 *     A + volumeDivergence (binary: tight price range with rising volume).
 *     Score 0..6.
 *
 *   If B's top-decile forward return is meaningfully higher than A's, the
 *   leading input adds edge. If not, we kick volume divergence out and
 *   queue the next candidate input (options skew, sentiment, etc.).
 *
 * Used by GET /api/diag/predictive-score-validate.
 *
 * IMPORTANT — what this is NOT:
 *   - Not a $-P&L backtest. It measures whether high-score samples drift
 *     up more than low-score samples, not whether you'd actually trade them.
 *   - Not a UI input. UI ships AFTER a candidate clears the 55% gate.
 *   - Not a strategy. The composite is a research artifact for now.
 */

import { fmpGet } from "../data/providers/fmp.client";
import { computeBBTC } from "../signals/strategies/bbtc";
import { computeVER } from "../signals/strategies/ver";
import { scoreAMC } from "../signals/strategies/amc";
import { scanHtf } from "../signals/strategies/htf";
import { scanWyckoffSpring } from "../signals/strategies/wyckoff-spring";
import { computeRSISeries } from "../indicators/rsi";
import type { OHLCV } from "../data/types";
import {
  RSI_PERIOD, ATR_PERIOD, EMA_FAST, EMA_MID, EMA_SLOW,
  BB_PERIOD, BB_STDDEV, VOLUME_MA_PERIOD,
} from "@shared/indicators/constants";

// ─── Indicator helpers (inlined to match diag/* family pattern) ────────────
// TODO: when the cross-page-indicator-drift bug is tackled, factor these
// into server/indicators/*Series helpers so every diag/* shares one math
// implementation. Today, every diag/* file inlines its own copy.

function computeEMA(data: number[], period: number): number[] {
  const out = new Array(data.length).fill(NaN);
  if (data.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += data[i];
  out[period - 1] = sum / period;
  const k = 2 / (period + 1);
  for (let i = period; i < data.length; i++) out[i] = data[i] * k + out[i - 1] * (1 - k);
  return out;
}

function computeSMA(data: number[], period: number): number[] {
  const out = new Array(data.length).fill(NaN);
  for (let i = period - 1; i < data.length; i++) {
    let s = 0;
    for (let j = i - period + 1; j <= i; j++) s += data[j];
    out[i] = s / period;
  }
  return out;
}

function computeATR(highs: number[], lows: number[], closes: number[], period: number): number[] {
  const tr = new Array(closes.length).fill(NaN);
  for (let i = 1; i < closes.length; i++) {
    const a = highs[i] - lows[i];
    const b = Math.abs(highs[i] - closes[i - 1]);
    const c = Math.abs(lows[i] - closes[i - 1]);
    tr[i] = Math.max(a, b, c);
  }
  const atr = new Array(closes.length).fill(NaN);
  if (closes.length <= period) return atr;
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += tr[i];
  atr[period] = sum / period;
  for (let i = period + 1; i < closes.length; i++) atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
  return atr;
}

function computeBollingerSeries(closes: number[], period: number, mult: number): { upper: number[]; lower: number[] } {
  const sma = computeSMA(closes, period);
  const upper = new Array(closes.length).fill(NaN);
  const lower = new Array(closes.length).fill(NaN);
  for (let i = period - 1; i < closes.length; i++) {
    let s = 0;
    for (let j = i - period + 1; j <= i; j++) s += (closes[j] - sma[i]) ** 2;
    const sd = Math.sqrt(s / period);
    upper[i] = sma[i] + mult * sd;
    lower[i] = sma[i] - mult * sd;
  }
  return { upper, lower };
}

function computeVolAvg(volumes: number[], period: number): number[] {
  const out = new Array(volumes.length).fill(NaN);
  for (let i = period - 1; i < volumes.length; i++) {
    let s = 0;
    for (let j = i - period + 1; j <= i; j++) s += volumes[j] || 0;
    out[i] = s / period;
  }
  return out;
}

function computeMACDHistogram(closes: number[]): number[] {
  const ema12 = computeEMA(closes, 12);
  const ema26 = computeEMA(closes, 26);
  const macdLine = closes.map((_, i) =>
    !isNaN(ema12[i]) && !isNaN(ema26[i]) ? ema12[i] - ema26[i] : NaN,
  );
  const validMacd: number[] = [];
  const validIdx: number[] = [];
  macdLine.forEach((v, i) => { if (!isNaN(v)) { validMacd.push(v); validIdx.push(i); } });
  const sigEma = computeEMA(validMacd, 9);
  const signal = new Array(closes.length).fill(NaN);
  validIdx.forEach((idx, j) => { signal[idx] = sigEma[j]; });
  return closes.map((_, i) =>
    !isNaN(macdLine[i]) && !isNaN(signal[i]) ? macdLine[i] - signal[i] : NaN,
  );
}

function computeVAMIScaled(closes: number[], volumes: number[]): number[] {
  const vami = new Array(closes.length).fill(0);
  const avgVol20 = computeSMA(volumes.map(v => v || 0), 20);
  const k = 2 / (12 + 1);
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] === 0 || isNaN(avgVol20[i]) || avgVol20[i] === 0) continue;
    const ret = ((closes[i] - closes[i - 1]) / closes[i - 1]) * 100;
    const vr = Math.min(2.5, Math.max(0.5, volumes[i] / avgVol20[i]));
    const wr = ret * vr;
    vami[i] = wr * k + vami[i - 1] * (1 - k);
  }
  return vami.map(v => v * 8);
}

// ─── Bar fetcher (same shape as strategy-pnl.ts) ────────────────────────────

interface Bars {
  date: string[];
  open: number[];
  high: number[];
  low: number[];
  close: number[];
  volume: number[];
}

async function fetchBars(symbol: string, days: number): Promise<Bars | null> {
  try {
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - (days + 250) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const data: any = await fmpGet("/historical-price-eod/full", { symbol, from, to });
    const arr: any[] = Array.isArray(data) ? data : (data?.historical || []);
    if (arr.length < 100) return null;
    const sorted = [...arr].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const date: string[] = [];
    const open: number[] = [];
    const high: number[] = [];
    const low: number[] = [];
    const close: number[] = [];
    const volume: number[] = [];
    for (const r of sorted) {
      const o = Number(r.open), h = Number(r.high), l = Number(r.low), c = Number(r.close), v = Number(r.volume);
      if (!Number.isFinite(c)) continue;
      date.push(String(r.date));
      open.push(o); high.push(h); low.push(l); close.push(c); volume.push(Number.isFinite(v) ? v : 0);
    }
    return { date, open, high, low, close, volume };
  } catch {
    return null;
  }
}

function barsToOHLCV(b: Bars): OHLCV[] {
  const out: OHLCV[] = [];
  for (let i = 0; i < b.close.length; i++) {
    out.push({
      t: new Date(b.date[i]),
      o: b.open[i], h: b.high[i], l: b.low[i], c: b.close[i], v: b.volume[i],
    });
  }
  return out;
}

// ─── Per-bar AMC score series (mirrors strategy-pnl pattern) ────────────────

function computeAMCSeries(input: {
  closes: number[]; histogram: number[]; rsi14: number[];
  trendShortEma: number[]; trendLongEma: number[]; trendStrengthRefEma: number[];
  vamiScaled: number[]; reversionRefLevel: number[]; reversionDirection: "above" | "below";
}): number[] {
  const score: number[] = new Array(input.closes.length).fill(0);
  for (let i = 1; i < input.closes.length; i++) score[i] = scoreAMC(i, input);
  return score;
}

// ─── Volume divergence (the candidate leading-input layer) ──────────────────
// "Price flat / building, volume rising." Concretely at bar i:
//   tightRange = (max(close[i-9..i]) − min(close[i-9..i])) / mean < 4%
//   risingVolume = avg(vol[i-4..i]) > 1.3 × avg(vol[i-9..i-5])
// Both true → leading score 1, else 0. Window picked per `[[reference-bulkowski-findings]]`
// and `[[reference-trading-library-findings]]` discussion: 10-bar window is the
// shortest reliable consolidation; 30% vol uptick is the threshold cited in
// the literature for accumulation footprint.
const VOLDIV_WINDOW = 10;
const VOLDIV_RANGE_MAX_PCT = 0.04;
const VOLDIV_RECENT_BARS = 5;
const VOLDIV_VOL_RATIO_MIN = 1.3;

function computeVolumeDivergenceSeries(closes: number[], volumes: number[]): number[] {
  const out = new Array(closes.length).fill(0);
  for (let i = VOLDIV_WINDOW - 1; i < closes.length; i++) {
    let hi = -Infinity, lo = Infinity, sum = 0;
    for (let j = i - VOLDIV_WINDOW + 1; j <= i; j++) {
      const c = closes[j];
      if (c > hi) hi = c;
      if (c < lo) lo = c;
      sum += c;
    }
    const mean = sum / VOLDIV_WINDOW;
    if (mean <= 0) continue;
    const rangePct = (hi - lo) / mean;
    if (rangePct >= VOLDIV_RANGE_MAX_PCT) continue;

    let recentVol = 0;
    for (let j = i - VOLDIV_RECENT_BARS + 1; j <= i; j++) recentVol += volumes[j] || 0;
    let priorVol = 0;
    for (let j = i - VOLDIV_WINDOW + 1; j <= i - VOLDIV_RECENT_BARS; j++) priorVol += volumes[j] || 0;
    const priorBars = VOLDIV_WINDOW - VOLDIV_RECENT_BARS;
    const recentAvg = recentVol / VOLDIV_RECENT_BARS;
    const priorAvg = priorBars > 0 ? priorVol / priorBars : 0;
    if (priorAvg <= 0) continue;
    if (recentAvg / priorAvg >= VOLDIV_VOL_RATIO_MIN) out[i] = 1;
  }
  return out;
}

// ─── Per-bar sampling ────────────────────────────────────────────────────────

interface Sample {
  // composite component votes at bar i (0 or 1 each):
  htfVote: number;
  wyckoffVote: number;
  bbtcVote: number;
  verVote: number;
  amcVote: number;
  volDivVote: number;
  // forward returns observed AFTER bar i:
  fwd1d: number | null;
  fwd5d: number | null;
  fwd20d: number | null;
}

const STRATEGY_VOTE_FRESHNESS_BARS = 3; // a vote counts if the strategy fired ON OR WITHIN 3 bars before.

function buildSamples(symbol: string, bars: Bars): Sample[] {
  if (bars.close.length < 250) return [];

  // Per-bar indicator series.
  const rsi14 = computeRSISeries(bars.close, { period: RSI_PERIOD });
  const ema9 = computeEMA(bars.close, EMA_FAST);
  const ema21 = computeEMA(bars.close, EMA_MID);
  const ema50 = computeEMA(bars.close, EMA_SLOW);
  const atr14 = computeATR(bars.high, bars.low, bars.close, ATR_PERIOD);
  const bb = computeBollingerSeries(bars.close, BB_PERIOD, BB_STDDEV);
  const volAvg20 = computeVolAvg(bars.volume, VOLUME_MA_PERIOD);
  const histogram = computeMACDHistogram(bars.close);
  const vamiScaled = computeVAMIScaled(bars.close, bars.volume);
  const sma200 = computeSMA(bars.close, 200);
  const sma200Scaled = sma200.map(v => isNaN(v) ? NaN : v * 0.95);

  // Strategy signal series.
  const bbtc = computeBBTC({
    closes: bars.close, highs: bars.high, lows: bars.low,
    ema9, ema21, ema50, atr14, rsi14,
  });
  const ver = computeVER({
    closes: bars.close, highs: bars.high, lows: bars.low, volumes: bars.volume,
    rsi14, bbUpper: bb.upper, bbLower: bb.lower, volAvg20, atr14,
  });
  const amcScore = computeAMCSeries({
    closes: bars.close, histogram, rsi14,
    trendShortEma: ema9, trendLongEma: ema50, trendStrengthRefEma: ema21,
    vamiScaled, reversionRefLevel: sma200Scaled, reversionDirection: "above",
  });

  // HTF + Wyckoff Spring — pattern scanners return hits over the full series.
  // Both are causally safe: each hit's logic only considers bars on or before
  // the hit date, so indexing them as "was a hit at bar D?" introduces no
  // look-ahead bias.
  const ohlcv = barsToOHLCV(bars);
  const htfHits = scanHtf(ohlcv, symbol, { lookbackDays: bars.close.length });
  const wyckoffHits = scanWyckoffSpring(ohlcv, symbol, { lookbackDays: bars.close.length });

  // Map hit dates back to bar indices. Each set carries the freshness window
  // applied later — a strategy "vote" stays active for STRATEGY_VOTE_FRESHNESS_BARS
  // after firing so a 5-day-forward return still credits a fire from yesterday.
  const htfFireBars = new Set<number>();
  for (const h of htfHits) {
    const idx = bars.date.indexOf(h.breakoutDate.toISOString().slice(0, 10));
    if (idx >= 0) htfFireBars.add(idx);
  }
  const wyckoffFireBars = new Set<number>();
  for (const h of wyckoffHits) {
    const idx = bars.date.indexOf(h.breakoutDate.toISOString().slice(0, 10));
    if (idx >= 0) wyckoffFireBars.add(idx);
  }

  // Volume divergence (the candidate leading-input layer).
  const volDiv = computeVolumeDivergenceSeries(bars.close, bars.volume);

  // Sampling. Start AFTER warmup (sma200 needs 200 bars + small margin).
  // Stop at length-20 so all forward-20d returns are observable.
  const samples: Sample[] = [];
  const startIdx = 220;
  const endIdx = bars.close.length - 20;
  for (let i = startIdx; i <= endIdx; i++) {
    // Strategy vote: fired within the freshness window?
    let htfVote = 0;
    for (let k = 0; k < STRATEGY_VOTE_FRESHNESS_BARS; k++) {
      if (htfFireBars.has(i - k)) { htfVote = 1; break; }
    }
    let wyckoffVote = 0;
    for (let k = 0; k < STRATEGY_VOTE_FRESHNESS_BARS; k++) {
      if (wyckoffFireBars.has(i - k)) { wyckoffVote = 1; break; }
    }
    const bbtcVote = (bbtc.signals[i] === "BUY" && bbtc.signalSides[i] === "LONG") ? 1 : 0;
    const verVote = (ver.signals[i] === "BUY" && ver.signalSides[i] === "LONG") ? 1 : 0;
    const amcVote = amcScore[i] >= 3 ? 1 : 0;
    const volDivVote = volDiv[i] >= 1 ? 1 : 0;

    const c0 = bars.close[i];
    const c1 = bars.close[i + 1];
    const c5 = i + 5 < bars.close.length ? bars.close[i + 5] : null;
    const c20 = i + 20 < bars.close.length ? bars.close[i + 20] : null;

    samples.push({
      htfVote, wyckoffVote, bbtcVote, verVote, amcVote, volDivVote,
      fwd1d: c0 > 0 && c1 != null ? (c1 - c0) / c0 : null,
      fwd5d: c0 > 0 && c5 != null ? (c5 - c0) / c0 : null,
      fwd20d: c0 > 0 && c20 != null ? (c20 - c0) / c0 : null,
    });
  }
  return samples;
}

// ─── Composite scoring ──────────────────────────────────────────────────────
//
// Candidate A — strategy votes only. Score 0..5.
// Candidate B — strategy votes + volume divergence. Score 0..6.
//
// Equal weights for v0. Once a candidate clears the gate, the next iteration
// can weight by per-strategy historical quality. For now we want to know
// IF the leading-input adds edge, not its optimal weight.

function scoreA(s: Sample): number {
  return s.htfVote + s.wyckoffVote + s.bbtcVote + s.verVote + s.amcVote;
}
function scoreB(s: Sample): number {
  return scoreA(s) + s.volDivVote;
}

// ─── Aggregation ────────────────────────────────────────────────────────────

interface HorizonResult {
  horizon: "1d" | "5d" | "20d";
  samples: number;
  // Directional metrics across the full sample (baseline reference):
  baselineUpRate: number;          // fraction of all samples with fwd > 0
  baselineMeanReturnPct: number;   // mean fwd return across all samples
  // Top vs bottom decile by score:
  topDecileN: number;
  topDecileUpRate: number;         // PRIMARY: fraction of top-decile samples with fwd > 0
  topDecileMeanReturnPct: number;
  bottomDecileUpRate: number;
  bottomDecileMeanReturnPct: number;
  // Useful derived numbers:
  spreadPct: number;               // top - bottom mean return
  edgeOverBaseline: number;        // topDecileUpRate - baselineUpRate
}

function aggregateOne(samples: Sample[], scoreFn: (s: Sample) => number, horizon: "1d" | "5d" | "20d"): HorizonResult {
  const fwdKey: "fwd1d" | "fwd5d" | "fwd20d" =
    horizon === "1d" ? "fwd1d" : horizon === "5d" ? "fwd5d" : "fwd20d";

  const labeled: { score: number; fwd: number }[] = [];
  for (const s of samples) {
    const fwd = s[fwdKey];
    if (fwd == null) continue;
    labeled.push({ score: scoreFn(s), fwd });
  }

  const n = labeled.length;
  const baselineUpRate = n > 0 ? labeled.filter(x => x.fwd > 0).length / n : 0;
  const baselineMean = n > 0 ? labeled.reduce((a, x) => a + x.fwd, 0) / n : 0;

  labeled.sort((a, b) => a.score - b.score);
  const decileSize = Math.max(1, Math.floor(n / 10));
  const top = labeled.slice(-decileSize);
  const bot = labeled.slice(0, decileSize);

  const topUp = top.length > 0 ? top.filter(x => x.fwd > 0).length / top.length : 0;
  const botUp = bot.length > 0 ? bot.filter(x => x.fwd > 0).length / bot.length : 0;
  const topMean = top.length > 0 ? top.reduce((a, x) => a + x.fwd, 0) / top.length : 0;
  const botMean = bot.length > 0 ? bot.reduce((a, x) => a + x.fwd, 0) / bot.length : 0;

  return {
    horizon,
    samples: n,
    baselineUpRate: round4(baselineUpRate),
    baselineMeanReturnPct: round4(baselineMean * 100),
    topDecileN: top.length,
    topDecileUpRate: round4(topUp),
    topDecileMeanReturnPct: round4(topMean * 100),
    bottomDecileUpRate: round4(botUp),
    bottomDecileMeanReturnPct: round4(botMean * 100),
    spreadPct: round4((topMean - botMean) * 100),
    edgeOverBaseline: round4(topUp - baselineUpRate),
  };
}

function round4(x: number): number {
  return Number.isFinite(x) ? Number(x.toFixed(4)) : 0;
}

// ─── Top-level ──────────────────────────────────────────────────────────────

export interface PredictiveValidateResult {
  basket: { symbols: string[]; days: number };
  generatedAt: string;
  totalSamples: number;
  symbolsWithData: number;
  candidates: {
    A: { name: string; results: HorizonResult[] };
    B: { name: string; results: HorizonResult[] };
  };
  verdict: {
    gateThreshold: number;     // 0.55 (55% directional accuracy)
    horizonEvaluated: "5d";
    aPasses: boolean;
    bPasses: boolean;
    leadingInputAddsEdge: boolean;  // B's top-decile up-rate > A's top-decile up-rate
    nextStep: string;
  };
  notes: string[];
}

export async function runPredictiveValidate(symbols: string[], days: number): Promise<PredictiveValidateResult> {
  const BATCH = 12;
  const allSamples: Sample[] = [];
  let symbolsWithData = 0;

  for (let i = 0; i < symbols.length; i += BATCH) {
    const slice = symbols.slice(i, i + BATCH);
    const results = await Promise.allSettled(slice.map(async sym => {
      const bars = await fetchBars(sym, days);
      if (!bars) return null;
      return buildSamples(sym, bars);
    }));
    for (const r of results) {
      if (r.status !== "fulfilled" || !r.value || r.value.length === 0) continue;
      symbolsWithData++;
      allSamples.push(...r.value);
    }
  }

  const horizons: ("1d" | "5d" | "20d")[] = ["1d", "5d", "20d"];
  const aResults = horizons.map(h => aggregateOne(allSamples, scoreA, h));
  const bResults = horizons.map(h => aggregateOne(allSamples, scoreB, h));

  const aFiveD = aResults.find(r => r.horizon === "5d")!;
  const bFiveD = bResults.find(r => r.horizon === "5d")!;
  const aPasses = aFiveD.topDecileUpRate >= 0.55;
  const bPasses = bFiveD.topDecileUpRate >= 0.55;
  const leadingInputAddsEdge = bFiveD.topDecileUpRate > aFiveD.topDecileUpRate;

  let nextStep: string;
  if (bPasses && leadingInputAddsEdge) {
    nextStep = "Candidate B clears the gate AND volume divergence adds edge over A. Proceed to UI: build the predictive-score compartment + dashboard widget using the B formula.";
  } else if (aPasses && !leadingInputAddsEdge) {
    nextStep = "Candidate A clears the gate but volume divergence doesn't add edge. Either ship A as-is (without a leading layer) or queue the next leading input (options skew, then sentiment).";
  } else if (bPasses && !leadingInputAddsEdge) {
    nextStep = "Candidate B passes but only because A does — volume divergence isn't pulling its weight. Drop it and try the next leading input.";
  } else {
    nextStep = "Neither candidate clears 55% on 5d. Composite needs rework before any UI. Consider: weighting votes by per-strategy quality, adding insider conviction layer, or reducing vote granularity to BUY-only entries.";
  }

  return {
    basket: { symbols, days },
    generatedAt: new Date().toISOString(),
    totalSamples: allSamples.length,
    symbolsWithData,
    candidates: {
      A: { name: "Strategy votes only (HTF + Wyckoff + BBTC + VER + AMC)", results: aResults },
      B: { name: "A + volume divergence (leading-input layer)", results: bResults },
    },
    verdict: {
      gateThreshold: 0.55,
      horizonEvaluated: "5d",
      aPasses,
      bPasses,
      leadingInputAddsEdge,
      nextStep,
    },
    notes: [
      "Top-decile up-rate measures: of all samples with the highest composite score, what fraction had a positive forward return? 55%+ = real predictive edge.",
      "Strategy votes use a 3-bar freshness window — a fire on day D-2 still counts as a vote on day D so a 5d forward return can credit a recent setup.",
      "Volume divergence is binary: tight 10-bar range (<4%) with recent 5-bar vol ≥1.3× prior 5 bars.",
      "Insider conviction layer NOT included in v0 — adds a separate FMP fetch per ticker. Layer in if A+B don't clear the gate.",
    ],
  };
}
