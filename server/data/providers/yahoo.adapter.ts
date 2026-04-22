/**
 * Yahoo adapter — LEGACY FALLBACK ONLY.
 *
 * Kept alive to cover capabilities not yet migrated:
 *   - institutional_holdings (until EDGAR or FMP Premium is wired)
 *   - insider_transactions (until FMP is wired)
 *   - > 5y historical aggregates (until Polygon plan upgrade or Verdict redesign)
 *
 * Redistribution of Yahoo data in a paid SaaS is not licensed. This adapter
 * MUST be removed (or replaced with a licensed source) before Stock Otter
 * is generally available to paying customers.
 */
import type {
  DataProvider,
  Quote,
  OHLCV,
  InsiderTransaction,
  InstitutionalHolding,
  Symbol,
} from "../types";

export const yahooAdapter: DataProvider = {
  name: "yahoo",
  capabilities: ["quotes", "aggregates", "insider_transactions", "institutional_holdings"],

  async getQuote(symbol: Symbol): Promise<Quote> {
    // TODO: wrap existing Yahoo client
    throw new Error("NotImplemented: yahoo.getQuote");
  },

  async getAggregates(symbol: Symbol, from: Date, to: Date, timespan): Promise<OHLCV[]> {
    // TODO: wrap existing Yahoo chart client; used for >5y history only
    throw new Error("NotImplemented: yahoo.getAggregates");
  },

  async getInsiderTransactions(symbol: Symbol): Promise<InsiderTransaction[]> {
    // TODO: wrap quoteSummary(insiderHolders, insiderTransactions)
    throw new Error("NotImplemented: yahoo.getInsiderTransactions");
  },

  async getInstitutionalHoldings(symbol: Symbol): Promise<InstitutionalHolding[]> {
    // TODO: wrap quoteSummary(institutionOwnership, fundOwnership, majorHoldersBreakdown)
    throw new Error("NotImplemented: yahoo.getInstitutionalHoldings");
  },
};
