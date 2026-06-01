/**
 * Unified scanner engine — pure + deterministic.
 *
 * Runs each selected strategy's live detector over a ticker's bars and returns
 * scored ScanHits. Only strategies with a genuine 0–100 quality score are wired
 * here (HTF, Rounding Bottom, Wyckoff Spring, Pipe Bottom — native qualityScore;
 * AMC — scoreAMC 0–5 mapped ×20). BBTC/VER are binary signals with no quality
 * grade and are intentionally absent until a scoring rubric exists.
 *
 * No I/O — the caller fetches bars and passes universe rows in.
 */

import type { OHLCV } from "../../data/types";
import type { ScanHit } from "@shared/scanner/types";
import { MIN_GREEN } from "@shared/scanner/types";
import { scanHtf } from "../../signals/strategies/htf";
import { scanRoundingBottom } from "../../signals/strategies/rounding-bottom";
import { scanWyckoffSpring } from "../../signals/strategies/wyckoff-spring";
import { scanPipeBottom } from "../../signals/strategies/pipe-bottom";
import { scoreAMC } from "../../signals/strategies/amc";
import { computeRSISeries } from "../../indicators/rsi";
import {
  RSI_PERIOD, ATR_PERIOD, EMA_FAST, EMA_MID, EMA_SLOW,
} from "@shared/indicators/constants";

const FRESHNESS_BARS = 3;        // a hit counts if it fired within the last N bars
const DAY_MS = 86_400_000;

export interface UniverseRow {
  symbol: string;
  companyName: string;
  marketCap: number;
  sector: string;
  price: number;
}

interface RawHit {
  strategyId: string;
  score: number;
  direction: "long" | "short";
  entry: number;
  stop: number;
  target: number;
  asOf: Date;
}

type DetectorFn = (bars: OHLCV[], symbol: string) => RawHit[];

// ─── Pattern detectors (native 0–100 qualityScore) ─────────────────────────
const PATTERN_ADAPTERS: Record<string, DetectorFn> = {
  "htf": (b, s) => scanHtf(b, s, { lookbackDays: b.length }).map(h => ({
    strategyId: "htf", score: h.qualityScore, direction: "long",
    entry: h.breakoutPrice, stop: h.stopPrice, target: h.targetPrice, asOf: h.breakoutDate,
  })),
  "rounding-bottom": (b, s) => scanRoundingBottom(b, s, { lookbackDays: b.length }).map(h => ({
    strategyId: "rounding-bottom", score: h.qualityScore, direction: "long",
    entry: h.breakoutPrice, stop: h.stopPrice, target: h.targetPrice, asOf: h.breakoutDate,
  })),
  "wyckoff-spring": (b, s) => scanWyckoffSpring(b, s, { lookbackDays: b.length }).map(h => ({
    strategyId: "wyckoff-spring", score: h.qualityScore, direction: "long",
    entry: h.breakoutPrice, stop: h.stopPrice, target: h.targetPrice, asOf: h.breakoutDate,
  })),
  "pipe-bottom": (b, s) => scanPipeBottom(b, s, { lookbackWeeks: 104 }).map(h => ({
    strategyId: "pipe-bottom", score: h.qualityScore, direction: "long",
    entry: h.breakoutPrice, stop: h.stopPrice, target: h.targetPrice, asOf: h.breakoutDate,
  })),
};

// ─── Indicator helpers (inlined to match the diag/* family pattern) ────────
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

function computeMACDHistogram(closes: number[]): number[] {
  const ema12 = computeEMA(closes, 12);
  const ema26 = computeEMA(closes, 26);
  const macdLine = closes.map((_, i) =>
    !isNaN(ema12[i]) && !isNaN(ema26[i]) ? ema12[i] - ema26[i] : NaN);
  const validMacd: number[] = [];
  const validIdx: number[] = [];
  macdLine.forEach((v, i) => { if (!isNaN(v)) { validMacd.push(v); validIdx.push(i); } });
  const sigEma = computeEMA(validMacd, 9);
  const signal = new Array(closes.length).fill(NaN);
  validIdx.forEach((idx, j) => { signal[idx] = sigEma[j]; });
  return closes.map((_, i) =>
    !isNaN(macdLine[i]) && !isNaN(signal[i]) ? macdLine[i] - signal[i] : NaN);
}

function computeVAMIScaled(closes: number[], volumes: number[]): number[] {
  const vami = new Array(closes.length).fill(0);
  const avgVol20 = computeSMA(volumes.map(v => v || 0), 20);
  const k = 2 / (12 + 1);
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] === 0 || isNaN(avgVol20[i]) || avgVol20[i] === 0) continue;
    const ret = ((closes[i] - closes[i - 1]) / closes[i - 1]) * 100;
    const vr = Math.min(2.5, Math.max(0.5, volumes[i] / avgVol20[i]));
    vami[i] = (ret * vr) * k + vami[i - 1] * (1 - k);
  }
  return vami.map(v => v * 8);
}

// ─── AMC adapter (scoreAMC 0–5 → ×20 = 0–100; momentum entry = 4 ⇒ 80) ─────
function computeAmcHits(bars: OHLCV[], _symbol: string): RawHit[] {
  const closes = bars.map(b => b.c);
  const highs = bars.map(b => b.h);
  const lows = bars.map(b => b.l);
  const vols = bars.map(b => b.v);
  const rsi14 = computeRSISeries(closes, { period: RSI_PERIOD });
  const ema9 = computeEMA(closes, EMA_FAST);
  const ema21 = computeEMA(closes, EMA_MID);
  const ema50 = computeEMA(closes, EMA_SLOW);
  const histogram = computeMACDHistogram(closes);
  const vamiScaled = computeVAMIScaled(closes, vols);
  const sma200 = computeSMA(closes, 200);
  const sma200Scaled = sma200.map(v => isNaN(v) ? NaN : v * 0.95);
  void highs; void lows; void ATR_PERIOD; // ATR not needed for AMC score

  const input = {
    closes, histogram, rsi14,
    trendShortEma: ema9, trendLongEma: ema50, trendStrengthRefEma: ema21,
    vamiScaled, reversionRefLevel: sma200Scaled, reversionDirection: "above" as const,
  };

  const hits: RawHit[] = [];
  for (let i = 1; i < closes.length; i++) {
    const s = scoreAMC(i, input);
    const greenClose = closes[i] > (bars[i].o ?? closes[i]);
    if (s >= 4 && greenClose) {
      const entry = closes[i];
      hits.push({
        strategyId: "amc",
        score: Math.min(100, s * 20),
        direction: "long",
        entry,
        stop: entry * 0.92,
        target: entry * 1.20,
        asOf: bars[i].t,
      });
    }
  }
  return hits;
}

function indicatorAdapterFor(id: string): DetectorFn | null {
  if (id === "amc") return computeAmcHits;
  return null;
}

/**
 * Scan one ticker for the selected strategies; return the single most-recent
 * green-grade (≥ MIN_GREEN) hit per strategy within the freshness window.
 */
export function scanOne(
  bars: OHLCV[],
  row: UniverseRow,
  strategyIds: string[],
  labelOf: (id: string) => string,
): ScanHit[] {
  if (bars.length < 250) return [];
  const now = bars[bars.length - 1].t.getTime();
  const out: ScanHit[] = [];
  for (const id of strategyIds) {
    const adapter = PATTERN_ADAPTERS[id] ?? indicatorAdapterFor(id);
    if (!adapter) continue;
    const fresh = adapter(bars, row.symbol)
      .filter(h => (now - h.asOf.getTime()) <= FRESHNESS_BARS * DAY_MS)
      .sort((a, b) => b.asOf.getTime() - a.asOf.getTime());
    const latest = fresh[0];
    if (!latest || latest.score < MIN_GREEN) continue;
    out.push({
      symbol: row.symbol,
      companyName: row.companyName,
      strategyId: id,
      strategyLabel: labelOf(id),
      score: Math.round(latest.score),
      direction: latest.direction,
      entry: Number(latest.entry.toFixed(4)),
      stop: Number(latest.stop.toFixed(4)),
      target: Number(latest.target.toFixed(4)),
      price: row.price,
      marketCap: row.marketCap,
      sector: row.sector,
      asOf: latest.asOf.toISOString().slice(0, 10),
    });
  }
  return out;
}

/** Filter to ≥ minScore (floored at MIN_GREEN), sort best-first, take top-N. */
export function rankHits(hits: ScanHit[], minScore: number, topN: number): ScanHit[] {
  const floor = Math.max(minScore, MIN_GREEN);
  return hits
    .filter(h => h.score >= floor)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}

/** Strategy ids the engine can actually run a live detector for. */
export const SCANNABLE_ENGINE_IDS = [
  "htf", "rounding-bottom", "wyckoff-spring", "pipe-bottom", "amc",
];
