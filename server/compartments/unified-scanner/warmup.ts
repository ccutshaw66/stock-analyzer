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
import { getStrategyManifest } from "@shared/strategies/registry";
import { scanOne, rankHits, SCANNABLE_ENGINE_IDS, type UniverseRow } from "./engine";
import { writeUnifiedScan } from "../../unified-scan-cache";

const MARKET_KEY = "market-all";

async function fetchBars(symbol: string, days = 3650): Promise<OHLCV[] | null> {
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

/**
 * Full market warmup → writes the ranked cache. maxSymbols caps the universe
 * (deterministic, market-cap desc). Returns counts for the cron log.
 */
export async function warmUnifiedScanCache(opts: { maxSymbols?: number } = {}): Promise<{ written: number; errors: number }> {
  const maxSymbols = opts.maxSymbols ?? 3000;
  let errors = 0;

  // Deterministic universe — full market, liquid common stocks, no shuffle.
  const universe = await fmpScreener({ minVolume: 500_000, count: maxSymbols, noShuffle: true }).catch(() => {
    errors++;
    return [];
  });

  const rows = new Map<string, UniverseRow>();
  for (const r of universe) {
    rows.set(r.symbol, {
      symbol: r.symbol, companyName: r.companyName, marketCap: r.marketCap,
      sector: r.sector, price: r.price,
    });
  }

  const symbols = Array.from(rows.keys());
  const hits = await scanSymbols(symbols, rows);
  // Store best-first; the route applies the per-request top-N after filtering.
  const ranked = rankHits(hits, 0, hits.length);
  writeUnifiedScan(MARKET_KEY, ranked);
  return { written: ranked.length, errors };
}

export const UNIFIED_SCAN_MARKET_KEY = MARKET_KEY;
