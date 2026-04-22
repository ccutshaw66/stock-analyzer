/**
 * FMP adapter.
 *
 * Covers: analyst ratings, earnings estimates/surprises, insider transactions,
 * (on Premium+) institutional holdings via 13F, fundamentals fallback.
 *
 * Tier assumed: Premium ($59/mo). Rate limit: 750/min.
 *
 * LEGAL NOTE: FMP individual plans prohibit redistribution. Upgrade to the
 * Build/Enterprise commercial tier before Stock Otter has paying users.
 */
import type {
  DataProvider,
  AnalystRating,
  EarningsEvent,
  InsiderTransaction,
  InstitutionalHolding,
  FinancialSnapshot,
  Symbol,
} from "../types";

export const fmpAdapter: DataProvider = {
  name: "fmp",
  capabilities: ["analyst_ratings", "earnings", "insider_transactions", "institutional_holdings", "financials"],

  async getAnalystRatings(symbol: Symbol): Promise<AnalystRating> {
    // TODO: GET /api/v3/analyst-estimates/{symbol}
    //       GET /api/v4/price-target-consensus?symbol={symbol}
    throw new Error("NotImplemented: fmp.getAnalystRatings");
  },

  async getEarnings(symbol: Symbol, limit = 8): Promise<EarningsEvent[]> {
    // TODO: GET /api/v3/earnings-surprises/{symbol}
    //       GET /api/v3/historical/earning_calendar/{symbol}?limit={limit}
    throw new Error("NotImplemented: fmp.getEarnings");
  },

  async getInsiderTransactions(symbol: Symbol, limit = 50): Promise<InsiderTransaction[]> {
    // TODO: GET /api/v4/insider-trading?symbol={symbol}&limit={limit}
    throw new Error("NotImplemented: fmp.getInsiderTransactions");
  },

  async getInstitutionalHoldings(symbol: Symbol): Promise<InstitutionalHolding[]> {
    // TODO: GET /api/v3/institutional-holder/{symbol}  (Premium+)
    throw new Error("NotImplemented: fmp.getInstitutionalHoldings");
  },

  async getFinancials(symbol: Symbol, limit = 8): Promise<FinancialSnapshot[]> {
    // TODO: GET /api/v3/income-statement/{symbol}?limit={limit}
    //       GET /api/v3/ratios-ttm/{symbol}
    throw new Error("NotImplemented: fmp.getFinancials");
  },
};
