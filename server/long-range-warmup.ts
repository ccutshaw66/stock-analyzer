/**
 * Long-range disk-cache warmup.
 *
 * Phase 3.7: Yahoo is a BACKGROUND cache filler. This module runs out-of-band
 * (via cron) to pull 10y/25y/max chart data from Yahoo for a curated symbol
 * list and write it to disk. No user request ever triggers Yahoo live.
 *
 * Symbol list is sourced from:
 *   - All symbols appearing in open trades across all users
 *   - A curated floor of always-on tickers (major indices / liquid names)
 *
 * Rate-limiting: serialized via enqueue() (same queue as the buffer path),
 * with ~400ms spacing between symbols to stay polite to Yahoo.
 */
import { storage } from "./storage";
import { enqueue } from "./request-queue";
import { writeLongRange, listLongRange } from "./long-range-cache";

const YF_QUERY_BASE = "https://query1.finance.yahoo.com";

// Always-on floor: major indices, top mega-caps used in Verdict baselines.
// Keeps the 25y test hot even for brand-new installs with no trades yet.
const ALWAYS_WARM = [
  "SPY", "QQQ", "DIA", "IWM", "VTI",
  "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA", "BRK-B", "JPM", "V",
];

// Which (range, interval) pairs to prefetch per symbol.
const WARMUP_TARGETS: { range: string; interval: string }[] = [
  { range: "10y", interval: "1wk" },
  { range: "25y", interval: "1mo" },
  { range: "max", interval: "1mo" },
];

// Minimum age before we refresh an already-cached entry (days).
const REFRESH_IF_OLDER_THAN_DAYS = 3;

async function fetchYahooChart(ticker: string, range: string, interval: string): Promise<any | null> {
  const url = `${YF_QUERY_BASE}/v8/finance/chart/${encodeURIComponent(ticker)}?range=${range}&interval=${interval}&includePrePost=false`;
  // NB: this pulls in routes-layer yahooFetch indirectly by using the same
  // global queue. We bypass the full crumb flow because public /v8/chart
  // does not require a crumb (only /v10/quoteSummary does).
  const resp = await enqueue(async () => {
    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        "Accept": "application/json,text/plain,*/*",
      },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }, `warmup:${ticker}:${range}`);
  return resp?.chart?.result?.[0] || null;
}

async function collectTickers(): Promise<string[]> {
  const set = new Set<string>(ALWAYS_WARM);
  try {
    const trades = await storage.getAllOpenTradesAllUsers();
    for (const t of trades) {
      if (t.symbol && typeof t.symbol === "string") set.add(t.symbol.toUpperCase());
    }
  } catch (e: any) {
    console.log(`[long-range-warmup] could not enumerate open trades: ${e?.message || e}`);
  }
  return Array.from(set);
}

export async function warmLongRangeCache(opts?: { maxSymbols?: number }): Promise<{
  attempted: number;
  written: number;
  skipped: number;
  errors: number;
  durationMs: number;
}> {
  const start = Date.now();
  const maxSymbols = opts?.maxSymbols ?? 500;
  const tickers = (await collectTickers()).slice(0, maxSymbols);

  // Index existing cache by key for quick freshness check
  const existing = new Map<string, number>();
  for (const row of listLongRange()) {
    existing.set(`${row.ticker}__${row.range}__${row.interval}`, row.ageHours);
  }

  const refreshThresholdHours = REFRESH_IF_OLDER_THAN_DAYS * 24;
  let attempted = 0, written = 0, skipped = 0, errors = 0;

  for (const ticker of tickers) {
    for (const { range, interval } of WARMUP_TARGETS) {
      const key = `${ticker}__${range}__${interval}`;
      const ageHours = existing.get(key);
      if (ageHours != null && ageHours < refreshThresholdHours) {
        skipped++;
        continue;
      }
      attempted++;
      try {
        const payload = await fetchYahooChart(ticker, range, interval);
        if (payload) {
          writeLongRange(ticker, range, interval, payload);
          written++;
        } else {
          errors++;
        }
      } catch (e: any) {
        errors++;
        console.log(`[long-range-warmup] ${ticker} ${range}/${interval} failed: ${e?.message || e}`);
      }
      // Polite spacing
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  const durationMs = Date.now() - start;
  console.log(`[long-range-warmup] done: ${tickers.length} tickers, ${attempted} fetched, ${written} written, ${skipped} skipped, ${errors} errors in ${Math.round(durationMs / 1000)}s`);
  return { attempted, written, skipped, errors, durationMs };
}
