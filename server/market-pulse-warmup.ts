/**
 * Market Pulse warmup handlers — called from cron.ts.
 *
 * Two cadences:
 *   - Intraday (every 5 min, market hours only): refresh quotes/ratios/indices/safe-haven.
 *   - Daily (9:35am ET, post-open): recompute breadth across the S&P 500.
 *
 * Failure-tolerant: any handler error is logged and swallowed so the cron
 * keeps running. Stale cache stays in place rather than disappearing.
 */

import {
  buildIntradaySnapshot,
  getBreadth,
} from "./data/providers/market-pulse.adapter";
import {
  writeIntraday,
  writeBreadth,
} from "./market-pulse-cache";

export async function warmIntradaySnapshot(): Promise<void> {
  const t0 = Date.now();
  try {
    const snap = await buildIntradaySnapshot();
    writeIntraday(snap);
    console.log(`[market-pulse] intraday warmed in ${Date.now() - t0}ms`);
  } catch (e: any) {
    console.error(`[market-pulse] intraday warm failed: ${e?.message || e}`);
  }
}

export async function warmDailyBreadth(): Promise<void> {
  const t0 = Date.now();
  try {
    const breadth = await getBreadth();
    writeBreadth({ ...breadth, asOf: Date.now() });
    console.log(`[market-pulse] breadth warmed in ${Date.now() - t0}ms (${breadth.universeSize ?? 0} tickers scored)`);
  } catch (e: any) {
    console.error(`[market-pulse] breadth warm failed: ${e?.message || e}`);
  }
}
