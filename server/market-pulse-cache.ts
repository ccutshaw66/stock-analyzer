/**
 * Market Pulse disk cache.
 *
 * Two snapshot files on disk:
 *   - intraday.json: VIX, indices, gold/silver, risk-appetite ratios.
 *                    Refreshed every 5min during market hours.
 *   - breadth.json:  S&P 500 % above MAs, new H/L counts.
 *                    Refreshed once per day at 9:35am ET (post-open).
 *
 * The /api/market-pulse route reads both files, stitches them together,
 * and computes the regime score. NO live FMP calls on the request path.
 */

import * as fs from "fs";
import * as path from "path";
import type { MarketPulseSnapshot } from "./data/providers/market-pulse.adapter";

const CACHE_DIR = path.join(process.cwd(), "data", "market-pulse-cache");
const INTRADAY_FILE = path.join(CACHE_DIR, "intraday.json");
const BREADTH_FILE = path.join(CACHE_DIR, "breadth.json");

function ensureDir() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

export type IntradayPayload = Omit<MarketPulseSnapshot, "breadth" | "regime">;
export type BreadthPayload = MarketPulseSnapshot["breadth"] & { asOf: number };

export function writeIntraday(payload: IntradayPayload): void {
  ensureDir();
  fs.writeFileSync(INTRADAY_FILE, JSON.stringify(payload, null, 2), "utf8");
}

export function readIntraday(): IntradayPayload | null {
  try {
    if (!fs.existsSync(INTRADAY_FILE)) return null;
    return JSON.parse(fs.readFileSync(INTRADAY_FILE, "utf8")) as IntradayPayload;
  } catch {
    return null;
  }
}

export function writeBreadth(payload: BreadthPayload): void {
  ensureDir();
  fs.writeFileSync(BREADTH_FILE, JSON.stringify(payload, null, 2), "utf8");
}

export function readBreadth(): BreadthPayload | null {
  try {
    if (!fs.existsSync(BREADTH_FILE)) return null;
    return JSON.parse(fs.readFileSync(BREADTH_FILE, "utf8")) as BreadthPayload;
  } catch {
    return null;
  }
}
