/**
 * HTF OHLCV bar cache.
 *
 * Mirrors the `long-range-cache.ts` disk-cache pattern: each ticker's recent
 * EOD bars are persisted under `data/htf-ohlcv-cache/<TICKER>.json` and
 * refreshed once per trading day. The HTF scanner hits this layer instead of
 * FMP directly so a full 1,500-ticker nightly scan only re-fetches the names
 * whose bar files are stale.
 *
 * On Cache miss / stale: pull `/historical-price-eod/full` from FMP, normalize
 * to the in-house `OHLCV` shape (matches `server/data/types.ts`), persist.
 *
 * TTL is 18 hours — guarantees one fetch per trading session even if cron
 * fires slightly off the same wall-clock time day to day.
 */

import fs from "fs";
import path from "path";
import { fmpGet } from "./providers/fmp.client";
import type { OHLCV } from "./types";

const CACHE_DIR = path.resolve(process.cwd(), "data", "htf-ohlcv-cache");
const CACHE_TTL_MS = 18 * 60 * 60 * 1000;     // ~one trading day
const DEFAULT_LOOKBACK_DAYS = 365;             // ~14 months of bars: enough for 60d pole + buffer

interface BarsEntry {
  fetchedAt: number;     // epoch ms
  symbol: string;
  bars: OHLCV[];         // chronological, oldest first
}

function ensureDir(): void {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  } catch {
    // ignore
  }
}

function fileFor(symbol: string): string {
  const safe = symbol.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  return path.join(CACHE_DIR, `${safe}.json`);
}

function readEntry(symbol: string): BarsEntry | null {
  const fp = fileFor(symbol);
  try {
    if (!fs.existsSync(fp)) return null;
    const parsed = JSON.parse(fs.readFileSync(fp, "utf8")) as Omit<BarsEntry, "bars"> & {
      bars: Array<Omit<OHLCV, "t"> & { t: string | number }>;
    };
    if (!parsed || typeof parsed.fetchedAt !== "number" || !Array.isArray(parsed.bars)) return null;
    const bars: OHLCV[] = parsed.bars.map(b => ({
      t: new Date(b.t),
      o: b.o,
      h: b.h,
      l: b.l,
      c: b.c,
      v: b.v,
    }));
    return { fetchedAt: parsed.fetchedAt, symbol: parsed.symbol, bars };
  } catch {
    return null;
  }
}

function writeEntry(entry: BarsEntry): void {
  ensureDir();
  const fp = fileFor(entry.symbol);
  const tmp = `${fp}.tmp`;
  fs.writeFileSync(
    tmp,
    JSON.stringify({
      fetchedAt: entry.fetchedAt,
      symbol: entry.symbol,
      bars: entry.bars.map(b => ({
        t: b.t.toISOString(),
        o: b.o,
        h: b.h,
        l: b.l,
        c: b.c,
        v: b.v,
      })),
    }),
    "utf8",
  );
  fs.renameSync(tmp, fp);
}

async function fetchBarsFromFmp(symbol: string, lookbackDays: number): Promise<OHLCV[]> {
  const to = new Date().toISOString().slice(0, 10);
  const fromDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
  const from = fromDate.toISOString().slice(0, 10);

  const raw: any = await fmpGet("/historical-price-eod/full", { symbol, from, to });
  const arr: any[] = Array.isArray(raw) ? raw : raw?.historical || [];

  const bars: OHLCV[] = [];
  for (const r of arr) {
    const t = new Date(r.date);
    const o = Number(r.open);
    const h = Number(r.high);
    const l = Number(r.low);
    const c = Number(r.close);
    const v = Number(r.volume);
    if (isNaN(t.getTime()) || !isFinite(c)) continue;
    bars.push({ t, o, h, l, c, v: isFinite(v) ? v : 0 });
  }
  // FMP returns newest-first; HTF detector expects oldest-first
  bars.sort((a, b) => a.t.getTime() - b.t.getTime());
  return bars;
}

export interface GetBarsOptions {
  /** Days of history to ensure are present (default 365). */
  lookbackDays?: number;
  /** Bypass the TTL check and force a fresh FMP pull. */
  forceRefresh?: boolean;
}

/**
 * Get OHLCV bars for a symbol, oldest-first.
 *
 * Cache-first; pulls FMP on miss or stale. Returns an empty array on any
 * upstream failure so the scanner can skip a ticker without aborting the run.
 */
export async function getHtfBars(
  symbol: string,
  opts: GetBarsOptions = {},
): Promise<OHLCV[]> {
  const lookback = opts.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const force = opts.forceRefresh ?? false;

  if (!force) {
    const cached = readEntry(symbol);
    if (cached && Date.now() - cached.fetchedAt <= CACHE_TTL_MS && cached.bars.length > 0) {
      return cached.bars;
    }
  }

  try {
    const bars = await fetchBarsFromFmp(symbol, lookback);
    if (bars.length > 0) {
      writeEntry({ fetchedAt: Date.now(), symbol: symbol.toUpperCase(), bars });
    }
    return bars;
  } catch {
    // Soft-fail: return any stale cached data if we have it, else empty
    const stale = readEntry(symbol);
    return stale?.bars ?? [];
  }
}

/** True if the on-disk entry exists and is within TTL. Used for cache-stat reporting. */
export function isCacheFresh(symbol: string): boolean {
  const e = readEntry(symbol);
  return !!e && Date.now() - e.fetchedAt <= CACHE_TTL_MS;
}

/** Wipe every cached file — for ops use only. */
export function clearHtfCache(): { removed: number } {
  ensureDir();
  let removed = 0;
  for (const f of fs.readdirSync(CACHE_DIR)) {
    if (f.endsWith(".json")) {
      fs.unlinkSync(path.join(CACHE_DIR, f));
      removed++;
    }
  }
  return { removed };
}

/** Stats for diagnostics endpoints. */
export function htfCacheStats(): { entries: number; freshEntries: number; sizeBytes: number } {
  ensureDir();
  let entries = 0;
  let freshEntries = 0;
  let sizeBytes = 0;
  for (const f of fs.readdirSync(CACHE_DIR)) {
    if (!f.endsWith(".json")) continue;
    entries++;
    const fp = path.join(CACHE_DIR, f);
    const stat = fs.statSync(fp);
    sizeBytes += stat.size;
    const sym = f.replace(/\.json$/, "");
    if (isCacheFresh(sym)) freshEntries++;
  }
  return { entries, freshEntries, sizeBytes };
}
