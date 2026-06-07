/**
 * Metals & mining HTF watch.
 *
 * A second HTF scan over the FULL mining complex at ANY price (the default
 * /htf scan stays on the $5–$75 equity universe). Reuses the exact same
 * detector + sizing path via `runHtfScan` — this module only swaps the
 * universe filter (`METALS_MINING_WATCH_FILTERS`) and keeps its OWN in-memory
 * snapshot so it never clobbers the main scan's cache (`writeCache: false`).
 *
 * Surfaces both fired and forming HTF setups so you're early on a metals
 * bounce rather than late. Driven nightly by cron (server/cron.ts) and
 * on-demand via /api/htf/metals-watch.
 */

import { runHtfScan, type HtfScanOptions, type HtfScanResult } from "./orchestrator";
import { METALS_MINING_WATCH_FILTERS } from "../../signals/universe/htf-universe";

let latestWatch: HtfScanResult | null = null;
let watchInFlight: Promise<HtfScanResult> | null = null;
const WATCH_TTL_MS = 30 * 60 * 1000; // 30 min — EOD data, matches main scan

/** Run a fresh metals-watch scan. Stores its own snapshot; never the shared one. */
export function runMetalsWatch(opts: HtfScanOptions = {}): Promise<HtfScanResult> {
  const run = runHtfScan({
    ...opts,
    universeFilters: METALS_MINING_WATCH_FILTERS,
    writeCache: false,
    log: opts.log ?? ((msg: string) => console.log(`[htf-metals-watch] ${msg}`)),
  });
  watchInFlight = run.then(res => {
    latestWatch = res;
    return res;
  }).finally(() => {
    watchInFlight = null;
  });
  return watchInFlight;
}

/**
 * Read the latest metals watch. Returns the cached snapshot if fresh
 * (<30min), otherwise runs a scan. Concurrent callers share the in-flight run.
 */
export function getMetalsWatch(opts: HtfScanOptions = {}): Promise<HtfScanResult> {
  const now = Date.now();
  if (latestWatch && now - latestWatch.scannedAt.getTime() <= WATCH_TTL_MS) {
    return Promise.resolve(latestWatch);
  }
  if (watchInFlight) return watchInFlight;
  return runMetalsWatch(opts);
}

/** Most recent metals-watch snapshot without triggering a scan. */
export function peekMetalsWatch(): HtfScanResult | null {
  return latestWatch;
}
