/**
 * Long-range chart disk cache.
 *
 * Phase 3.7 design: Yahoo is a background cache filler, never on the request path.
 *
 *   - Frontend requests 10y/25y/max charts -> disk cache only.
 *   - If disk has a fresh entry, serve it.
 *   - If disk miss or stale, serve whatever Polygon can give (capped ~5y).
 *   - A daily cron refreshes the disk cache from Yahoo for a curated list of
 *     actively-used symbols, so the cache stays warm without ever being
 *     triggered by a live user request.
 *
 * Files live under ./data/long-range-cache/{TICKER}__{range}__{interval}.json
 * Each file is a small JSON blob: { fetchedAt, payload }
 */
import fs from "fs";
import path from "path";

const CACHE_DIR = path.resolve(process.cwd(), "data", "long-range-cache");
// Long-range bars rarely change once the day is closed; a week is plenty.
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function ensureDir(): void {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  } catch {
    // ignore
  }
}

function keyFile(ticker: string, range: string, interval: string): string {
  const safe = `${ticker.toUpperCase()}__${range}__${interval}`.replace(/[^A-Z0-9_]/gi, "_");
  return path.join(CACHE_DIR, `${safe}.json`);
}

export interface LongRangeEntry {
  fetchedAt: number; // epoch ms
  payload: any;
}

/** Read a cache entry. Returns null on miss or parse error. Does NOT check TTL. */
export function readLongRange(ticker: string, range: string, interval: string): LongRangeEntry | null {
  const fp = keyFile(ticker, range, interval);
  try {
    if (!fs.existsSync(fp)) return null;
    const raw = fs.readFileSync(fp, "utf8");
    const parsed = JSON.parse(raw) as LongRangeEntry;
    if (!parsed || typeof parsed.fetchedAt !== "number" || !parsed.payload) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Read if fresh (<=TTL) else null. */
export function readLongRangeFresh(ticker: string, range: string, interval: string): any | null {
  const entry = readLongRange(ticker, range, interval);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) return null;
  return entry.payload;
}

/** Write a cache entry atomically. */
export function writeLongRange(ticker: string, range: string, interval: string, payload: any): void {
  ensureDir();
  const fp = keyFile(ticker, range, interval);
  const tmp = `${fp}.tmp`;
  const body: LongRangeEntry = { fetchedAt: Date.now(), payload };
  try {
    fs.writeFileSync(tmp, JSON.stringify(body));
    fs.renameSync(tmp, fp);
  } catch (e) {
    // best effort; cache miss is not fatal
    try { fs.unlinkSync(tmp); } catch {}
  }
}

/** How old the entry is in hours, or null on miss. For diagnostics. */
export function longRangeAgeHours(ticker: string, range: string, interval: string): number | null {
  const entry = readLongRange(ticker, range, interval);
  if (!entry) return null;
  return Math.round((Date.now() - entry.fetchedAt) / (60 * 60 * 1000));
}

/** List currently cached {ticker,range,interval} triples. */
export function listLongRange(): { ticker: string; range: string; interval: string; ageHours: number }[] {
  ensureDir();
  try {
    const files = fs.readdirSync(CACHE_DIR).filter((f) => f.endsWith(".json"));
    const out: { ticker: string; range: string; interval: string; ageHours: number }[] = [];
    for (const f of files) {
      const base = f.replace(/\.json$/, "");
      const [ticker, range, interval] = base.split("__");
      if (!ticker || !range || !interval) continue;
      const age = longRangeAgeHours(ticker, range, interval) ?? -1;
      out.push({ ticker, range, interval, ageHours: age });
    }
    return out;
  } catch {
    return [];
  }
}
