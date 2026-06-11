/**
 * Long-range disk-cache warmup.
 *
 * FMP background cache filler. This module runs out-of-band (via cron) to
 * pull 10y/25y/max chart data from FMP for a curated symbol list and write
 * it to disk. No user request ever triggers a live deep-history fetch.
 *
 * FMP Ultimate serves daily EOD history back to ~2000 via
 * `/historical-price-eod/full?symbol=&from=&to=`. That endpoint caps each
 * response at ~5000 rows (≈20 trading years), so for true 25y/max history
 * we chunk the date range into ≤8-year windows and stitch the results.
 *
 * Symbol list is sourced from:
 *   - All symbols appearing in open trades across all users
 *   - A curated floor of always-on tickers (major indices / liquid names)
 *
 * Rate-limiting: serialized via enqueue() (same queue as the buffer path),
 * with ~250ms spacing between symbols.
 */
import { storage } from "./storage";
import { enqueue } from "./request-queue";
import { writeLongRange, listLongRange } from "./long-range-cache";
import { fmpGet } from "./data/providers/fmp.client";

// Always-on floor: major indices, top mega-caps used in Verdict baselines.
// Keeps the 25y test hot even for brand-new installs with no trades yet.
const ALWAYS_WARM = [
  "SPY", "QQQ", "DIA", "IWM", "VTI",
  "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA", "BRK-B", "JPM", "V",
];

// Which (range, interval) pairs to prefetch per symbol. The interval is
// carried through to the cache key for compatibility with the chart route;
// FMP serves daily bars and the consumer downsamples for display.
const WARMUP_TARGETS: { range: string; interval: string; years: number }[] = [
  { range: "10y", interval: "1wk", years: 10 },
  { range: "25y", interval: "1mo", years: 25 },
  { range: "max", interval: "1mo", years: 40 },
];

// Minimum age before we refresh an already-cached entry (days).
const REFRESH_IF_OLDER_THAN_DAYS = 3;

// FMP caps /historical-price-eod/full at ~5000 rows (~20 trading years).
// Chunk in 8-year windows so even the deepest history stitches cleanly with
// margin to spare.
const CHUNK_YEARS = 8;

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Pull deep daily history from FMP, chunked to dodge the 5000-row cap, and
 * convert to the canonical chart payload the chart route already serves
 * from disk: { timestamp: number[], indicators: { quote: [{ close, ... }] } }.
 */
async function fetchFmpLongRange(ticker: string, years: number): Promise<any | null> {
  const now = new Date();
  const start = new Date(now.getFullYear() - years, now.getMonth(), now.getDate());
  // Build chunk boundaries [from, to] in ascending time.
  const chunks: Array<{ from: string; to: string }> = [];
  let cursor = new Date(start);
  while (cursor < now) {
    const chunkEnd = new Date(cursor.getFullYear() + CHUNK_YEARS, cursor.getMonth(), cursor.getDate());
    const to = chunkEnd < now ? chunkEnd : now;
    chunks.push({ from: ymd(cursor), to: ymd(to) });
    cursor = new Date(to.getTime() + 24 * 60 * 60 * 1000);
  }

  const byDate = new Map<string, any>();
  for (const { from, to } of chunks) {
    const rows = await enqueue(async () => {
      const raw: any = await fmpGet("/historical-price-eod/full", { symbol: ticker, from, to });
      return Array.isArray(raw) ? raw : (raw?.historical || []);
    }, `lr-warmup:${ticker}:${from}`);
    for (const r of rows) {
      if (r && r.date) byDate.set(String(r.date), r);
    }
  }

  if (byDate.size === 0) return null;
  const asc = Array.from(byDate.values()).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return {
    timestamp: asc.map((r) => Math.floor(new Date(r.date).getTime() / 1000)),
    indicators: {
      quote: [{
        close: asc.map((r) => Number(r.close)),
        open: asc.map((r) => Number(r.open)),
        high: asc.map((r) => Number(r.high)),
        low: asc.map((r) => Number(r.low)),
        volume: asc.map((r) => Number(r.volume)),
      }],
    },
  };
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
    for (const { range, interval, years } of WARMUP_TARGETS) {
      const key = `${ticker}__${range}__${interval}`;
      const ageHours = existing.get(key);
      if (ageHours != null && ageHours < refreshThresholdHours) {
        skipped++;
        continue;
      }
      attempted++;
      try {
        const payload = await fetchFmpLongRange(ticker, years);
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
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  const durationMs = Date.now() - start;
  console.log(`[long-range-warmup] done: ${tickers.length} tickers, ${attempted} fetched, ${written} written, ${skipped} skipped, ${errors} errors in ${Math.round(durationMs / 1000)}s`);
  return { attempted, written, skipped, errors, durationMs };
}
