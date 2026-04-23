/**
 * Institutional (EDGAR 13F) disk cache warmup.
 *
 * Runs nightly via cron. Keeps the disk cache fresh for:
 *   - Open-trade symbols (so users see instant institutional data for what
 *     they actually track).
 *   - Always-warm floor: SPY/QQQ/DIA/IWM/VTI and mega-cap names.
 *   - Optional extra list: top-N by market cap from FMP screener.
 *
 * Serial execution per symbol because the EDGAR cold path is already heavy
 * (~25min for a brand-new ticker; hot path once top-filers cache is primed).
 * Never spawn parallel EDGAR fetches — SEC rate limits are 10 req/s.
 */
import { getInstitutionalSummary } from "./data/providers/edgar.adapter";
import { readInstitutionalFresh } from "./institutional-cache";
import { storage } from "./storage";

const ALWAYS_WARM = [
  "SPY", "QQQ", "DIA", "IWM", "VTI",
  "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA",
  "META", "TSLA", "BRK-B", "JPM", "V",
  "XOM", "UNH", "HD", "PG", "MA",
];

export interface WarmupResult {
  attempted: number;
  written: number;
  skipped: number; // already fresh
  errors: number;
  durationMs: number;
  skippedSymbols: string[];
  errorSymbols: string[];
}

async function collectSymbols(maxSymbols: number): Promise<string[]> {
  const set = new Set<string>(ALWAYS_WARM);

  // Add open-trade symbols (across all users, like price-snapshot cron does)
  try {
    const trades = await storage.getAllOpenTradesAllUsers?.();
    if (Array.isArray(trades)) {
      for (const t of trades) {
        const sym = ((t as any)?.ticker || (t as any)?.symbol || "").toString().toUpperCase();
        if (sym) set.add(sym);
      }
    }
  } catch {
    // ignore: warmup is best-effort
  }

  return Array.from(set).slice(0, maxSymbols);
}

/**
 * Warm the institutional disk cache. Skips symbols already fresh (<3d).
 * Serial to respect SEC rate limits. Logs every 10 symbols.
 */
export async function warmInstitutionalCache(opts: { maxSymbols?: number } = {}): Promise<WarmupResult> {
  const max = Math.min(opts.maxSymbols ?? 100, 500);
  const startedAt = Date.now();
  const symbols = await collectSymbols(max);
  console.log(`[inst-warmup] starting: ${symbols.length} symbols`);

  const res: WarmupResult = {
    attempted: symbols.length,
    written: 0,
    skipped: 0,
    errors: 0,
    durationMs: 0,
    skippedSymbols: [],
    errorSymbols: [],
  };

  for (let i = 0; i < symbols.length; i++) {
    const sym = symbols[i];
    if (readInstitutionalFresh(sym)) {
      res.skipped++;
      res.skippedSymbols.push(sym);
      continue;
    }
    try {
      const summary = await getInstitutionalSummary(sym, 25);
      if (summary) {
        res.written++;
      } else {
        res.errors++;
        res.errorSymbols.push(sym);
      }
    } catch (e: any) {
      res.errors++;
      res.errorSymbols.push(sym);
      console.warn(`[inst-warmup] ${sym} failed: ${String(e?.message || e)}`);
    }
    if ((i + 1) % 10 === 0 || i === symbols.length - 1) {
      const elapsed = Math.round((Date.now() - startedAt) / 1000);
      console.log(`[inst-warmup] progress ${i + 1}/${symbols.length} written=${res.written} skipped=${res.skipped} errors=${res.errors} [${elapsed}s]`);
    }
  }

  res.durationMs = Date.now() - startedAt;
  console.log(`[inst-warmup] done: written=${res.written} skipped=${res.skipped} errors=${res.errors} in ${Math.round(res.durationMs / 1000)}s`);
  return res;
}
