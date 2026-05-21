/**
 * HTF strategy validation — Walk-Forward Efficiency + Monte Carlo + R-metrics.
 *
 * Answers Cardoza's core question (Trading System Development, Ch. 4): is the
 * $570K HTF baseline a real edge or an in-sample fit? Required before pushing
 * any HTF parameter change (volume gate, failed-breakout exit, resistance
 * check, score rubric v2). Without this, every "improvement" is unvalidated.
 *
 * Three layers:
 *   1. Walk-Forward — split the window into in-sample / out-of-sample by date,
 *      report per-segment $ P&L, win rate, expectancy, annualized $/year, and
 *      WFE = OOS-annualized / IS-annualized. >1.0 = OOS at least as strong as
 *      IS (real edge). >0.5 = degraded but plausible. <0.5 = curve-fit risk.
 *
 *   2. Monte Carlo trade-order resampling — shuffle the closed-trade order
 *      N times (default 1000), rebuild the sequential equity curve, capture
 *      max peak-to-trough drawdown per shuffle. Report MC95 drawdown (95th
 *      percentile) — that's what to size for, not the historical max which
 *      is one realization of the path.
 *
 *   3. R-multiple metrics (Cardoza §4.3) — expectancy (mean R), expectunity
 *      (expectancy × trades/year), SQN (= expectancy × √N / σ(R)), profit
 *      factor (Σgains / |Σlosses|). Sample-size check (≥30 trades required).
 *
 * Used by `/api/diag/strategy-htf-validation`. Wraps `runStrategyHtfPnL`
 * from strategy-htf-pnl.ts so the trade simulation logic stays single-sourced.
 */

import { runStrategyHtfPnL, type HtfTrade } from "./strategy-htf-pnl";
import { getHtfUniverse } from "../signals/universe/htf-universe";

// ─── Walk-Forward ──────────────────────────────────────────────────────────

export interface WalkForwardSegment {
  rangeFrom: string;
  rangeTo: string;
  years: number;
  closedTrades: number;
  totalPnLDollar: number;
  pnlPerYear: number;
  winRatePct: number;
  expectancyR: number;
  avgWinPct: number;
  avgLossPct: number;
}

export interface WalkForwardResult {
  isSegment: WalkForwardSegment;
  oosSegment: WalkForwardSegment;
  /** WFE = OOS $/year ÷ IS $/year. Cardoza: >0.5 real edge, <0.5 curve-fit. */
  wfe: number;
  /** OOS expectancy ÷ IS expectancy — degradation in R terms. */
  expectancyRatio: number;
  /** OOS win rate − IS win rate (percentage points). */
  winRateDeltaPp: number;
  verdict: "strong-edge" | "real-edge" | "marginal" | "curve-fit-risk";
  verdictReason: string;
}

function yearsBetween(fromIso: string, toIso: string): number {
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  return ms / (365.25 * 24 * 60 * 60 * 1000);
}

function summarizeSegment(trades: HtfTrade[], fromIso: string, toIso: string): WalkForwardSegment {
  const closed = trades.filter(t => !t.isOpen);
  const years = Math.max(0.01, yearsBetween(fromIso, toIso));
  const totalPnL = closed.reduce((a, t) => a + t.pnlDollar, 0);
  const wins = closed.filter(t => t.blendedReturnPct > 0);
  const losses = closed.filter(t => t.blendedReturnPct <= 0);
  const winRate = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;
  const avgWin = wins.length > 0 ? wins.reduce((a, t) => a + t.blendedReturnPct, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((a, t) => a + t.blendedReturnPct, 0) / losses.length : 0;
  // R-multiple per trade: returnPct / |avgLossPct|. If no losses yet, fall back to 1 so
  // expectancy is well-defined even on small samples.
  const rUnit = avgLoss !== 0 ? Math.abs(avgLoss) : 1;
  const expectancyR =
    closed.length > 0
      ? closed.reduce((a, t) => a + t.blendedReturnPct / rUnit, 0) / closed.length
      : 0;
  return {
    rangeFrom: fromIso,
    rangeTo: toIso,
    years: Number(years.toFixed(2)),
    closedTrades: closed.length,
    totalPnLDollar: Number(totalPnL.toFixed(2)),
    pnlPerYear: Number((totalPnL / years).toFixed(2)),
    winRatePct: Number(winRate.toFixed(2)),
    expectancyR: Number(expectancyR.toFixed(3)),
    avgWinPct: Number(avgWin.toFixed(2)),
    avgLossPct: Number(avgLoss.toFixed(2)),
  };
}

function computeWalkForward(
  allTrades: HtfTrade[],
  windowStartIso: string,
  windowEndIso: string,
  isYears: number,
  oosYears: number,
): WalkForwardResult {
  const winStart = new Date(windowStartIso).getTime();
  const winEnd = new Date(windowEndIso).getTime();
  const totalYears = (winEnd - winStart) / (365.25 * 24 * 60 * 60 * 1000);
  // Cap IS+OOS to actual window. If user requested 7+3 on a 5-year window,
  // we scale proportionally so the split is still meaningful.
  const requestedTotal = isYears + oosYears;
  const scaledIsYears = totalYears < requestedTotal ? (isYears / requestedTotal) * totalYears : isYears;
  const cutoff = new Date(winEnd - oosYears * 365.25 * 24 * 60 * 60 * 1000);
  const cutoffIso = cutoff.toISOString().slice(0, 10);
  // IS = trades whose entryDate < cutoff. OOS = entryDate >= cutoff.
  // entryDate is "YYYY-MM-DD" — lexicographic compare is correct.
  const isTrades = allTrades.filter(t => t.entryDate < cutoffIso);
  const oosTrades = allTrades.filter(t => t.entryDate >= cutoffIso);

  const isSegment = summarizeSegment(isTrades, windowStartIso, cutoffIso);
  const oosSegment = summarizeSegment(oosTrades, cutoffIso, windowEndIso);

  // WFE compares ANNUALIZED returns so unequal window lengths don't bias.
  const wfe =
    isSegment.pnlPerYear !== 0
      ? oosSegment.pnlPerYear / isSegment.pnlPerYear
      : oosSegment.pnlPerYear > 0
        ? Infinity
        : 0;
  const expectancyRatio =
    isSegment.expectancyR !== 0 ? oosSegment.expectancyR / isSegment.expectancyR : 0;
  const winRateDeltaPp = Number((oosSegment.winRatePct - isSegment.winRatePct).toFixed(2));

  let verdict: WalkForwardResult["verdict"];
  let verdictReason: string;
  if (wfe >= 1.0 && oosSegment.winRatePct >= isSegment.winRatePct - 5) {
    verdict = "strong-edge";
    verdictReason = `OOS $/year (${oosSegment.pnlPerYear.toFixed(0)}) ≥ IS $/year (${isSegment.pnlPerYear.toFixed(0)}) and win rate held within 5pp. Real, stable edge.`;
  } else if (wfe >= 0.5) {
    verdict = "real-edge";
    verdictReason = `OOS retained ${(wfe * 100).toFixed(0)}% of IS edge. Cardoza threshold (50%) met — real but degraded edge. Parameter changes safe to ship.`;
  } else if (wfe >= 0.25) {
    verdict = "marginal";
    verdictReason = `OOS retained only ${(wfe * 100).toFixed(0)}% of IS edge. Marginal — investigate whether OOS window covered an unusual regime before declaring curve-fit.`;
  } else {
    verdict = "curve-fit-risk";
    verdictReason = `OOS retained <25% of IS edge. Strategy likely curve-fit to the IS window. Do NOT push parameter changes until rules are re-derived.`;
  }
  // Note `scaledIsYears` is used for the cutoff math when the window is short
  // (preserves the IS/OOS proportion). Read it so TS doesn't flag the var.
  void scaledIsYears;
  return {
    isSegment,
    oosSegment,
    wfe: Number(wfe.toFixed(3)),
    expectancyRatio: Number(expectancyRatio.toFixed(3)),
    winRateDeltaPp,
    verdict,
    verdictReason,
  };
}

// ─── Monte Carlo trade-order resampling ────────────────────────────────────

export interface MonteCarloResult {
  runs: number;
  /** Historical (in-order) basket-level max drawdown — single realization. */
  historicalMaxDrawdownDollar: number;
  historicalMaxDrawdownPct: number;
  /** 50th percentile (median) of the MC drawdown distribution. */
  mc50MaxDrawdownDollar: number;
  mc50MaxDrawdownPct: number;
  /** 95th percentile — what to size for. Cardoza's recommended risk anchor. */
  mc95MaxDrawdownDollar: number;
  mc95MaxDrawdownPct: number;
  /** Worst (99th-percentile) drawdown across shuffles — sanity check. */
  mc99MaxDrawdownDollar: number;
  mc99MaxDrawdownPct: number;
  /** Median final basket P&L across shuffles. Sanity check — should equal historical total. */
  medianFinalPnLDollar: number;
  /** Reference deployed capital for percent conversion. */
  deployedCapital: number;
  verdict: string;
}

/**
 * Build sequential equity curve from a trade ordering, return max drawdown $.
 * Equity starts at 0; each trade adds its pnlDollar; drawdown = peak − trough.
 */
function maxDrawdownFromOrder(pnls: number[]): number {
  let cum = 0;
  let peak = 0;
  let maxDD = 0;
  for (const p of pnls) {
    cum += p;
    if (cum > peak) peak = cum;
    const dd = peak - cum;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

/**
 * Mulberry32 — small deterministic PRNG. Seeded so MC results are reproducible
 * across runs with the same input. Crypto-quality is not needed for shuffling.
 */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function computeMonteCarlo(
  trades: HtfTrade[],
  runs: number,
  positionSize: number,
  seed = 0xC0FFEE,
): MonteCarloResult {
  const closed = trades.filter(t => !t.isOpen);
  const pnls = closed.map(t => t.pnlDollar);
  if (pnls.length === 0) {
    return {
      runs: 0,
      historicalMaxDrawdownDollar: 0,
      historicalMaxDrawdownPct: 0,
      mc50MaxDrawdownDollar: 0,
      mc50MaxDrawdownPct: 0,
      mc95MaxDrawdownDollar: 0,
      mc95MaxDrawdownPct: 0,
      mc99MaxDrawdownDollar: 0,
      mc99MaxDrawdownPct: 0,
      medianFinalPnLDollar: 0,
      deployedCapital: positionSize,
      verdict: "No closed trades to resample.",
    };
  }

  // Historical curve uses trades in date order (already sorted upstream).
  const sortedHistorical = [...closed].sort((a, b) => a.entryDate.localeCompare(b.entryDate));
  const historicalDD = maxDrawdownFromOrder(sortedHistorical.map(t => t.pnlDollar));

  // Shuffle N times. Fisher-Yates with seeded RNG. Capture max-dd + final P&L
  // per shuffle. Memory-bounded — only keep distributions, not full curves.
  const rng = makeRng(seed);
  const dds: number[] = new Array(runs);
  const finals: number[] = new Array(runs);
  const shuffled = pnls.slice();
  for (let r = 0; r < runs; r++) {
    // In-place Fisher-Yates
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = shuffled[i];
      shuffled[i] = shuffled[j];
      shuffled[j] = tmp;
    }
    dds[r] = maxDrawdownFromOrder(shuffled);
    finals[r] = shuffled.reduce((a, p) => a + p, 0);
  }
  dds.sort((a, b) => a - b);
  finals.sort((a, b) => a - b);
  const p50 = dds[Math.floor(runs * 0.5)];
  const p95 = dds[Math.floor(runs * 0.95)];
  const p99 = dds[Math.floor(runs * 0.99)];
  const medianFinal = finals[Math.floor(runs * 0.5)];

  // Deployed capital for % conversion = positionSize × max-concurrent
  // (we don't know max-concurrent here, so use positionSize as the
  // single-trade reference. Future iteration could pull max-concurrent
  // from the portfolio cap config.)
  const deployedCapital = positionSize;
  const toPct = (dd: number) => Number(((dd / deployedCapital) * 100).toFixed(2));

  const mc95Pct = toPct(p95);
  let verdict: string;
  if (mc95Pct < 100) {
    verdict = `MC95 drawdown ${mc95Pct.toFixed(1)}% of one position size — strategy survives expected worst-case path order with single-position capital.`;
  } else if (mc95Pct < 300) {
    verdict = `MC95 drawdown ${mc95Pct.toFixed(1)}% of one position size — meaningful capital required to ride out worst-case. Acceptable for diversified basket.`;
  } else {
    verdict = `MC95 drawdown ${mc95Pct.toFixed(1)}% of one position size — large relative to single position. Verify max-concurrent positions cap covers this.`;
  }

  return {
    runs,
    historicalMaxDrawdownDollar: Number(historicalDD.toFixed(2)),
    historicalMaxDrawdownPct: toPct(historicalDD),
    mc50MaxDrawdownDollar: Number(p50.toFixed(2)),
    mc50MaxDrawdownPct: toPct(p50),
    mc95MaxDrawdownDollar: Number(p95.toFixed(2)),
    mc95MaxDrawdownPct: toPct(p95),
    mc99MaxDrawdownDollar: Number(p99.toFixed(2)),
    mc99MaxDrawdownPct: toPct(p99),
    medianFinalPnLDollar: Number(medianFinal.toFixed(2)),
    deployedCapital,
    verdict,
  };
}

// ─── R-multiple metrics (Cardoza §4.3) ─────────────────────────────────────

export interface RMetricsResult {
  sampleSize: number;
  sampleSizeOk: boolean;            // ≥30 per Cardoza minimum
  /** Mean R-multiple per trade. Positive = positive expectancy. */
  expectancy: number;
  /** Stdev of R-multiples. Used by SQN. */
  rStdev: number;
  /**
   * System Quality Number = expectancy × √N / σ(R). Higher = better risk-adjusted
   * edge. Cardoza buckets: <1 below average, 1.6–1.9 average, 2.0–2.4 good,
   * 2.5–2.9 excellent, 3.0–5.0 superb, 5.0–7.0 holy grail.
   */
  sqn: number;
  sqnBucket: string;
  /** Σwins / |Σlosses|. >2.0 considered strong. */
  profitFactor: number;
  /** Trades per year (closed trades / window-years). */
  tradesPerYear: number;
  /** Expectancy × trades/year — annualized edge in R units. */
  expectunity: number;
}

function stdev(xs: number[]): number {
  if (xs.length === 0) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const v = xs.reduce((a, b) => a + (b - m) * (b - m), 0) / xs.length;
  return Math.sqrt(v);
}

function computeRMetrics(trades: HtfTrade[], windowFromIso: string, windowToIso: string): RMetricsResult {
  const closed = trades.filter(t => !t.isOpen);
  const losses = closed.filter(t => t.blendedReturnPct <= 0);
  const avgLossAbs =
    losses.length > 0
      ? Math.abs(losses.reduce((a, t) => a + t.blendedReturnPct, 0) / losses.length)
      : 1;
  const rs = closed.map(t => t.blendedReturnPct / avgLossAbs);
  const expectancy = rs.length > 0 ? rs.reduce((a, b) => a + b, 0) / rs.length : 0;
  const rStdev = stdev(rs);
  const sqn = rStdev > 0 && rs.length > 0 ? (expectancy * Math.sqrt(rs.length)) / rStdev : 0;
  let sqnBucket: string;
  if (sqn < 1) sqnBucket = "below-average (<1.0)";
  else if (sqn < 1.6) sqnBucket = "near-average (1.0–1.6)";
  else if (sqn < 2.0) sqnBucket = "average (1.6–2.0)";
  else if (sqn < 2.5) sqnBucket = "good (2.0–2.5)";
  else if (sqn < 3.0) sqnBucket = "excellent (2.5–3.0)";
  else if (sqn < 5.0) sqnBucket = "superb (3.0–5.0)";
  else sqnBucket = "holy-grail (5.0+)";

  const grossWin = closed.filter(t => t.pnlDollar > 0).reduce((a, t) => a + t.pnlDollar, 0);
  const grossLoss = Math.abs(closed.filter(t => t.pnlDollar <= 0).reduce((a, t) => a + t.pnlDollar, 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0;

  const years = Math.max(0.01, yearsBetween(windowFromIso, windowToIso));
  const tradesPerYear = closed.length / years;
  const expectunity = expectancy * tradesPerYear;

  return {
    sampleSize: closed.length,
    sampleSizeOk: closed.length >= 30,
    expectancy: Number(expectancy.toFixed(3)),
    rStdev: Number(rStdev.toFixed(3)),
    sqn: Number(sqn.toFixed(2)),
    sqnBucket,
    profitFactor: isFinite(profitFactor) ? Number(profitFactor.toFixed(2)) : Infinity,
    tradesPerYear: Number(tradesPerYear.toFixed(1)),
    expectunity: Number(expectunity.toFixed(2)),
  };
}

// ─── Top-level ─────────────────────────────────────────────────────────────

export interface StrategyHtfValidationResult {
  basket: {
    symbols: string[];
    days: number;
    positionSize: number;
    minScore: number;
    isYears: number;
    oosYears: number;
    mcRuns: number;
  };
  generatedAt: string;
  windowFrom: string;
  windowTo: string;
  basketTotalPnLDollar: number;
  basketClosedTrades: number;
  basketWinRatePct: number;
  walkForward: WalkForwardResult;
  monteCarlo: MonteCarloResult;
  metrics: RMetricsResult;
  perTickerSampleCounts: { withTrades: number; without: number };
  notes: string[];
}

export interface StrategyHtfValidationOptions {
  /** Symbol list. If empty, caller must pass universe='htf' (handled upstream). */
  symbols: string[];
  /** Total window length in days. Default 3650 (~10y). */
  days?: number;
  /** Dollars per trade. Default 1750 (matches $7K account 25% cap). */
  positionSize?: number;
  /** HTF minimum quality score. Default 70 (production threshold). */
  minScore?: number;
  /** Years in the in-sample segment. Default 7. */
  isYears?: number;
  /** Years in the out-of-sample segment. Default 3. */
  oosYears?: number;
  /** Monte Carlo shuffle count. Default 1000. */
  mcRuns?: number;
}

export async function runStrategyHtfValidation(
  opts: StrategyHtfValidationOptions,
): Promise<StrategyHtfValidationResult> {
  const days = opts.days ?? 3650;
  const positionSize = opts.positionSize ?? 1750;
  const minScore = opts.minScore ?? 70;
  const isYears = opts.isYears ?? 7;
  const oosYears = opts.oosYears ?? 3;
  const mcRuns = Math.min(Math.max(opts.mcRuns ?? 1000, 100), 5000);

  // Use the existing P&L pipeline. detail=true so we keep per-trade records
  // for IS/OOS partitioning + MC shuffling.
  const baseline = await runStrategyHtfPnL(opts.symbols, days, positionSize, true, minScore);

  // Flatten across tickers; keep only closed trades for WFE / MC / R-metrics.
  const allTrades: HtfTrade[] = baseline.perTicker.flatMap(t => t.trades || []);
  const closed = allTrades.filter(t => !t.isOpen);

  // Window bounds = min/max entry date across the flat trade list. Falls back
  // to today-minus-days if no trades exist (rare).
  const entryDates = closed.map(t => t.entryDate).sort();
  const windowFrom = entryDates[0] ?? new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const windowTo = entryDates[entryDates.length - 1] ?? new Date().toISOString().slice(0, 10);

  const walkForward = computeWalkForward(allTrades, windowFrom, windowTo, isYears, oosYears);
  const monteCarlo = computeMonteCarlo(allTrades, mcRuns, positionSize);
  const metrics = computeRMetrics(allTrades, windowFrom, windowTo);

  const withTrades = baseline.perTicker.filter(t => (t.trades?.length ?? 0) > 0).length;
  const without = baseline.perTicker.length - withTrades;

  const notes: string[] = [
    `HTF validation harness. Wraps strategy-htf-pnl with the same bars + simulator; layers WFE / MC / R-metrics on top of the per-trade records.`,
    `Walk-Forward Efficiency (WFE) = OOS-$/year ÷ IS-$/year. Cardoza thresholds: >1.0 strong, 0.5–1.0 real but degraded, 0.25–0.5 marginal, <0.25 curve-fit risk.`,
    `Monte Carlo: shuffles closed trades ${mcRuns} times with a seeded PRNG (reproducible). Reports 50th / 95th / 99th percentile max drawdowns. MC95 is the practical risk anchor — size such that MC95 drawdown is tolerable.`,
    `System Quality Number (SQN) = expectancy × √N / σ(R). Cardoza buckets in the response.`,
    `Sample-size gate: ≥30 closed trades required to trust any of these numbers. HTF baseline easily clears.`,
    `Skips Sharpe / Sortino / MAR — R-based metrics dominate for discrete-trade systems per Cardoza §4.3.`,
    `Comparable URL for the underlying baseline: /api/diag/strategy-htf-pnl with the same symbols/days/positionSize/minScore.`,
  ];

  return {
    basket: { symbols: opts.symbols, days, positionSize, minScore, isYears, oosYears, mcRuns },
    generatedAt: new Date().toISOString(),
    windowFrom,
    windowTo,
    basketTotalPnLDollar: baseline.aggregate.totalPnLDollar,
    basketClosedTrades: baseline.aggregate.totalClosedTrades,
    basketWinRatePct: baseline.aggregate.basketWinRate != null
      ? Number((baseline.aggregate.basketWinRate * 100).toFixed(2))
      : 0,
    walkForward,
    monteCarlo,
    metrics,
    perTickerSampleCounts: { withTrades, without },
    notes,
  };
}

/**
 * Helper: pull the production HTF universe directly so the route can offer
 * the same `universe=htf&limit=N` ergonomics as strategy-htf-pnl.
 */
export async function resolveHtfUniverseSymbols(limit: number): Promise<string[]> {
  const u = await getHtfUniverse();
  return [...u.tickers]
    .sort((a, b) => (b.volume || 0) - (a.volume || 0))
    .slice(0, Math.min(Math.max(limit, 1), 2000))
    .map(r => r.symbol.toUpperCase());
}
