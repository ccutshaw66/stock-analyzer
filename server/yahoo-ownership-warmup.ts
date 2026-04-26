/**
 * Yahoo ownership cache warmup.
 *
 * Runs nightly via cron (4:30am ET — see server/cron.ts). Pre-fills the
 * in-memory cache for fund-ownership / institution-ownership / major-holder-
 * breakdown data so user requests on the institutional page hit the cache
 * instead of falling through to a live Yahoo call.
 *
 * Yahoo is rate-limited (429s start at ~50 req/min sustained) and slow on
 * the request path (~1-3s per ticker including crumb refresh), so the goal
 * here is: by 9:30am ET market open, every always-warm symbol has fresh
 * ownership data ready to serve from RAM.
 *
 * Symbol set mirrors institutional-warmup: ALWAYS_WARM (mega-caps, sector
 * ETFs, popular dividend & momentum names) plus every symbol that appears
 * in any user's open trades. Capped at 250 symbols by default to keep a
 * worst-case 250 * 1.5s = ~6min run well under any reasonable timeout.
 *
 * Serial execution because Yahoo's per-IP rate limit doesn't reward
 * parallelism, and the existing yahoo-fetch queue inside routes.ts already
 * single-flights through one shared crumb.
 */
import { getYahooOwnership } from "./routes";
import { storage } from "./storage";

// Same always-warm list as institutional-warmup. Kept inline (not imported)
// so the two warmup modules can be tuned independently — e.g. you might
// want a smaller Yahoo set if rate limits get tighter, without shrinking
// the EDGAR warmup set.
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

export interface OwnershipWarmupResult {
  attempted: number;
  written: number;
  errors: number;
  durationMs: number;
  errorSymbols: string[];
}

async function collectSymbols(maxSymbols: number): Promise<string[]> {
  const set = new Set<string>(ALWAYS_WARM);
  try {
    const trades = await storage.getAllOpenTradesAllUsers?.();
    if (Array.isArray(trades)) {
      for (const t of trades) {
        const sym = ((t as any)?.ticker || (t as any)?.symbol || "")
          .toString()
          .toUpperCase();
        if (sym) set.add(sym);
      }
    }
  } catch {
    // best-effort: missing open trades shouldn't kill the warmup
  }
  return Array.from(set).slice(0, maxSymbols);
}

/**
 * Warm the Yahoo ownership cache. Calls getYahooOwnership for each symbol;
 * the helper itself handles caching, so this is just driving the keys we
 * want pre-populated. Serial execution + a 400ms inter-call delay keeps us
 * comfortably under Yahoo's per-IP rate limit (~50 req/min sustained).
 */
export async function warmYahooOwnershipCache(
  opts: { maxSymbols?: number; delayMs?: number } = {}
): Promise<OwnershipWarmupResult> {
  const max = Math.min(opts.maxSymbols ?? 250, 500);
  const delay = opts.delayMs ?? 400;
  const startedAt = Date.now();
  const symbols = await collectSymbols(max);
  console.log(`[yahoo-ownership-warmup] starting: ${symbols.length} symbols`);

  const res: OwnershipWarmupResult = {
    attempted: symbols.length,
    written: 0,
    errors: 0,
    durationMs: 0,
    errorSymbols: [],
  };

  for (let i = 0; i < symbols.length; i++) {
    const sym = symbols[i];
    try {
      const data = await getYahooOwnership(sym);
      // Treat all-null as a failure for reporting purposes (the helper
      // returns the empty shape on Yahoo errors). The cache still gets
      // a short-TTL entry written so behaviour is correct either way.
      const hasAny =
        data?.institutionOwnership ||
        data?.fundOwnership ||
        data?.majorHoldersBreakdown;
      if (hasAny) {
        res.written++;
      } else {
        res.errors++;
        res.errorSymbols.push(sym);
      }
    } catch (e: any) {
      res.errors++;
      res.errorSymbols.push(sym);
      console.warn(
        `[yahoo-ownership-warmup] ${sym} failed: ${String(e?.message || e)}`
      );
    }
    if ((i + 1) % 20 === 0 || i === symbols.length - 1) {
      const elapsed = Math.round((Date.now() - startedAt) / 1000);
      console.log(
        `[yahoo-ownership-warmup] progress ${i + 1}/${symbols.length}` +
          ` written=${res.written} errors=${res.errors} [${elapsed}s]`
      );
    }
    if (delay > 0 && i < symbols.length - 1) {
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  res.durationMs = Date.now() - startedAt;
  console.log(
    `[yahoo-ownership-warmup] done: written=${res.written}` +
      ` errors=${res.errors} in ${Math.round(res.durationMs / 1000)}s`
  );
  return res;
}
