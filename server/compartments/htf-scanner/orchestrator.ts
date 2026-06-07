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

/**
 * In-memory row shape. Drizzle's `InsertHtfSetup` is the persisted schema
 * (no longer written at runtime — see the kill-the-history-table change),
 * but we carry a few extra fields the schema doesn't include so the page
 * can render current price + pct-from-trigger without re-fetching bars.
 */
export type HtfLiveSetupRow = InsertHtfSetup & {
  /** Latest available close for the symbol — what price is RIGHT NOW. */
  currentPrice: number;
  /**
   * Percent change from the breakout / trigger level to current price.
   *  - Live (fired): positive = trade has run since the breakout (chase risk).
   *  - Watch (forming): negative = price is still below the trigger.
   */
  pctFromEntry: number;
};
import { getHtfUniverse, formatUniverseCounts, type HtfUniverseRow, type HtfUniverseFilters } from "../../signals/universe/htf-universe";
import { getHtfBars } from "../../data/htf-ohlcv-cache";
import { scanHtf, scanFormingHtf, htfLiveStatus, type HtfHit } from "../../signals/strategies/htf";

// ─── Live-setup filters ────────────────────────────────────────────────
// A breakout is only tradeable on the next market open after it fires.
// Allowing one bar of grace covers:
//   - Pre-market scans: latest bar = yesterday's close. A breakout on the
//     latest bar means entry at today's open (= "this morning"). A breakout
//     one bar earlier (Monday close, viewed Tuesday) means entry at
//     Tuesday's open — still actionable today.
//   - During-session scans where today's bar hasn't been published yet.
// Tighter than this (0 days) usually returns an empty list because few
// stocks break out on any single bar.
const MAX_DAYS_SINCE_BREAKOUT = 1;
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
  /**
   * Override the universe *filters* (e.g. the metals watch uncaps price and
   * sector-screens). Ignored when `universeOverride` is supplied.
   */
  universeFilters?: Partial<HtfUniverseFilters>;
  /** Force-refresh OHLCV cache (skip TTL). */
  forceRefresh?: boolean;
  /**
   * Write the result to the shared in-memory `latestScan` cache (what the
   * /htf page reads). Default true. Alternate universes (e.g. the metals
   * watch) pass false so they don't clobber the main scan's snapshot.
   */
  writeCache?: boolean;
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
  currentPrice: number,
): HtfLiveSetupRow {
  const actionable = rec.blockedReason === null && portfolioCheck.allowed;
  const blockedReason = rec.blockedReason ?? (portfolioCheck.allowed ? null : portfolioCheck.reason);
  const pctFromEntry =
    hit.breakoutPrice > 0 ? ((currentPrice - hit.breakoutPrice) / hit.breakoutPrice) * 100 : 0;
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
    currentPrice,
    pctFromEntry,
    sector,
  };
}

function isLiveSetup(hit: HtfHit, currentPrice: number, currentDate: Date): boolean {
  // Delegates to the shared predicate so scanner + Trigger Check stay in lock-step.
  return htfLiveStatus(hit, currentPrice, currentDate, MAX_DAYS_SINCE_BREAKOUT).live;
}

async function processSymbol(
  row: HtfUniverseRow,
  config: AccountConfig,
  portfolio: PortfolioState,
  runDate: string,
  minScore: number,
  forceRefresh: boolean,
): Promise<{ rows: HtfLiveSetupRow[]; error: boolean }> {
  try {
    const bars = await getHtfBars(row.symbol, { forceRefresh });
    if (bars.length === 0) return { rows: [], error: false };

    const lastBar = bars[bars.length - 1];
    const currentPrice = lastBar.c;
    const sector = row.sector || "Unknown";

    // 1) Fired setup — breakout already happened on a recent bar.
    const hits = scanHtf(bars, row.symbol, { minScore });
    const newestFired = hits[0];
    if (newestFired && isLiveSetup(newestFired, currentPrice, lastBar.t)) {
      const rec = sizePosition(newestFired, config);
      const check = portfolio.canAddPosition(rec, newestFired, config, sector);
      return {
        rows: [rowFromHitAndRec(newestFired, rec, check, sector, runDate, currentPrice)],
        error: false,
      };
    }

    // 2) Forming setup — pole done, flag still consolidating, no breakout yet.
    // Falls through here only when no fired setup is live for this symbol.
    const forming = scanFormingHtf(bars, row.symbol);
    if (forming && forming.qualityScore >= minScore) {
      // Mark it so downstream consumers can distinguish from fired setups.
      const formingHit: HtfHit = { ...forming, pattern: "HTF_Givens_Forming" };
      const rec = sizePosition(formingHit, config);
      const check = portfolio.canAddPosition(rec, formingHit, config, sector);
      return {
        rows: [rowFromHitAndRec(formingHit, rec, check, sector, runDate, currentPrice)],
        error: false,
      };
    }

    return { rows: [], error: false };
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
  rows: HtfLiveSetupRow[];
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
  const writeCache = opts.writeCache ?? true;
  const log = opts.log ?? ((msg: string) => console.log(`[htf-scan] ${msg}`));

  const startedAt = new Date();
  const runDate = todayYmd();

  let universe: HtfUniverseRow[];
  if (opts.universeOverride) {
    universe = opts.universeOverride;
    log(`universe override: ${universe.length} tickers`);
  } else {
    const u = await getHtfUniverse(opts.universeFilters ?? {});
    log(formatUniverseCounts(u));
    universe = u.tickers;
  }

  const results = await runPool(universe, concurrency, row =>
    processSymbol(row, config, portfolio, runDate, minScore, forceRefresh),
  );

  let errors = 0;
  const allRows: HtfLiveSetupRow[] = [];
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
  if (writeCache) latestScan = result;

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
