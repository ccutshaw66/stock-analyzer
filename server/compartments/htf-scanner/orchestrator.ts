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

import type { InsertHtfSetup } from "@shared/schema";
import { getHtfUniverse, formatUniverseCounts, type HtfUniverseRow } from "../../signals/universe/htf-universe";
import { getHtfBars } from "../../data/htf-ohlcv-cache";
import { scanHtf, type HtfHit } from "../../signals/strategies/htf";

// ─── Live-setup filters ────────────────────────────────────────────────
// A breakout is only useful if it's recent AND price is still in the
// actionable zone. Without these filters, scanHtf returns every breakout
// in the past year — which surfaces "great" setups whose entry/target/stop
// fired months ago.
const MAX_DAYS_SINCE_BREAKOUT = 5;     // trading days; calendar approx fine
const MAX_CHASE_PCT = 0.10;            // skip setups where price ran >10% past breakout
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

function isLiveSetup(hit: HtfHit, currentPrice: number, currentDate: Date): boolean {
  // Recency
  const dayMs = 24 * 60 * 60 * 1000;
  const daysSince = Math.round((currentDate.getTime() - hit.breakoutDate.getTime()) / dayMs);
  if (daysSince > MAX_DAYS_SINCE_BREAKOUT) return false;
  // Already hit target — trade is over
  if (currentPrice >= hit.targetPrice) return false;
  // Already stopped out
  if (currentPrice <= hit.stopPrice) return false;
  // Chased — price ran too far past the breakout for a clean entry today
  if (currentPrice > hit.breakoutPrice * (1 + MAX_CHASE_PCT)) return false;
  return true;
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

    // Only the most-recent hit matters for a "tradeable today" surface —
    // skip every older breakout the detector found in the lookback window.
    const newest = hits[0];

    const lastBar = bars[bars.length - 1];
    if (!isLiveSetup(newest, lastBar.c, lastBar.t)) {
      return { rows: [], error: false };
    }

    const rec = sizePosition(newest, config);
    const check = portfolio.canAddPosition(rec, newest, config, row.sector || "Unknown");
    return {
      rows: [rowFromHitAndRec(newest, rec, check, row.sector || "Unknown", runDate)],
      error: false,
    };
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
 * In-memory cache of the most recent scan. There is exactly one live scan
 * state for the process — the page asks "what's firing NOW?" and gets
 * either this snapshot (if fresh) or a freshly-run scan. No DB history.
 */
let latestScan: HtfScanResult | null = null;
let scanInFlight: Promise<HtfScanResult> | null = null;
const CACHE_TTL_MS = 30 * 60 * 1000;     // 30 min — fine for EOD data

export interface HtfScanResult {
  scannedAt: Date;
  durationMs: number;
  universeSize: number;
  scanned: number;
  errors: number;
  rows: InsertHtfSetup[];
}

/**
 * Run a fresh HTF scan and return its rows directly. Does NOT touch the DB —
 * the result lives in memory only. Use `getLiveSetups()` to read with the
 * shared cache; only call this when you want to force a refresh.
 */
export async function runHtfScan(opts: HtfScanOptions = {}): Promise<HtfScanResult> {
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

  let errors = 0;
  const allRows: InsertHtfSetup[] = [];
  for (const r of results) {
    if (r.error) errors++;
    for (const row of r.rows) allRows.push(row);
  }

  const finishedAt = new Date();
  const result: HtfScanResult = {
    scannedAt: finishedAt,
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    universeSize: universe.length,
    scanned: universe.length - errors,
    errors,
    rows: allRows,
  };
  latestScan = result;

  const actionable = allRows.filter(r => r.actionable).length;
  log(
    `done: ${universe.length} tickers, ${allRows.length} live hits ` +
      `(${actionable} actionable / ${allRows.length - actionable} blocked), ${errors} errors, ` +
      `${(result.durationMs / 1000).toFixed(1)}s`,
  );
  return result;
}

/**
 * Get the latest live scan. Returns the in-memory cache if it's fresh
 * (<30min), kicks off a new scan otherwise. Multiple concurrent callers
 * share the same in-flight promise — no thundering herd.
 */
export async function getLiveSetups(opts: HtfScanOptions = {}): Promise<HtfScanResult> {
  const now = Date.now();
  if (latestScan && now - latestScan.scannedAt.getTime() <= CACHE_TTL_MS) {
    return latestScan;
  }
  if (scanInFlight) return scanInFlight;
  scanInFlight = runHtfScan(opts).finally(() => {
    scanInFlight = null;
  });
  return scanInFlight;
}

/** Most recent in-memory scan without triggering a new one. */
export function peekLatestScan(): HtfScanResult | null {
  return latestScan;
}

/** Clear the in-memory cache so the next read triggers a fresh scan. */
export function invalidateScanCache(): void {
  latestScan = null;
}
