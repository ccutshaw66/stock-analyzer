/**
 * Normalized domain types for the data layer.
 * These are OUR schema, not any vendor's. Adapters translate into these.
 *
 * Rule: never leak vendor-specific fields out of an adapter.
 */

export type Symbol = string; // e.g. "AAPL"

export type Capability =
  | "quotes"
  | "aggregates"
  | "options"
  | "financials"
  | "analyst_ratings"
  | "earnings"
  | "insider_transactions"
  | "institutional_holdings"
  | "beta"
  | "search"
  | "dividends"
  | "splits";

export interface Quote {
  symbol: Symbol;
  price: number;
  change: number;
  changePct: number;
  volume: number;
  asOf: Date;
  source: string; // for debugging; never for business logic
}

export interface OHLCV {
  t: Date;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface OptionsContract {
  strike: number;
  expiry: Date;
  type: "call" | "put";
  openInterest: number;
  volume: number;
  iv: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  bid: number;
  ask: number;
  last: number;
}

export interface OptionsChain {
  symbol: Symbol;
  asOf: Date;
  underlyingPrice: number;
  contracts: OptionsContract[];
  source: string;
}

export interface AnalystRating {
  symbol: Symbol;
  asOf: Date;
  consensus: "strong_buy" | "buy" | "hold" | "sell" | "strong_sell";
  priceTargetLow: number;
  priceTargetAvg: number;
  priceTargetHigh: number;
  analystCount: number;
  source: string;
}

export interface EarningsEvent {
  symbol: Symbol;
  reportDate: Date;
  fiscalPeriod: string; // e.g. "Q1 2026"
  epsEstimate?: number;
  epsActual?: number;
  revenueEstimate?: number;
  revenueActual?: number;
  surprisePct?: number;
  source: string;
}

export interface InsiderTransaction {
  symbol: Symbol;
  insiderName: string;
  role: string;
  transactionDate: Date;
  transactionType: "buy" | "sell" | "award" | "exercise";
  shares: number;
  pricePerShare: number;
  totalValue: number;
  source: string;
}

export interface InstitutionalHolding {
  symbol: Symbol;
  reportDate: Date;
  institutionName: string;
  sharesHeld: number;
  sharesChange: number;
  percentOfFloat: number;
  source: string;
}

export interface FinancialSnapshot {
  symbol: Symbol;
  asOf: Date;
  revenue: number;
  netIncome: number;
  eps: number;
  peRatio?: number;
  pbRatio?: number;
  debtToEquity?: number;
  roe?: number;
  source: string;
}

export interface BetaValue {
  symbol: Symbol;
  beta: number;
  lookbackYears: number;
  benchmark: Symbol; // typically "SPY"
  computedAt: Date;
  source: string; // "in_house" for our calc
}

export interface DataProvider {
  name: string;
  capabilities: Capability[];

  getQuote?(symbol: Symbol): Promise<Quote>;
  getAggregates?(
    symbol: Symbol,
    from: Date,
    to: Date,
    timespan: "day" | "week" | "month"
  ): Promise<OHLCV[]>;
  getOptionsChain?(symbol: Symbol, expiry?: Date): Promise<OptionsChain>;
  getAnalystRatings?(symbol: Symbol): Promise<AnalystRating>;
  getEarnings?(symbol: Symbol, limit?: number): Promise<EarningsEvent[]>;
  getInsiderTransactions?(symbol: Symbol, limit?: number): Promise<InsiderTransaction[]>;
  getInstitutionalHoldings?(symbol: Symbol): Promise<InstitutionalHolding[]>;
  getFinancials?(symbol: Symbol, limit?: number): Promise<FinancialSnapshot[]>;
  searchTickers?(query: string, limit?: number): Promise<Array<{ symbol: Symbol; name: string }>>;
}
