/**
 * HTF OHLCV bar cache — thin adapter over the canonical `long-range-cache`.
 *
 * Stock Otter has one disk-cache module — `server/long-range-cache.ts` —
 * that handles file layout, atomic writes, age reporting, and listing for
 * cached chart payloads. HTF rides on top with `range = "1y"`, `interval =
 * "1d"` keys so:
 *   - HTF bars share invalidation with the long-range cache
 *   - Future migrations (Redis, etc.) at the canonical layer pick up HTF
 *     for free
 *   - There's no parallel directory / TTL / JSON format to maintain
 *
 * The HTF-specific 18-hour staleness check sits at THIS layer (one-refresh-
 * per-trading-day semantics) rather than the long-range default 7 days.
 */

import { fmpGet } from "./providers/fmp.client";
import { readLongRange, writeLongRange, longRangeAgeHours } from "../long-range-cache";
import type { OHLCV } from "./types";

const HTF_RANGE = "1y";
const HTF_INTERVAL = "1d";
const CACHE_TTL_MS = 18 * 60 * 60 * 1000;     // ~one trading day
const DEFAULT_LOOKBACK_DAYS = 365;             // ~14 months: enough for 60d pole + buffer

interface CachedBarsPayload {
  symbol: string;
  // Bars persisted as plain objects so JSON round-trips cleanly. `t` is ISO.
  bars: Array<{ t: string; o: number; h: number; l: number; c: number; v: number }>;
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
  // FMP returns newest-first; HTF detector expects oldest-first.
  bars.sort((a, b) => a.t.getTime() - b.t.getTime());
  return bars;
}

function readFresh(symbol: string): OHLCV[] | null {
  const entry = readLongRange(symbol, HTF_RANGE, HTF_INTERVAL);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) return null;
  const payload = entry.payload as CachedBarsPayload;
  if (!payload || !Array.isArray(payload.bars)) return null;
  return payload.bars.map(b => ({
    t: new Date(b.t),
    o: b.o, h: b.h, l: b.l, c: b.c, v: b.v,
  }));
}

function readStale(symbol: string): OHLCV[] | null {
  const entry = readLongRange(symbol, HTF_RANGE, HTF_INTERVAL);
  if (!entry) return null;
  const payload = entry.payload as CachedBarsPayload;
  if (!payload || !Array.isArray(payload.bars)) return null;
  return payload.bars.map(b => ({
    t: new Date(b.t),
    o: b.o, h: b.h, l: b.l, c: b.c, v: b.v,
  }));
}

function writeBars(symbol: string, bars: OHLCV[]): void {
  const payload: CachedBarsPayload = {
    symbol: symbol.toUpperCase(),
    bars: bars.map(b => ({
      t: b.t.toISOString(),
      o: b.o, h: b.h, l: b.l, c: b.c, v: b.v,
    })),
  };
  writeLongRange(symbol, HTF_RANGE, HTF_INTERVAL, payload);
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
    const fresh = readFresh(symbol);
    if (fresh && fresh.length > 0) return fresh;
  }

  try {
    const bars = await fetchBarsFromFmp(symbol, lookback);
    if (bars.length > 0) writeBars(symbol, bars);
    return bars;
  } catch {
    // Soft-fail: return any stale cached data if we have it, else empty.
    return readStale(symbol) ?? [];
  }
}

/** True if the cached entry exists and is within the HTF-specific TTL. */
export function isCacheFresh(symbol: string): boolean {
  const ageHr = longRangeAgeHours(symbol, HTF_RANGE, HTF_INTERVAL);
  if (ageHr === null) return false;
  return ageHr * 60 * 60 * 1000 <= CACHE_TTL_MS;
}

/**
 * HTF-specific cache stats — counts only the HTF-keyed entries (1y/1d).
 * The long-range cache may hold other range/interval combos for the
 * chart pages; those are ignored here.
 */
export function htfCacheStats(): { entries: number; freshEntries: number } {
  // Cross-module reach is unfortunate but the long-range listing already
  // discloses ageHours, and the alternative (adding an HTF-shaped helper
  // to long-range-cache.ts) would bloat that module. Acceptable for stats.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { listLongRange } = require("../long-range-cache") as typeof import("../long-range-cache");
  const all = listLongRange();
  const htf = all.filter(e => e.range === HTF_RANGE && e.interval === HTF_INTERVAL);
  const freshHours = CACHE_TTL_MS / (60 * 60 * 1000);
  return {
    entries: htf.length,
    freshEntries: htf.filter(e => e.ageHours <= freshHours).length,
  };
}
