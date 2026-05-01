/**
 * Conviction Compass backtest aggregator.
 *
 * Pure SQL aggregations over the compass_snapshots table. Group every
 * snapshot by its verdict class, average each forward-return column,
 * compute win rate (% of rows with positive return) and median.
 *
 * Compared against the SPY baseline aggregated over the same date set,
 * so consumers can see "ALL_ALIGNED_BULLISH 30d-return: 4.2% vs SPY 1.8%
 * over the same 142 trading days."
 *
 * Empty-state aware — early on we have very few rows, so the response
 * includes the row count per bucket and the consumer is responsible for
 * deciding whether the sample is big enough to surface.
 */

import { sql } from "drizzle-orm";
import { db } from "../storage";

export type Verdict =
  | "ALL_ALIGNED_BULLISH"
  | "MOSTLY_BULLISH"
  | "DIVERGENT"
  | "MOSTLY_BEARISH"
  | "ALL_ALIGNED_BEARISH"
  | "WEAK_SIGNAL";

export interface VerdictReturnStats {
  verdict: Verdict;
  count: number;
  avgReturn1d: number | null;
  avgReturn5d: number | null;
  avgReturn30d: number | null;
  avgReturn90d: number | null;
  winRate30d: number | null; // 0..1, fraction of rows with return_30d > 0
}

export interface SpyBaselineStats {
  avgReturn1d: number | null;
  avgReturn5d: number | null;
  avgReturn30d: number | null;
  avgReturn90d: number | null;
}

export interface BacktestResult {
  totalSnapshots: number;
  earliestDate: string | null;
  latestDate: string | null;
  byVerdict: VerdictReturnStats[];
  spy: SpyBaselineStats;
  pendingForwardReturns: { d1: number; d5: number; d30: number; d90: number };
}

export async function getBacktestResults(): Promise<BacktestResult> {
  // Header stats
  const headerRes: any = await db.execute(sql`
    SELECT
      COUNT(*)::int AS total,
      MIN(taken_date) AS earliest,
      MAX(taken_date) AS latest,
      SUM(CASE WHEN return_1d  IS NULL THEN 1 ELSE 0 END)::int AS pending_1d,
      SUM(CASE WHEN return_5d  IS NULL THEN 1 ELSE 0 END)::int AS pending_5d,
      SUM(CASE WHEN return_30d IS NULL THEN 1 ELSE 0 END)::int AS pending_30d,
      SUM(CASE WHEN return_90d IS NULL THEN 1 ELSE 0 END)::int AS pending_90d
    FROM compass_snapshots
  `);
  const header = (headerRes as any).rows?.[0] ?? {};

  // Per-verdict aggregates
  const verdictRes: any = await db.execute(sql`
    SELECT
      verdict,
      COUNT(*)::int                                         AS count,
      AVG(return_1d)::float8                                AS avg_1d,
      AVG(return_5d)::float8                                AS avg_5d,
      AVG(return_30d)::float8                               AS avg_30d,
      AVG(return_90d)::float8                               AS avg_90d,
      AVG(CASE WHEN return_30d > 0 THEN 1.0
               WHEN return_30d IS NULL THEN NULL
               ELSE 0.0 END)::float8                        AS win_rate_30d
    FROM compass_snapshots
    GROUP BY verdict
    ORDER BY verdict
  `);

  const byVerdict: VerdictReturnStats[] = ((verdictRes as any).rows ?? []).map((r: any) => ({
    verdict: r.verdict as Verdict,
    count: Number(r.count) || 0,
    avgReturn1d: r.avg_1d != null ? Number(r.avg_1d) : null,
    avgReturn5d: r.avg_5d != null ? Number(r.avg_5d) : null,
    avgReturn30d: r.avg_30d != null ? Number(r.avg_30d) : null,
    avgReturn90d: r.avg_90d != null ? Number(r.avg_90d) : null,
    winRate30d: r.win_rate_30d != null ? Number(r.win_rate_30d) : null,
  }));

  // SPY baseline averaged over the same date range as the snapshots above
  const spyRes: any = await db.execute(sql`
    SELECT
      AVG(return_1d)::float8  AS avg_1d,
      AVG(return_5d)::float8  AS avg_5d,
      AVG(return_30d)::float8 AS avg_30d,
      AVG(return_90d)::float8 AS avg_90d
    FROM spy_baseline_returns
    WHERE taken_date IN (SELECT DISTINCT taken_date FROM compass_snapshots)
  `);
  const spy = (spyRes as any).rows?.[0] ?? {};

  return {
    totalSnapshots: Number(header.total) || 0,
    earliestDate: header.earliest ?? null,
    latestDate: header.latest ?? null,
    byVerdict,
    spy: {
      avgReturn1d: spy.avg_1d != null ? Number(spy.avg_1d) : null,
      avgReturn5d: spy.avg_5d != null ? Number(spy.avg_5d) : null,
      avgReturn30d: spy.avg_30d != null ? Number(spy.avg_30d) : null,
      avgReturn90d: spy.avg_90d != null ? Number(spy.avg_90d) : null,
    },
    pendingForwardReturns: {
      d1:  Number(header.pending_1d)  || 0,
      d5:  Number(header.pending_5d)  || 0,
      d30: Number(header.pending_30d) || 0,
      d90: Number(header.pending_90d) || 0,
    },
  };
}
