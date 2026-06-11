/**
 * Conviction Compass data pipeline.
 *
 * Gathers everything the compute function needs:
 *   - CompanySnapshot (ownership + insider + fundamentals + quote)
 *   - MMExposure (gamma, dex, walls, put/call from Polygon Options)
 *   - Technical indicators computed off a 1y daily chart
 *   - The 8-factor verdict score (computed inline from the snapshot's
 *     quote+fundamentals+returns)
 *
 * Each input is fail-soft: missing data downgrades the affected axis but
 * doesn't fail the whole compass. Confidence in the response reflects
 * which axes had real inputs vs. were skipped.
 */

import type { OHLCV } from "../data/types";
import type { CompanySnapshot } from "../snapshot/types";
import { getCompanySnapshot } from "../snapshot";
import { getChartSnapshot } from "../snapshot/chart";
import { computeMMExposure } from "../mm-exposure";
import { computeRSI, computeBollinger, computeMACD } from "../indicators";
import { RSI_PERIOD, BB_PERIOD, BB_STDDEV } from "@shared/indicators/constants";
import {
  computeConvictionCompass,
  type ConvictionCompass,
  type MmExposureInput,
  type TechnicalInput,
} from "./compass";

// In-process orchestrator cache: 5 min, same as snapshot quote TTL
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { value: ConvictionCompass; expiresAt: number }>();

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Convert a chart series (timestamp[], indicators.quote[0].close[]) into
 *  the OHLCV[] shape the existing indicators package expects. */
function chartSeriesToOhlcv(chart: any): OHLCV[] {
  const ts: number[] = chart?.timestamp ?? [];
  const q = chart?.indicators?.quote?.[0] ?? {};
  const opens: number[] = q.open ?? [];
  const highs: number[] = q.high ?? [];
  const lows: number[] = q.low ?? [];
  const closes: number[] = q.close ?? [];
  const volumes: number[] = q.volume ?? [];

  const out: OHLCV[] = [];
  for (let i = 0; i < ts.length; i++) {
    const c = Number(closes[i]);
    if (!Number.isFinite(c)) continue;
    out.push({
      t: new Date(ts[i] * 1000),
      o: Number(opens[i]) || c,
      h: Number(highs[i]) || c,
      l: Number(lows[i]) || c,
      c,
      v: Number(volumes[i]) || 0,
    });
  }
  return out;
}

/** Single-pass EMA over a closed series. */
function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = values[0];
  for (let i = 0; i < values.length; i++) {
    prev = i === 0 ? values[0] : values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

/** Compute the technical inputs the compass needs from an OHLCV series. */
function deriveTechnicals(bars: OHLCV[]): TechnicalInput | null {
  if (bars.length < 60) return null;
  const closes = bars.map(b => b.c);
  const lastClose = closes[closes.length - 1];

  let rsi14: number | null = null;
  try { rsi14 = computeRSI(bars, { period: RSI_PERIOD }); } catch { /* ignore */ }

  let macdHistogram: number | null = null;
  try { macdHistogram = computeMACD(bars)?.histogram ?? null; } catch { /* ignore */ }

  const bb = computeBollinger(bars, BB_PERIOD, BB_STDDEV);
  let pctB: number | null = null;
  if (bb) {
    const range = bb.upper - bb.lower;
    pctB = range > 0 ? (lastClose - bb.lower) / range : 0.5;
  }

  const ema9Series = ema(closes, 9);
  const ema21Series = ema(closes, 21);
  const ema50Series = ema(closes, 50);
  const ema9 = ema9Series[ema9Series.length - 1] ?? null;
  const ema21 = ema21Series[ema21Series.length - 1] ?? null;
  const ema50 = ema50Series[ema50Series.length - 1] ?? null;

  return {
    rsi14: rsi14 !== null && Number.isFinite(rsi14) ? rsi14 : null,
    macdHistogram,
    ema9,
    ema21,
    ema50,
    bollingerPctB: pctB,
    spotPrice: lastClose,
  };
}

/** Map MMExposure → compass MmExposureInput, finding put-wall as the
 *  most-negative GEX strike. */
function mmExposureToInput(mm: Awaited<ReturnType<typeof computeMMExposure>>): MmExposureInput | null {
  if (!mm) return null;
  const negStrikes = (mm.gexByStrike ?? [])
    .filter(s => s.gex < 0)
    .sort((a, b) => a.gex - b.gex);
  const putWall = negStrikes.length ? negStrikes[0].strike : null;

  return {
    gex: mm.totalGEX ?? null,
    dex: mm.totalDEX ?? null,
    putCallOi: mm.putCallOI ?? null,
    putCallVol: mm.putCallVolume ?? null,
    spotPrice: mm.spot ?? null,
    callWall: mm.gammaWall ?? null,
    putWall,
  };
}

// ─── 8-factor verdict score (mirror of routes.ts computeScoring) ──────────
//
// We re-derive the verdict score here from snapshot fields rather than
// reaching into routes.ts to keep this module decoupled. Same thresholds,
// same weights — change them in lockstep if the routes.ts version is
// updated in the future.

function clamp(n: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, n)); }
function safe(n: number | null | undefined): number | null {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return null;
  return Number(n);
}

function computeVerdictScoreFromSnapshot(snap: CompanySnapshot): number | null {
  const q = snap.quote.value;
  const f = snap.fundamentals.value;
  const r = snap.returns.value;
  if (!q && !f && !r) return null;

  // 1. Income Strength (15%)
  const divYield = safe(q?.dividendYield);
  let income = 5;
  if (divYield !== null) {
    if (divYield > 4) income = 9;
    else if (divYield > 2.5) income = 7;
    else if (divYield > 1) income = 5;
    else if (divYield > 0) income = 3;
    else income = 2;
  } else income = 2;

  // 2. Income Quality (15%)
  const payout = safe(f?.payoutRatio);
  let incomeQuality = 5;
  if (payout !== null) {
    if (payout > 0 && payout < 50) incomeQuality = 9;
    else if (payout >= 50 && payout < 75) incomeQuality = 7;
    else if (payout >= 75 && payout < 100) incomeQuality = 5;
    else if (payout >= 100) incomeQuality = 3;
    else incomeQuality = 4;
  }

  // 3. Business Quality (15%)
  let business = 5;
  const revGrowth = safe(f?.revenueGrowth);
  const grossMargin = safe(f?.grossMargin);
  if (revGrowth !== null && revGrowth > 10) business += 2;
  else if (revGrowth !== null && revGrowth > 0) business += 1;
  else if (revGrowth !== null && revGrowth < -5) business -= 2;
  if (grossMargin !== null && grossMargin > 40) business += 2;
  else if (grossMargin !== null && grossMargin > 20) business += 1;
  business = clamp(business, 1, 10);

  // 4. Balance Sheet (15%)
  let balance = 5;
  const dToE = safe(f?.debtToEquity);
  const currentRatio = safe(f?.currentRatio);
  if (dToE !== null) {
    if (dToE < 30) balance += 2;
    else if (dToE < 80) balance += 1;
    else if (dToE > 150) balance -= 2;
    else if (dToE > 100) balance -= 1;
  }
  if (currentRatio !== null) {
    if (currentRatio > 2) balance += 1;
    else if (currentRatio < 1) balance -= 1;
  }
  balance = clamp(balance, 1, 10);

  // 5. Performance (15%)
  let performance = 5;
  const ret1y = r?.oneYear ?? null;
  const ret3y = r?.threeYear ?? null;
  if (ret1y !== null) {
    if (ret1y > 20) performance += 2;
    else if (ret1y > 5) performance += 1;
    else if (ret1y < -10) performance -= 2;
    else if (ret1y < 0) performance -= 1;
  }
  if (ret3y !== null) {
    if (ret3y > 50) performance += 1;
    else if (ret3y < -10) performance -= 1;
  }
  performance = clamp(performance, 1, 10);

  // 6. Valuation (10%)
  let valuation = 5;
  const pe = safe(q?.trailingPE);
  const fwdPe = safe(q?.forwardPE);
  if (pe !== null) {
    if (pe < 0) valuation = 3;
    else if (pe < 12) valuation = 9;
    else if (pe < 20) valuation = 7;
    else if (pe < 30) valuation = 5;
    else if (pe < 50) valuation = 4;
    else valuation = 2;
  }
  if (fwdPe !== null && pe !== null && fwdPe < pe) valuation = clamp(valuation + 1, 1, 10);

  // 7. Liquidity (5%)
  let liquidity = 5;
  const mcap = safe(q?.marketCap);
  const avgVol = safe(q?.averageVolume);
  if (mcap !== null) {
    if (mcap > 100e9) liquidity += 2;
    else if (mcap > 10e9) liquidity += 1;
    else if (mcap < 1e9) liquidity -= 1;
    else if (mcap < 300e6) liquidity -= 2;
  }
  if (avgVol !== null) {
    if (avgVol > 5e6) liquidity += 1;
    else if (avgVol < 100e3) liquidity -= 1;
  }
  liquidity = clamp(liquidity, 1, 10);

  // 8. Thesis Durability (10%)
  let thesis = 5;
  const beta = safe(q?.beta);
  if (beta !== null) {
    if (beta < 0.8) thesis += 1;
    else if (beta > 1.5) thesis -= 1;
  }
  if (revGrowth !== null && revGrowth > 5) thesis += 1;
  if (dToE !== null && dToE < 50) thesis += 1;
  if (divYield !== null && divYield > 2) thesis += 1;
  thesis = clamp(thesis, 1, 10);

  const weighted =
    income * 0.15 +
    incomeQuality * 0.15 +
    business * 0.15 +
    balance * 0.15 +
    performance * 0.15 +
    valuation * 0.10 +
    liquidity * 0.05 +
    thesis * 0.10;

  return Number(weighted.toFixed(2));
}

// ─── Public entry ──────────────────────────────────────────────────────────

export interface GetConvictionOpts {
  forceRefresh?: boolean;
}

export async function getConvictionCompass(
  ticker: string,
  opts: GetConvictionOpts,
): Promise<ConvictionCompass> {
  const T = ticker.toUpperCase();

  if (!opts.forceRefresh) {
    const cached = cache.get(T);
    if (cached && Date.now() < cached.expiresAt) return cached.value;
  }

  // All four input streams in parallel — failures are fail-soft.
  const [snapshot, mmRaw, chart] = await Promise.all([
    getCompanySnapshot(T, {
      forceRefresh: opts.forceRefresh,
    }),
    computeMMExposure(T).catch(() => null),
    getChartSnapshot(T, "1y", "1d").catch(() => null),
  ]);

  const bars = chart?.value ? chartSeriesToOhlcv(chart.value) : [];
  const tech = bars.length >= 60 ? deriveTechnicals(bars) : null;
  const mm = mmExposureToInput(mmRaw);
  const fundamentalScore = computeVerdictScoreFromSnapshot(snapshot);

  const compass = computeConvictionCompass({
    snapshot,
    mm,
    tech,
    fundamentalScore0to10: fundamentalScore,
  });

  cache.set(T, { value: compass, expiresAt: Date.now() + CACHE_TTL_MS });
  return compass;
}
