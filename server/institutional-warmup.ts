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
import { isEdgarCircuitOpen, getEdgarCircuitStatus } from "./data/providers/edgar.client";
import { readInstitutionalFresh } from "./institutional-cache";
import { storage } from "./storage";

// Broad always-warm list — covers the institutional scan default universe.
// The scanner only shows tickers with warm EDGAR cache, so this list directly
// determines what users see when they hit Scan.
const ALWAYS_WARM = [
  // ETFs / benchmarks
  "SPY", "QQQ", "DIA", "IWM", "VTI", "VOO", "XLK", "XLF", "XLV", "XLE",
  "XLY", "XLP", "XLI", "XLU", "XLB", "XLRE", "XLC", "SMH", "ARKK",
  // Mega-cap tech
  "AAPL", "MSFT", "NVDA", "GOOGL", "GOOG", "AMZN", "META", "TSLA", "AVGO", "ORCL",
  "CRM", "ADBE", "NFLX", "AMD", "INTC", "QCOM", "CSCO", "IBM", "NOW", "PANW",
  "SNOW", "PLTR", "UBER", "ABNB", "SHOP", "PYPL", "ROKU", "COIN", "MSTR",
  // Financials
  "JPM", "BAC", "WFC", "GS", "MS", "C", "V", "MA", "AXP", "BLK",
  "SCHW", "SPGI", "CME", "ICE", "COF", "USB", "PNC", "TFC", "BRK-B",
  // Healthcare / pharma
  "UNH", "JNJ", "LLY", "ABBV", "MRK", "PFE", "TMO", "ABT", "DHR", "BMY",
  "AMGN", "GILD", "CVS", "MDT", "ISRG", "REGN", "VRTX", "ZTS",
  // Consumer
  "WMT", "COST", "HD", "LOW", "PG", "KO", "PEP", "MCD", "SBUX", "NKE",
  "TGT", "LULU", "CMG", "DIS", "BKNG", "TJX", "DG", "DLTR", "ULTA",
  // Industrials / energy
  "XOM", "CVX", "COP", "SLB", "EOG", "OXY", "PSX", "MPC", "VLO", "KMI", "OKE",
  "CAT", "DE", "HON", "GE", "BA", "LMT", "RTX", "NOC", "UPS", "FDX",
  // Semis / hardware
  "ASML", "TSM", "MU", "LRCX", "AMAT", "KLAC", "MRVL", "ARM", "ON",
  // Communication / internet
  "T", "VZ", "TMUS", "CMCSA", "SPOT", "PINS", "SNAP", "RBLX",
  // Utilities / REITs / dividends
  "NEE", "DUK", "SO", "D", "AEP", "O", "PLD", "AMT", "CCI", "SPG",
  "MO", "KMB", "CL", "MDLZ", "GIS", "KHC", "PM",
  // Popular mid-caps / individual favorites
  "F", "GM", "DAL", "AAL", "CCL", "NCLH", "MGM", "LVS", "WYNN",
  "SOFI", "HOOD", "RIVN", "LCID", "NIO", "DKNG", "PENN",
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

  // If EDGAR circuit is already open from a previous run, don't even try.
  // Every additional request while blocked may extend the Akamai cooldown.
  if (isEdgarCircuitOpen()) {
    const s = getEdgarCircuitStatus();
    console.warn(
      `[inst-warmup] aborting: EDGAR circuit breaker open ` +
      `(${s.minutesUntilRetry}min until retry). Skipping warmup entirely.`
    );
    res.errors = symbols.length;
    res.errorSymbols = symbols;
    res.durationMs = Date.now() - startedAt;
    return res;
  }

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
      // If a 403 just tripped the circuit breaker, stop the loop
      // immediately. Continuing through the remaining symbols would
      // queue more EDGAR calls (some of which short-circuit, but the
      // first call per ticker still increments cumulative pressure).
      if (isEdgarCircuitOpen()) {
        const remaining = symbols.length - i - 1;
        console.warn(
          `[inst-warmup] EDGAR circuit opened mid-run; aborting with ` +
          `${remaining} symbols unprocessed.`
        );
        for (let j = i + 1; j < symbols.length; j++) {
          res.errors++;
          res.errorSymbols.push(symbols[j]);
        }
        break;
      }
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
