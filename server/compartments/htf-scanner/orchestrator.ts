/**
 * HTF scan orchestrator.
 *
 * Drives the nightly /htf pipeline end-to-end:
 *   universe → bars (cached) → scanHtf → sizePosition → portfolio gate → DB
 *
 * Runs are idempotent per (runDate, symbol) — re-running the same day
 * replaces that day's rows for the affected symbols. Triggered by cron
 * (server/cron.ts) and by an admin endpoint for on-demand runs.
 *
 * Concurrency: a small pool (default 6) parallelises bar fetches without
 * tripping FMP rate limits. The detector + sizing math is pure JS so each
 * symbol's CPU cost is trivial — the bottleneck is HTTP, not compute.
 */

import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../storage";
import { htfSetups, type InsertHtfSetup } from "@shared/schema";
import { getHtfUniverse, formatUniverseCounts, type HtfUniverseRow } from "../../signals/universe/htf-universe";
import { getHtfBars } from "../../data/htf-ohlcv-cache";
import { scanHtf, type HtfHit } from "../../signals/strategies/htf";
import {
  DEFAULT_ACCOUNT_CONFIG,
  PortfolioState,
  sizePosition,
  type AccountConfig,
  type PositionRecommendation,
} from "../../signals/risk/position-sizing";

export interface HtfScanOptions {
  /** Override default account config. Falls back to DEFAULT_ACCOUNT_CONFIG. */
  config?: AccountConfig;
  /** Skip hits below this quality score before sizing/persisting. Default 0. */
  minScore?: number;
  /** Pre-seed portfolio state (used by tests). Default = empty. */
  portfolio?: PortfolioState;
  /** Max in-flight bar fetches. Default 6. */
  concurrency?: number;
  /** Override the universe — useful for testing or limited admin runs. */
  universeOverride?: HtfUniverseRow[];
  /** Force-refresh OHLCV cache (skip TTL). */
  forceRefresh?: boolean;
  /** Logger; defaults to console.log. */
  log?: (msg: string) => void;
}

export interface HtfScanSummary {
  runDate: string;
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  universeSize: number;
  scanned: number;
  hits: number;
  actionable: number;
  blocked: number;
  errors: number;
  persisted: number;
}

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function rowFromHitAndRec(
  hit: HtfHit,
  rec: PositionRecommendation,
  portfolioCheck: { allowed: boolean; reason: string },
  sector: string,
  runDate: string,
): InsertHtfSetup {
  const actionable = rec.blockedReason === null && portfolioCheck.allowed;
  const blockedReason = rec.blockedReason ?? (portfolioCheck.allowed ? null : portfolioCheck.reason);
  return {
    runDate,
    symbol: hit.symbol,
    pattern: hit.pattern,
    breakoutDate: ymd(hit.breakoutDate),
    breakoutPrice: hit.breakoutPrice,
    targetPrice: hit.targetPrice,
    stopPrice: hit.stopPrice,
    qualityScore: hit.qualityScore,
    poleGainPct: hit.extras.poleGainPct,
    poleDays: hit.extras.poleDays,
    flagDays: hit.extras.flagDays,
    flagPullbackPct: hit.extras.flagPullbackPct,
    breakoutVolRatio: hit.extras.breakoutVolRatio,
    recommendedShares: rec.recommendedShares,
    positionValue: rec.positionValue,
    actualRisk: rec.actualRisk,
    rewardRiskRatio: rec.rewardRiskRatio,
    actionable,
    blockedReason,
    warnings: rec.warnings,
    sector,
  };
}

async function processSymbol(
  row: HtfUniverseRow,
  config: AccountConfig,
  portfolio: PortfolioState,
  runDate: string,
  minScore: number,
  forceRefresh: boolean,
): Promise<{ rows: InsertHtfSetup[]; error: boolean }> {
  try {
    const bars = await getHtfBars(row.symbol, { forceRefresh });
    if (bars.length === 0) return { rows: [], error: false };
    const hits = scanHtf(bars, row.symbol, { minScore });
    if (hits.length === 0) return { rows: [], error: false };

    const out: InsertHtfSetup[] = [];
    // The detector returns newest-first; size + check in that order so the
    // most-recent breakout consumes portfolio capacity first.
    for (const hit of hits) {
      const rec = sizePosition(hit, config);
      const check = portfolio.canAddPosition(rec, hit, config, row.sector || "Unknown");
      out.push(rowFromHitAndRec(hit, rec, check, row.sector || "Unknown", runDate));
      // Don't mutate the working portfolio — the rec is informational. We
      // only treat the portfolio as "what the user has actually taken,"
      // not what the scanner *suggests*. Real adds happen via the trade
      // tracker.
    }
    return { rows: out, error: false };
  } catch {
    return { rows: [], error: true };
  }
}

async function runPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function spawn(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i]);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => spawn());
  await Promise.all(workers);
  return results;
}

/**
 * Run a full HTF scan and persist results to htf_setups.
 *
 * Idempotent per (runDate, symbol). Returns aggregate counters; per-row data
 * lives in the DB and is read by the API endpoints.
 */
export async function runHtfScan(opts: HtfScanOptions = {}): Promise<HtfScanSummary> {
  const config = opts.config ?? DEFAULT_ACCOUNT_CONFIG;
  const minScore = opts.minScore ?? 0;
  const portfolio = opts.portfolio ?? new PortfolioState();
  const concurrency = opts.concurrency ?? 6;
  const forceRefresh = opts.forceRefresh ?? false;
  const log = opts.log ?? ((msg: string) => console.log(`[htf-scan] ${msg}`));

  const startedAt = new Date();
  const runDate = todayYmd();

  let universe: HtfUniverseRow[];
  if (opts.universeOverride) {
    universe = opts.universeOverride;
    log(`universe override: ${universe.length} tickers`);
  } else {
    const u = await getHtfUniverse();
    log(formatUniverseCounts(u));
    universe = u.tickers;
  }

  const results = await runPool(universe, concurrency, row =>
    processSymbol(row, config, portfolio, runDate, minScore, forceRefresh),
  );

  let hits = 0;
  let actionable = 0;
  let blocked = 0;
  let errors = 0;
  const allRows: InsertHtfSetup[] = [];
  for (const r of results) {
    if (r.error) errors++;
    for (const row of r.rows) {
      hits++;
      if (row.actionable) actionable++;
      else blocked++;
      allRows.push(row);
    }
  }

  let persisted = 0;
  if (allRows.length > 0) {
    // Replace any prior rows for these (runDate, symbol) pairs — keeps
    // re-runs idempotent without losing other days' data.
    const symbols = Array.from(new Set(allRows.map(r => r.symbol)));
    await db
      .delete(htfSetups)
      .where(and(eq(htfSetups.runDate, runDate), inArray(htfSetups.symbol, symbols)));
    // Drizzle pg-core handles batch inserts; do it in chunks to keep
    // parameter counts under PG's 65k limit.
    const CHUNK = 200;
    for (let i = 0; i < allRows.length; i += CHUNK) {
      const slice = allRows.slice(i, i + CHUNK);
      await db.insert(htfSetups).values(slice);
      persisted += slice.length;
    }
  }

  const finishedAt = new Date();
  const summary: HtfScanSummary = {
    runDate,
    startedAt,
    finishedAt,
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    universeSize: universe.length,
    scanned: universe.length - errors,
    hits,
    actionable,
    blocked,
    errors,
    persisted,
  };
  log(
    `done: ${summary.universeSize} tickers, ${hits} hits ` +
      `(${actionable} actionable / ${blocked} blocked), ${errors} errors, ${persisted} persisted, ` +
      `${(summary.durationMs / 1000).toFixed(1)}s`,
  );
  return summary;
}
