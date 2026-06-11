/**
 * CompanySnapshot — single source of truth for everything we display about
 * a ticker. Every page (verdict, analyze, scanner, watchlist, institutional)
 * will eventually read from this exact shape.
 *
 * Design rules:
 *   1. Every top-level field is wrapped in FieldHealth so the UI can show
 *      "via EDGAR (live)" / "via FMP" / "no source available".
 *   2. Every value is in OUR units, not the vendor's. No more 0.05-vs-5%
 *      drift between code paths.
 *   3. Adapters never return raw vendor blobs. They translate to these shapes
 *      and tag with the source they used.
 */

export type ProviderSource = "polygon" | "fmp" | "edgar" | "in-house";

export interface ProviderAttempt {
  source: ProviderSource;
  ok: boolean;
  ms: number;
  empty?: boolean;
  error?: string;
}

export interface FieldHealth<T> {
  value: T | null;
  source: ProviderSource | null;
  attempts: ProviderAttempt[];
  fetchedAt: number;
  ttlMs: number;
  cached: boolean;
  stale?: boolean;
}

// ─── Quote ──────────────────────────────────────────────────────────────────

export interface CompanyQuote {
  shortName: string | null;
  longName: string | null;
  currency: string | null;
  price: number | null;
  change: number | null;
  changePct: number | null;
  volume: number | null;
  averageVolume: number | null;
  marketCap: number | null;
  trailingPE: number | null;
  forwardPE: number | null;
  eps: number | null;
  dividendYield: number | null;
  beta: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
}

// ─── Fundamentals ───────────────────────────────────────────────────────────

export interface CompanyFundamentals {
  revenue: number | null;
  revenueGrowth: number | null;
  grossMargin: number | null;
  operatingMargin: number | null;
  profitMargin: number | null;
  ebitdaMargin: number | null;
  netIncome: number | null;
  earningsGrowth: number | null;
  payoutRatio: number | null;
  debtToEquity: number | null;
  currentRatio: number | null;
  returnOnEquity: number | null;
  totalDebt: number | null;
  totalCash: number | null;
  freeCashFlow: number | null;
  operatingCashFlow: number | null;
}

// ─── Profile ────────────────────────────────────────────────────────────────

export interface CompanyProfile {
  cik: string | null;
  cusip: string | null;
  sector: string | null;
  industry: string | null;
  exchange: string | null;
  description: string | null;
  ipoDate: string | null;
  employees: number | null;
  website: string | null;
}

// ─── Historical returns ────────────────────────────────────────────────────

export interface HistoricalReturns {
  oneYear: number | null;
  threeYear: number | null;
  fiveYear: number | null;
}

// ─── Ownership (institutional + insider holdings + funds) ──────────────────

export interface InstitutionalHolderRow {
  name: string;
  shares: number;
  value: number;
  pctHeld: number;       // percent of shares outstanding (0..100)
  changeQoQ: number;     // percent change quarter-over-quarter
  reportDate: string | null;
  cik?: string;
  accession?: string;
}

export interface FundHolderRow {
  name: string;
  shares: number;
  value: number;
  pctHeld: number;
  changeQoQ: number;
  reportDate: string | null;
}

export interface InsiderHolderRow {
  name: string;
  relation: string;
  sharesDirect: number;
  sharesIndirect: number;
  latestTransaction: string | null;
  latestDate: string | null;
}

export type FlowSignal =
  | "STRONG INFLOW"
  | "ACCUMULATING"
  | "NEUTRAL"
  | "DISTRIBUTING"
  | "STRONG OUTFLOW";

export interface CompanyOwnership {
  // 13F summary (EDGAR-authoritative)
  institutionPct: number;          // 0..100
  institutionCount: number;
  sharesOutstanding: number | null;
  asOf: string | null;

  // Lists
  topInstitutions: InstitutionalHolderRow[];
  topFunds: FundHolderRow[];
  insiderHolders: InsiderHolderRow[];
  insiderPct: number;              // 0..100

  // Derived flow
  flowScore: number;               // -100..+100
  signal: FlowSignal;
  instInflow: number;
  instOutflow: number;
  instIncreased: number;
  instDecreased: number;
  instNew: number;
  instSoldOut: number;
}

// ─── Insider transactions (Form 4) ─────────────────────────────────────────

export interface InsiderTxnRow {
  insider: string;
  relation: string;
  type: string;                    // plain-English label
  typeCode: string;                // raw SEC code (P/S/M/F/...)
  meaningful: boolean;             // true for P/S, false for admin
  direction: "buy" | "sell" | "neutral";
  explain: string;
  shares: number;
  value: number;
  date: string | null;
}

export interface CompanyInsiderActivity {
  recentTransactions: InsiderTxnRow[];
  buyCount: number;
  sellCount: number;
  buyShares: number;
  sellShares: number;
  netShares: number;
  windowDays: number;              // how far back the count covers
}

// ─── Analyst ───────────────────────────────────────────────────────────────

export interface CompanyAnalyst {
  consensus: "STRONG BUY" | "BUY" | "HOLD" | "SELL" | "STRONG SELL" | null;
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
  analystCount: number;
  targetMean: number | null;
  targetHigh: number | null;
  targetLow: number | null;
}

// ─── Earnings ──────────────────────────────────────────────────────────────

export interface EarningsHistoryRow {
  date: string;
  fiscalPeriod: string | null;
  epsEstimate: number | null;
  epsActual: number | null;
  surprisePct: number | null;
}

export interface CompanyEarnings {
  nextReportDate: string | null;
  isEstimated: boolean;
  history: EarningsHistoryRow[];
}

// ─── Snapshot ──────────────────────────────────────────────────────────────

export interface CompanySnapshot {
  ticker: string;
  asOf: number;                    // epoch ms
  schemaVersion: number;

  quote: FieldHealth<CompanyQuote>;
  fundamentals: FieldHealth<CompanyFundamentals>;
  profile: FieldHealth<CompanyProfile>;
  returns: FieldHealth<HistoricalReturns>;
  ownership: FieldHealth<CompanyOwnership>;
  insiderActivity: FieldHealth<CompanyInsiderActivity>;
  analyst: FieldHealth<CompanyAnalyst>;
  earnings: FieldHealth<CompanyEarnings>;
}

export const SNAPSHOT_SCHEMA_VERSION = 1;
