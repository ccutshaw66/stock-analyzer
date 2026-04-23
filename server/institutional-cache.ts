/**
 * Institutional (EDGAR 13F) disk cache.
 *
 * Phase 3.8 hardening:
 *   - EDGAR 13F cold path is ~25 minutes for a first-ever ticker (ranks ~7000
 *     filers, then parses information tables for the 500 largest).
 *   - In-process 12h cache mitigates within a single process, but every
 *     deploy / restart wipes it and the next user-facing request pays full
 *     cold cost.
 *   - This disk cache persists the final InstitutionalSummary per ticker so
 *     restarts get an instant warm start, and a nightly cron pre-fills it
 *     for the "always warm" list + open-trade symbols.
 *
 * Files live under ./data/institutional-cache/{TICKER}.json
 * Each file is a small JSON blob: { fetchedAt, summary }.
 * TTL: 3 days (13Fs only update quarterly — stale-but-present is better than
 * blocking a user for 25 minutes).
 */
import fs from "fs";
import path from "path";

const CACHE_DIR = path.resolve(process.cwd(), "data", "institutional-cache");
const CACHE_TTL_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

function ensureDir(): void {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  } catch {
    // ignore
  }
}

function keyFile(ticker: string): string {
  const safe = ticker.toUpperCase().replace(/[^A-Z0-9_]/gi, "_");
  return path.join(CACHE_DIR, `${safe}.json`);
}

export interface InstitutionalCacheEntry {
  fetchedAt: number;
  summary: any; // InstitutionalSummary shape
}

/** Read a cache entry. Returns null on miss or parse error. Does NOT check TTL. */
export function readInstitutional(ticker: string): InstitutionalCacheEntry | null {
  const fp = keyFile(ticker);
  try {
    if (!fs.existsSync(fp)) return null;
    const raw = fs.readFileSync(fp, "utf8");
    const parsed = JSON.parse(raw) as InstitutionalCacheEntry;
    if (!parsed || typeof parsed.fetchedAt !== "number" || !parsed.summary) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Read if fresh (<=TTL). */
export function readInstitutionalFresh(ticker: string): any | null {
  const entry = readInstitutional(ticker);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) return null;
  return entry.summary;
}

/** Write atomically. */
export function writeInstitutional(ticker: string, summary: any): void {
  if (!summary) return;
  ensureDir();
  const fp = keyFile(ticker);
  const tmp = `${fp}.tmp`;
  const body: InstitutionalCacheEntry = { fetchedAt: Date.now(), summary };
  try {
    fs.writeFileSync(tmp, JSON.stringify(body));
    fs.renameSync(tmp, fp);
  } catch {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

/** Diagnostic: list all cached entries with age. */
export function listInstitutional(): Array<{ ticker: string; ageHours: number; fetchedAt: number }> {
  ensureDir();
  const out: Array<{ ticker: string; ageHours: number; fetchedAt: number }> = [];
  try {
    const files = fs.readdirSync(CACHE_DIR);
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      const ticker = f.replace(/\.json$/i, "");
      const entry = readInstitutional(ticker);
      if (!entry) continue;
      out.push({
        ticker,
        fetchedAt: entry.fetchedAt,
        ageHours: Number(((Date.now() - entry.fetchedAt) / (60 * 60 * 1000)).toFixed(1)),
      });
    }
  } catch {
    // ignore
  }
  return out.sort((a, b) => a.ageHours - b.ageHours);
}

/** Stale-cache helper: return cached summary even if past TTL. */
export function readInstitutionalStale(ticker: string): any | null {
  const entry = readInstitutional(ticker);
  return entry?.summary ?? null;
}
