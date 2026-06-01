/**
 * Market-wide pre-compute for the unified scanner. Resolves a deterministic
 * universe (no shuffle), fetches bars, runs every engine-capable strategy, and
 * writes the full ScanHit[] to the disk cache under "market-all". The nightly
 * cron calls this; the route reads the cache and slices by user filters.
 */
import { fmpGet } from "../../data/providers/fmp.client";
import { fmpScreener } from "../../data/providers/fmp.adapter";
import type { OHLCV } from "../../data/types";
import type { ScanHit } from "@shared/scanner/types";
import { MARKET_CAP_TIERS } from "@shared/scanner/types";
import { getStrategyManifest } from "@shared/strategies/registry";
import { scanOne, rankHits, SCANNABLE_ENGINE_IDS, type UniverseRow } from "./engine";
import { writeUnifiedScan } from "../../unified-scan-cache";

/** Disk-cache key for a market-cap tier's pre-ranked hits. */
export function tierCacheKey(tierId: string): string {
  return `tier-${tierId}`;
}

// ~3y of history (+250-bar warmup buffer added below) — enough for every
// detector (Rounding Bottom needs the most at ~750 bars) without the 10y
// payload that made on-demand scans time out.
async function fetchBars(symbol: string, days = 1100): Promise<OHLCV[] | null> {
  try {
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - (days + 250) * 86_400_000).toISOString().slice(0, 10);
    const data: any = await fmpGet("/historical-price-eod/full", { symbol, from, to });
    const arr: any[] = Array.isArray(data) ? data : data?.historical || [];
    if (arr.length < 250) return null;
    const sorted = [...arr].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const out: OHLCV[] = [];
    for (const r of sorted) {
      const c = Number(r.close);
      if (!Number.isFinite(c)) continue;
      out.push({
        t: new Date(r.date), o: Number(r.open), h: Number(r.high),
        l: Number(r.low), c, v: Number.isFinite(Number(r.volume)) ? Number(r.volume) : 0,
      });
    }
    return out;
  } catch {
    return null;
  }
}

const labelOf = (id: string) => getStrategyManifest(id).shortName;

/**
 * Scan a specific symbol list (used by the route for an on-demand narrowed
 * refresh) and return the hits. Does not touch the cache.
 */
export async function scanSymbols(symbols: string[], rows: Map<string, UniverseRow>): Promise<ScanHit[]> {
  const BATCH = 12;
  const all: ScanHit[] = [];
  for (let i = 0; i < symbols.length; i += BATCH) {
    const slice = symbols.slice(i, i + BATCH);
    const results = await Promise.allSettled(slice.map(async sym => {
      const bars = await fetchBars(sym);
      const row = rows.get(sym);
      if (!bars || !row) return [];
      return scanOne(bars, row, SCANNABLE_ENGINE_IDS, labelOf);
    }));
    for (const r of results) if (r.status === "fulfilled") all.push(...r.value);
    if (i + BATCH < symbols.length) await new Promise(res => setTimeout(res, 120));
  }
  return all;
}

// Liquidity floor — keep genuinely tradeable names; below this is untradeable
// noise (you can't get filled). Everything above it in every tier is scanned.
const WARM_MIN_VOLUME = 150_000;
// FMP screener hard cap per call. Each tier's liquid universe is well under
// this, so `count` here means "all of them" — NO top-N-by-cap subset.
const WARM_PER_TIER = 3000;

let warmInFlight = false;

/**
 * Market warmup → writes one ranked cache PER market-cap tier, scanning the
 * FULL liquid universe of each tier (no top-N subset — `count` exceeds each
 * tier's real size, so every qualifying ticker is scanned). The whole market
 * is covered; the route just slices the cached results by the user's filters.
 * Returns total counts for the cron log.
 */
export async function warmUnifiedScanCache(opts: { perTier?: number } = {}): Promise<{ written: number; errors: number; byTier: Record<string, number>; scanned: number }> {
  const perTier = opts.perTier ?? WARM_PER_TIER;
  let errors = 0;
  let written = 0;
  let scanned = 0;
  const byTier: Record<string, number> = {};

  for (const tier of MARKET_CAP_TIERS) {
    const universe = await fmpScreener({
      minMarketCap: tier.min,
      maxMarketCap: tier.max ?? undefined,
      minVolume: WARM_MIN_VOLUME,
      count: perTier,
      noShuffle: true,
    }).catch(() => { errors++; return []; });

    const rows = new Map<string, UniverseRow>();
    for (const r of universe) {
      rows.set(r.symbol, { symbol: r.symbol, companyName: r.companyName, marketCap: r.marketCap, sector: r.sector, price: r.price });
    }
    scanned += rows.size;
    const hits = await scanSymbols(Array.from(rows.keys()), rows);
    const ranked = rankHits(hits, 0, hits.length);
    writeUnifiedScan(tierCacheKey(tier.id), ranked);
    byTier[tier.id] = ranked.length;
    written += ranked.length;
  }

  return { written, errors, byTier, scanned };
}

/**
 * Kick off a full warm in the BACKGROUND (fire-and-forget) so callers (the
 * manual trigger, the route's refresh/cold path) return instantly instead of
 * holding an HTTP request for minutes. Guarded so only one runs at a time.
 * Returns true if a new warm started, false if one was already running.
 */
export function startWarmInBackground(): boolean {
  if (warmInFlight) return false;
  warmInFlight = true;
  void warmUnifiedScanCache()
    .then(r => console.log(`[unified-scan] background warm done: ${r.written} hits from ${r.scanned} scanned, ${r.errors} errors`))
    .catch(e => console.error(`[unified-scan] background warm failed:`, e?.message || e))
    .finally(() => { warmInFlight = false; });
  return true;
}

export function isWarmInFlight(): boolean {
  return warmInFlight;
}
