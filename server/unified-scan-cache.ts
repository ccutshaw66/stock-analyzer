/**
 * Disk cache for the pre-ranked market-wide unified-scanner results.
 * Mirrors server/long-range-cache.ts: atomic JSON files under ./data, a
 * freshness check, and a list helper for diagnostics.
 *
 * The nightly warmup writes the full market's ScanHit[] under key "market-all";
 * the route reads it and slices by the user's filters in-memory.
 */
import fs from "fs";
import path from "path";
import type { ScanHit } from "@shared/scanner/types";

const CACHE_DIR = path.resolve(process.cwd(), "data", "unified-scan-cache");
const CACHE_TTL_MS = 26 * 60 * 60 * 1000; // 26h — covers a missed nightly run

export interface UnifiedScanEntry {
  fetchedAt: number; // epoch ms
  payload: ScanHit[];
}

function ensureDir(): void {
  try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch { /* exists */ }
}

function keyFile(key: string): string {
  const safe = key.replace(/[^a-z0-9_-]/gi, "_");
  return path.join(CACHE_DIR, `${safe}.json`);
}

/** Read a cache entry (no TTL check). Returns null on miss or parse error. */
export function readUnifiedScan(key: string): UnifiedScanEntry | null {
  const fp = keyFile(key);
  try {
    if (!fs.existsSync(fp)) return null;
    const parsed = JSON.parse(fs.readFileSync(fp, "utf8")) as UnifiedScanEntry;
    if (!parsed || typeof parsed.fetchedAt !== "number" || !Array.isArray(parsed.payload)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Read the payload if fresh (≤ TTL), else null. */
export function readUnifiedScanFresh(key: string): ScanHit[] | null {
  const entry = readUnifiedScan(key);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) return null;
  return entry.payload;
}

/** Write a cache entry atomically. */
export function writeUnifiedScan(key: string, payload: ScanHit[]): void {
  ensureDir();
  const fp = keyFile(key);
  const tmp = `${fp}.tmp`;
  const body: UnifiedScanEntry = { fetchedAt: Date.now(), payload };
  try {
    fs.writeFileSync(tmp, JSON.stringify(body));
    fs.renameSync(tmp, fp);
  } catch {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}

/** Age of an entry in hours, or null on miss. For diagnostics. */
export function unifiedScanAgeHours(key: string): number | null {
  const entry = readUnifiedScan(key);
  if (!entry) return null;
  return Math.round((Date.now() - entry.fetchedAt) / (60 * 60 * 1000));
}

/** List cached keys with their age + hit count. */
export function listUnifiedScan(): { key: string; ageHours: number; hits: number }[] {
  ensureDir();
  try {
    return fs.readdirSync(CACHE_DIR)
      .filter(f => f.endsWith(".json"))
      .map(f => {
        const key = f.replace(/\.json$/, "");
        const entry = readUnifiedScan(key);
        return {
          key,
          ageHours: entry ? Math.round((Date.now() - entry.fetchedAt) / (60 * 60 * 1000)) : -1,
          hits: entry ? entry.payload.length : 0,
        };
      });
  } catch {
    return [];
  }
}
