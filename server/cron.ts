import { storage, db } from "./storage";
import { tradePriceHistory } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { registerJob } from "./platform/jobs/scheduler";

// Yahoo Finance helpers will be passed in from routes
let _getQuote: ((ticker: string) => Promise<any>) | null = null;
let _ensureReady: (() => Promise<void>) | null = null;

export function initCron(getQuote: (ticker: string) => Promise<any>, ensureReady: () => Promise<void>) {
  _getQuote = getQuote;
  _ensureReady = ensureReady;

  // Register the price-snapshot job with the Phase 2.5 scheduler.
  // Runs every hour at :00. The handler itself checks market hours so weekends
  // and off-hours are skipped cheaply. Keeping the runOnStart behavior by
  // triggering the scheduler's initial fire.
  registerJob({
    id: "price-snapshot",
    description: "Hourly price snapshot + P/L update for all open trades (market hours only)",
    cron: "0 * * * *",
    timeoutMs: 10 * 60 * 1000, // 10 min hard cap
    preventOverrun: true,
    runOnStart: true,
    handler: async () => {
      if (!isMarketHours()) return;
      await refreshAllOpenTrades();
    },
  });

  console.log("[CRON] Price snapshot job registered with scheduler (0 * * * *)");
}

function isMarketHours(): boolean {
  const now = new Date();
  // Convert to ET (UTC-5 standard, UTC-4 daylight)
  const etOffset = isDST(now) ? -4 : -5;
  const etHour = (now.getUTCHours() + etOffset + 24) % 24;
  const etMinute = now.getUTCMinutes();
  const dayOfWeek = now.getUTCDay(); // 0=Sun, 6=Sat

  // Skip weekends
  if (dayOfWeek === 0 || dayOfWeek === 6) return false;

  // Market hours: 9:30 AM - 4:00 PM ET
  const minutesSinceMidnight = etHour * 60 + etMinute;
  const marketOpen = 9 * 60 + 30;  // 9:30 AM
  const marketClose = 16 * 60;      // 4:00 PM

  return minutesSinceMidnight >= marketOpen && minutesSinceMidnight <= marketClose;
}

function isDST(date: Date): boolean {
  const jan = new Date(date.getFullYear(), 0, 1).getTimezoneOffset();
  const jul = new Date(date.getFullYear(), 6, 1).getTimezoneOffset();
  return date.getTimezoneOffset() < Math.max(jan, jul);
}

async function refreshAllOpenTrades() {
  try {
    if (!_getQuote || !_ensureReady) {
      console.log("[CRON] Not initialized yet, skipping");
      return;
    }

    await _ensureReady();
    const openTrades = await storage.getAllOpenTradesAllUsers();

    if (openTrades.length === 0) {
      console.log("[CRON] No open trades to refresh");
      return;
    }

    console.log(`[CRON] Refreshing ${openTrades.length} open trades across all users`);

    // Get unique symbols
    const uniqueSymbols = [...new Set(openTrades.map(t => t.symbol))];
    const priceMap: Record<string, number> = {};

    for (const sym of uniqueSymbols) {
      try {
        const data = await _getQuote(sym);
        if (data) {
          const price = data?.price?.regularMarketPrice?.raw;
          if (price) {
            priceMap[sym] = price;
          }
        }
        await new Promise(r => setTimeout(r, 400));
      } catch (e: any) {
        console.log(`[CRON] ${sym} failed: ${e?.message}`);
      }
    }

    // Update prices and record snapshots for each trade
    const today = new Date().toISOString().split("T")[0];
    let snapshotCount = 0;

    for (const trade of openTrades) {
      const price = priceMap[trade.symbol];
      if (price == null) continue;

      // Update current price
      await storage.updateTradePrice(trade.userId, trade.id, price);

      // Calculate unrealized P/L
      const multiplier = trade.tradeCategory === "Option" ? 100 : 1;
      const isCredit = trade.openPrice > 0;
      let unrealizedPL;
      if (isCredit) {
        unrealizedPL = (trade.openPrice - price) * trade.contractsShares * multiplier;
      } else {
        unrealizedPL = (price + trade.openPrice) * trade.contractsShares * multiplier;
      }
      unrealizedPL -= (trade.commIn || 0);

      // Dedupe: delete existing snapshot for this trade+date
      await db.delete(tradePriceHistory).where(
        and(
          eq(tradePriceHistory.tradeId, trade.id),
          eq(tradePriceHistory.date, today)
        )
      );

      // Record snapshot
      await storage.recordPriceSnapshot({
        tradeId: trade.id,
        userId: trade.userId,
        date: today,
        price,
        unrealizedPL,
      });
      snapshotCount++;
    }

    console.log(`[CRON] Recorded ${snapshotCount} price snapshots for ${uniqueSymbols.length} symbols`);
  } catch (error: any) {
    console.error("[CRON] Price snapshot job failed:", error?.message || error);
  }
}
