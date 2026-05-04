/**
 * Market Pulse cron handlers.
 *
 * Two callers:
 *   - warmIntradaySnapshot() — every 5 min during market hours.
 *     Cheap: 3 FMP calls + ~10 Polygon calls. Preserves cached breadth.
 *   - warmDailyBreadth() — once daily after market open.
 *     Expensive: ~500 Polygon calls (one per S&P 500 ticker, batched).
 *
 * Both produce a complete MarketPulse object and write it to the disk
 * cache. The route reads from disk — no live calls in the request path.
 */
import {
  buildMarketPulseLive,
  computeRegime,
  getBreadth,
  type MarketPulse,
} from "./data/providers/market-pulse.adapter";
import { readMarketPulseSnapshot, writeMarketPulseSnapshot } from "./market-pulse-cache";

export async function warmIntradaySnapshot(): Promise<{ ok: boolean; tier: string }> {
  // Build everything except the expensive S&P 500 breadth walk.
  const live = await buildMarketPulseLive({ withBreadth: false });

  // Preserve the last cached breadth — it's a once-per-day computation,
  // not stale within the trading day in any meaningful way.
  const existing = readMarketPulseSnapshot();
  let breadth = existing?.breadth ?? live.breadth;

  // First-time cold start: no usable breadth in the cache. Walk the S&P
  // 500 once inline so the user sees real breadth numbers on the very
  // first page load instead of "—". Adds ~3 min to this run only;
  // subsequent intraday refreshes skip it (breadth is now cached).
  if (!breadth || breadth.universeSize == null || breadth.universeSize === 0) {
    try { breadth = await getBreadth(); } catch { /* keep whatever we had */ }
  }

  const merged: MarketPulse = {
    ...live,
    breadth,
    regime: computeRegime(live.volatility, breadth, live.riskAppetite),
  };
  writeMarketPulseSnapshot(merged);
  return { ok: true, tier: merged.regime.tier };
}

export async function warmDailyBreadth(): Promise<{ ok: boolean; universeSize: number | null }> {
  // Full pull including breadth. Replaces the cached snapshot in full.
  const live = await buildMarketPulseLive({ withBreadth: true });
  writeMarketPulseSnapshot(live);
  return { ok: true, universeSize: live.breadth.universeSize };
}
