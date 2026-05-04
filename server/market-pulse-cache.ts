/**
 * Market Pulse disk cache.
 *
 * Single combined snapshot file at `data/market-pulse-cache/snapshot.json`.
 * Two crons write it:
 *   - 5-min intraday: refreshes volatility, riskAppetite, indices (cheap)
 *     and recomputes the regime — preserves the cached breadth
 *   - Daily 9:35am ET: refreshes breadth (~500 S&P 500 tickers)
 *
 * The /api/market-pulse route just reads this file. No request-path I/O,
 * no live API calls per user view.
 */
import fs from "fs";
import path from "path";
import type { MarketPulse } from "./data/providers/market-pulse.adapter";

const CACHE_DIR = path.resolve(process.cwd(), "data", "market-pulse-cache");
const SNAPSHOT_FILE = path.join(CACHE_DIR, "snapshot.json");

function ensureDir(): void {
  try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch { /* ignore */ }
}

export function readMarketPulseSnapshot(): MarketPulse | null {
  try {
    if (!fs.existsSync(SNAPSHOT_FILE)) return null;
    const raw = fs.readFileSync(SNAPSHOT_FILE, "utf8");
    const parsed = JSON.parse(raw) as MarketPulse;
    if (!parsed?.asOf || !parsed?.regime) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeMarketPulseSnapshot(snap: MarketPulse): void {
  ensureDir();
  const tmp = `${SNAPSHOT_FILE}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(snap, null, 2));
    fs.renameSync(tmp, SNAPSHOT_FILE);
  } catch {
    try { fs.unlinkSync(tmp); } catch {}
  }
}
