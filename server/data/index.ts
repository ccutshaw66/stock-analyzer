/**
 * Public facade for the data layer.
 * The rest of the app ONLY imports from here.
 *
 * This file does three things:
 *   1. Picks the right provider via the registry
 *   2. Walks the fallback chain on error
 *   3. Caches results at the capability level
 */
import { providersFor } from "./registry";
import { cacheKey, getCached, setCached } from "./cache";
import type {
  Symbol,
  Quote,
  OHLCV,
  OptionsChain,
  AnalystRating,
  EarningsEvent,
  InsiderTransaction,
  InstitutionalHolding,
  FinancialSnapshot,
  BetaValue,
  Capability,
} from "./types";

async function withFallback<T>(
  cap: Capability,
  method: keyof import("./types").DataProvider,
  args: unknown[],
  key: string
): Promise<T> {
  const cached = getCached<T>(key);
  if (cached) return cached;

  const providers = providersFor(cap);
  let lastErr: unknown;
  for (const p of providers) {
    const fn = (p as unknown as Record<string, unknown>)[method as string] as
      | ((...a: unknown[]) => Promise<T>)
      | undefined;
    if (!fn) continue;
    try {
      const result = await fn.apply(p, args);
      setCached(key, result, cap);
      return result;
    } catch (err) {
      lastErr = err;
      // TODO: log warn via telemetry module
    }
  }
  throw lastErr ?? new Error(`No provider available for capability: ${cap}`);
}

export const data = {
  getQuote: (symbol: Symbol) =>
    withFallback<Quote>("quotes", "getQuote", [symbol], cacheKey("quotes", symbol)),

  getAggregates: (symbol: Symbol, from: Date, to: Date, timespan: "day" | "week" | "month") =>
    withFallback<OHLCV[]>(
      "aggregates",
      "getAggregates",
      [symbol, from, to, timespan],
      cacheKey("aggregates", symbol, timespan, +from, +to)
    ),

  getOptionsChain: (symbol: Symbol, expiry?: Date) =>
    withFallback<OptionsChain>(
      "options",
      "getOptionsChain",
      [symbol, expiry],
      cacheKey("options", symbol, expiry ? +expiry : "all")
    ),

  getAnalystRatings: (symbol: Symbol) =>
    withFallback<AnalystRating>("analyst_ratings", "getAnalystRatings", [symbol], cacheKey("analyst_ratings", symbol)),

  getEarnings: (symbol: Symbol, limit = 8) =>
    withFallback<EarningsEvent[]>("earnings", "getEarnings", [symbol, limit], cacheKey("earnings", symbol, limit)),

  getInsiderTransactions: (symbol: Symbol, limit = 50) =>
    withFallback<InsiderTransaction[]>("insider_transactions", "getInsiderTransactions", [symbol, limit], cacheKey("insider_transactions", symbol, limit)),

  getInstitutionalHoldings: (symbol: Symbol) =>
    withFallback<InstitutionalHolding[]>("institutional_holdings", "getInstitutionalHoldings", [symbol], cacheKey("institutional_holdings", symbol)),

  getFinancials: (symbol: Symbol, limit = 8) =>
    withFallback<FinancialSnapshot[]>("financials", "getFinancials", [symbol, limit], cacheKey("financials", symbol, limit)),

  getBeta: (symbol: Symbol) =>
    withFallback<BetaValue>("beta", "getBeta", [symbol], cacheKey("beta", symbol)),

  searchTickers: (query: string, limit = 10) =>
    withFallback<Array<{ symbol: Symbol; name: string }>>(
      "search",
      "searchTickers",
      [query, limit],
      cacheKey("search", query, limit)
    ),
};

export type { Symbol, Quote, OHLCV, OptionsChain, AnalystRating, EarningsEvent, InsiderTransaction, InstitutionalHolding, FinancialSnapshot, BetaValue };
