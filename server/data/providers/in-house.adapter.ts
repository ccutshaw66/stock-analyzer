/**
 * In-house computed data.
 *
 * Implements capabilities we compute from raw price data rather than buying.
 * Currently: beta (vs SPY, 5y weekly, computed from Polygon aggregates).
 *
 * Formula:
 *   beta = cov(stockReturns, spyReturns) / var(spyReturns)
 *
 * Eliminates a Yahoo dependency and avoids paying a provider for a number
 * that is trivially derived from data we already have.
 */
import type { DataProvider, BetaValue, OHLCV, Symbol as Sym } from "../types";
import { polygonAdapter } from "./polygon.adapter";

const BENCHMARK: Sym = "SPY";
const LOOKBACK_YEARS = 5;

function pctReturns(bars: OHLCV[]): number[] {
  const rets: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1].c;
    const curr = bars[i].c;
    if (prev > 0) rets.push((curr - prev) / prev);
  }
  return rets;
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function covariance(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n === 0) return 0;
  const mx = mean(xs.slice(0, n));
  const my = mean(ys.slice(0, n));
  let s = 0;
  for (let i = 0; i < n; i++) s += (xs[i] - mx) * (ys[i] - my);
  return s / n;
}

function variance(xs: number[]): number {
  if (xs.length === 0) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return s / xs.length;
}

/**
 * Align two time series on date. Both inputs must come from the same source
 * and timespan so timestamps line up; this function drops anything that
 * doesn't match.
 */
function alignByDate(a: OHLCV[], b: OHLCV[]): { a: OHLCV[]; b: OHLCV[] } {
  const bMap = new Map<string, OHLCV>();
  for (const row of b) bMap.set(row.t.toISOString().slice(0, 10), row);
  const outA: OHLCV[] = [];
  const outB: OHLCV[] = [];
  for (const row of a) {
    const key = row.t.toISOString().slice(0, 10);
    const match = bMap.get(key);
    if (match) {
      outA.push(row);
      outB.push(match);
    }
  }
  return { a: outA, b: outB };
}

async function getBeta(symbol: Sym): Promise<BetaValue> {
  const T = symbol.toUpperCase();
  const to = new Date();
  const from = new Date(to);
  from.setFullYear(from.getFullYear() - LOOKBACK_YEARS);

  if (!polygonAdapter.getAggregates) {
    throw new Error("in_house:beta:polygon_aggregates_unavailable");
  }

  const [stockBars, spyBars] = await Promise.all([
    polygonAdapter.getAggregates(T, from, to, "week"),
    polygonAdapter.getAggregates(BENCHMARK, from, to, "week"),
  ]);

  if (stockBars.length < 26 || spyBars.length < 26) {
    // Need at least ~6 months of weekly data for a meaningful beta
    throw new Error(`in_house:beta:insufficient_data_${T}`);
  }

  const aligned = alignByDate(stockBars, spyBars);
  const stockRets = pctReturns(aligned.a);
  const spyRets = pctReturns(aligned.b);

  const cov = covariance(stockRets, spyRets);
  const varSpy = variance(spyRets);

  if (varSpy === 0) throw new Error(`in_house:beta:zero_benchmark_variance_${T}`);

  const beta = cov / varSpy;

  return {
    symbol: T,
    beta,
    lookbackYears: LOOKBACK_YEARS,
    benchmark: BENCHMARK,
    computedAt: new Date(),
    source: "in_house",
  };
}

export const inHouseAdapter: DataProvider = {
  name: "in_house",
  capabilities: ["beta"],
  getBeta,
};
