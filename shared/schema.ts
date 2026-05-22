import { pgTable, text, integer, serial, doublePrecision, timestamp, boolean, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  displayName: text("display_name"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  subscriptionTier: text("subscription_tier").default("free"),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  subscriptionExpiresAt: timestamp("subscription_expires_at"),
  hasSeenTour: boolean("has_seen_tour").default(false),
  lastLoginAt: timestamp("last_login_at"),
  // Per-account flag for the Ask Otter (Claude API) widget. Default false so
  // no paid Anthropic calls fire until the user opts in via settings. Server
  // route returns 503 unless this is true AND ANTHROPIC_API_KEY is set in env.
  askOtterEnabled: boolean("ask_otter_enabled").default(false),
});

export const favorites = pgTable("favorites", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  ticker: text("ticker").notNull(),
  companyName: text("company_name").notNull(),
  listType: text("list_type").notNull(), // "watchlist" or "portfolio"
  score: doublePrecision("score"),
  verdict: text("verdict"),
  sector: text("sector"),
  addedAt: text("added_at").notNull(),
});

// ─── Trade Tracker Tables ─────────────────────────────────────────────────────

export const trades = pgTable("trades", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  pilotOrAdd: text("pilot_or_add").notNull(), // "Pilot" or "Add"
  tradeDate: text("trade_date").notNull(),
  expiration: text("expiration"), // null for stock trades
  contractsShares: integer("contracts_shares").notNull(),
  symbol: text("symbol").notNull(),
  currentPrice: doublePrecision("current_price"),
  target: doublePrecision("target"),
  tradeType: text("trade_type").notNull(),
  tradeCategory: text("trade_category").notNull(),
  strikes: text("strikes"),
  openPrice: doublePrecision("open_price").notNull(),
  commIn: doublePrecision("comm_in").default(0),
  allocation: doublePrecision("allocation"),
  maxProfit: doublePrecision("max_profit"),
  closeDate: text("close_date"),
  closePrice: doublePrecision("close_price"),
  commOut: doublePrecision("comm_out").default(0),
  spreadWidth: doublePrecision("spread_width"),
  creditDebit: text("credit_debit"),
  tradePlanNotes: text("trade_plan_notes"),
  behaviorTag: text("behavior_tag"),
  // Which strategy opened this trade — drives Current Positions grouping +
  // strategy-specific lifecycle alerts. Defaults to 'manual' so existing rows
  // pre-migration still classify. Values come from STRATEGY_REGISTRY in
  // shared/strategies/registry.ts (htf | bbtc-ver | tft-40w | tft-60w |
  // tft-cat | amc | manual | other). When 'other', strategyReason captures
  // the free-text "why I took this trade" (e.g. "Steve recommended").
  strategy: text("strategy").default("manual").notNull(),
  strategyReason: text("strategy_reason"),
  // Strategy-specific snapshot captured at trade open. Each manifest in
  // shared/strategies/registry.ts defines its own shape (HTF stores
  // pole/flag/breakout/stop; BBTC stores entry/stop/exit-trigger; etc.).
  // jsonb so the schema doesn't need to change when a new strategy is added.
  strategyData: jsonb("strategy_data"),
  createdAt: text("created_at").notNull(),
});

export const accountSettings = pgTable("account_settings", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id).unique(),
  startingAccountValue: doublePrecision("starting_account_value").notNull().default(10000),
  commPerSharesTrade: doublePrecision("comm_per_shares_trade").default(0),
  commPerOptionContract: doublePrecision("comm_per_option_contract").default(0.65),
  maxAllocationPerTrade: doublePrecision("max_allocation_per_trade").default(500),
  totalAllocatedLimit: doublePrecision("total_allocated_limit").default(0.30),
  // Brokerage cash balance — manually entered to match the user's broker app.
  // Combined with open position market value to produce the "Total Portfolio"
  // figure shown at the top of Trade Tracker.
  // NOTE: when this column is added to a deployed env that hasn't run db:push
  // yet, getAccountSettings in storage.ts has a raw-SQL fallback that
  // tolerates the missing column, so deploys never 500 on a migration lag.
  cashBalance: doublePrecision("cash_balance").default(0),
  // HTF scanner overrides — null = use DEFAULT_ACCOUNT_CONFIG from
  // server/signals/risk/position-sizing.ts. Stored as full AccountConfig
  // JSON so we don't fragment the schema as new HTF knobs get added.
  htfConfig: jsonb("htf_config"),
});

export const accountTransactions = pgTable("account_transactions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  amount: doublePrecision("amount").notNull(),
  transType: text("trans_type").notNull(),
  date: text("date").notNull(),
  note: text("note"),
});

export const tradePriceHistory = pgTable("trade_price_history", {
  id: serial("id").primaryKey(),
  tradeId: integer("trade_id").notNull().references(() => trades.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => users.id),
  date: text("date").notNull(),
  price: doublePrecision("price").notNull(),
  unrealizedPL: doublePrecision("unrealized_pl"),
});

export const dividendPortfolio = pgTable("dividend_portfolio", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  ticker: text("ticker").notNull(),
  companyName: text("company_name").notNull(),
  shares: doublePrecision("shares").notNull(),
  avgCost: doublePrecision("avg_cost").notNull(),
  frequency: text("frequency"), // Monthly, Quarterly, Semi-Annual, Annual
  notes: text("notes"),
  addedAt: text("added_at").notNull(),
});

// Track Record — every signal logged with forward returns
export const signalLog = pgTable("signal_log", {
  id: serial("id").primaryKey(),
  ticker: text("ticker").notNull(),
  signalDate: text("signal_date").notNull(), // YYYY-MM-DD
  signalType: text("signal_type").notNull(), // BUY, SELL, STRONG_BUY, HOLD
  source: text("source").notNull(), // VER, AMC, BBTC, COMBINED, VERDICT
  score: doublePrecision("score"), // numeric score at time of signal
  priceAtSignal: doublePrecision("price_at_signal").notNull(),
  // Forward returns (filled in later by outcome checker)
  price7d: doublePrecision("price_7d"),
  price30d: doublePrecision("price_30d"),
  price90d: doublePrecision("price_90d"),
  return7d: doublePrecision("return_7d"), // percentage
  return30d: doublePrecision("return_30d"),
  return90d: doublePrecision("return_90d"),
  // Benchmark comparison
  spyReturn7d: doublePrecision("spy_return_7d"),
  spyReturn30d: doublePrecision("spy_return_30d"),
  spyReturn90d: doublePrecision("spy_return_90d"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Alerts (Phase 4.1) ────────────────────────────────────────────────────────────
// Triggered alert events (shown in bell dropdown). A rule produces many alerts
// over time; alerts have an unread flag and dismiss state. Rules are defined
// below in alert_rules.
export const alerts = pgTable("alerts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  ruleId: integer("rule_id"), // nullable — rule may be deleted but alert kept
  kind: text("kind").notNull(), // SCANNER_VERDICT | PRICE_TARGET | PRICE_STOP | EARNINGS | UNUSUAL_OPTIONS
  ticker: text("ticker"),
  title: text("title").notNull(),
  body: text("body").notNull(),
  meta: text("meta"), // JSON string: { verdict, score, price, etc }
  severity: text("severity").default("info").notNull(), // info | warn | critical
  read: boolean("read").default(false).notNull(),
  dismissed: boolean("dismissed").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// User-configured rules. Each rule emits alerts when its condition trips.
// Scanner rules watch a ticker list; per-trade rules reference a trade id.
export const alertRules = pgTable("alert_rules", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  kind: text("kind").notNull(), // SCANNER_VERDICT | PRICE_TARGET | PRICE_STOP | EARNINGS | UNUSUAL_OPTIONS
  enabled: boolean("enabled").default(true).notNull(),
  ticker: text("ticker"), // null = apply to all watchlist + open positions
  tradeId: integer("trade_id"), // for PRICE_TARGET / PRICE_STOP bound to a position
  // Trigger config (JSON-encoded knobs, e.g. { verdicts: ["GO ↑","SET ↑"] } or { daysBefore: 7 })
  config: text("config"),
  lastFiredAt: timestamp("last_fired_at"),
  lastFiredState: text("last_fired_state"), // dedupe key (e.g. last verdict seen)
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Conviction Compass forward-tracking ────────────────────────────────────
//
// Daily snapshot of the compass output for a curated ticker universe, plus
// forward returns at 1/5/30/90-day windows filled in by a separate cron.
// Used to backtest whether ALL_ALIGNED_BULLISH (etc) signals actually predict
// forward returns. Kept denormalized so aggregations are pure SQL — group by
// verdict, average each forward-return column.
export const compassSnapshots = pgTable("compass_snapshots", {
  id: serial("id").primaryKey(),
  ticker: text("ticker").notNull(),
  takenAt: timestamp("taken_at").notNull().defaultNow(),
  takenDate: text("taken_date").notNull(), // YYYY-MM-DD for easy date filtering
  spotPrice: doublePrecision("spot_price"),

  // Compass output (denormalized for fast aggregation)
  verdict: text("verdict").notNull(),
  confidence: text("confidence").notNull(),
  confluence: integer("confluence").notNull(),
  alignment: doublePrecision("alignment").notNull(),
  smartMoneyFlow: integer("smart_money_flow"),
  dealerPositioning: integer("dealer_positioning"),
  technicalMomentum: integer("technical_momentum"),
  fundamentalQuality: integer("fundamental_quality"),
  axesAvailable: integer("axes_available").notNull(), // 0..4

  // Forward returns — filled in by the updater cron once each window closes.
  // null while still pending. Stored as percent (e.g. 5.23 for +5.23%).
  return1d: doublePrecision("return_1d"),
  return5d: doublePrecision("return_5d"),
  return30d: doublePrecision("return_30d"),
  return90d: doublePrecision("return_90d"),

  // Full compass JSON for auditability / future re-aggregation
  compassJson: jsonb("compass_json"),
}, (t) => ({
  byTickerDate: index("compass_ticker_date_idx").on(t.ticker, t.takenDate),
  byTakenAt: index("compass_taken_at_idx").on(t.takenAt),
  byVerdict: index("compass_verdict_idx").on(t.verdict),
}));

// SPY baseline series — used by the backtest aggregator to compare
// per-verdict returns against "what SPY did over the same window."
// Same 1d/5d/30d/90d forward returns anchored on each takenDate.
export const spyBaselineReturns = pgTable("spy_baseline_returns", {
  takenDate: text("taken_date").primaryKey(), // YYYY-MM-DD
  spotPrice: doublePrecision("spot_price"),
  return1d: doublePrecision("return_1d"),
  return5d: doublePrecision("return_5d"),
  return30d: doublePrecision("return_30d"),
  return90d: doublePrecision("return_90d"),
});

// ─── Insert schemas ───────────────────────────────────────────────────────────

export const insertUserSchema = createInsertSchema(users).pick({
  email: true,
  password: true,
  displayName: true,
});

export const insertFavoriteSchema = createInsertSchema(favorites).omit({
  id: true,
});

export const insertTradeSchema = createInsertSchema(trades).omit({
  id: true,
});

export const insertAccountSettingsSchema = createInsertSchema(accountSettings).omit({
  id: true,
});

export const insertAccountTransactionSchema = createInsertSchema(accountTransactions).omit({
  id: true,
});

export const insertTradePriceHistorySchema = createInsertSchema(tradePriceHistory).omit({ id: true });

// ─── Dashboard Layouts (one row per user, JSONB blob) ─────────────────────────
// Per-user customizable dashboard layout (Phase 1B Round 7). Single JSONB
// column so the layout schema can evolve additively without migrations.
// See `shared/dashboard/types.ts` for the typed shape of `data`.
export const dashboardLayouts = pgTable("dashboard_layouts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id).unique(),
  data: jsonb("data").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export const insertDashboardLayoutSchema = createInsertSchema(dashboardLayouts).omit({ id: true });

// ─── HTF setups (Phase 6 — High Tight Flag scanner) ─────────────────────────
// One row per detected breakout from the nightly /htf scan. The actionable
// vs filtered split is determined by `actionable` + `blockedReason`.
export const htfSetups = pgTable("htf_setups", {
  id: serial("id").primaryKey(),
  runDate: text("run_date").notNull(),              // YYYY-MM-DD — scan date
  symbol: text("symbol").notNull(),
  pattern: text("pattern").notNull(),               // "HTF_Givens"
  breakoutDate: text("breakout_date").notNull(),    // YYYY-MM-DD
  breakoutPrice: doublePrecision("breakout_price").notNull(),
  targetPrice: doublePrecision("target_price").notNull(),
  stopPrice: doublePrecision("stop_price").notNull(),
  qualityScore: integer("quality_score").notNull(),
  poleGainPct: doublePrecision("pole_gain_pct").notNull(),
  poleDays: integer("pole_days").notNull(),
  flagDays: integer("flag_days").notNull(),
  flagPullbackPct: doublePrecision("flag_pullback_pct").notNull(),
  breakoutVolRatio: doublePrecision("breakout_vol_ratio").notNull(),
  // Position-sizing snapshot at scan time (so historical setups remain
  // interpretable even if AccountConfig changes later)
  recommendedShares: integer("recommended_shares").notNull(),
  positionValue: doublePrecision("position_value").notNull(),
  actualRisk: doublePrecision("actual_risk").notNull(),
  rewardRiskRatio: doublePrecision("reward_risk_ratio").notNull(),
  actionable: boolean("actionable").notNull(),
  blockedReason: text("blocked_reason"),
  warnings: jsonb("warnings"),                      // string[]
  sector: text("sector"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  byRunDate: index("htf_setups_run_date_idx").on(table.runDate),
  bySymbolDate: index("htf_setups_symbol_date_idx").on(table.symbol, table.breakoutDate),
}));
export const insertHtfSetupSchema = createInsertSchema(htfSetups).omit({ id: true, createdAt: true });
export const insertDividendPortfolioSchema = createInsertSchema(dividendPortfolio).omit({ id: true });
export const insertAlertSchema = createInsertSchema(alerts).omit({ id: true, createdAt: true });
export const insertAlertRuleSchema = createInsertSchema(alertRules).omit({ id: true, createdAt: true, lastFiredAt: true, lastFiredState: true });

// ─── SEC Form 4 insider transactions (dashboard insider widgets v2) ─────────
// One row per non-derivative transaction parsed from a Form 4 filing. The
// FMP-sourced /insider-trading/latest feed gives us a "good enough" view but
// can't tag 10b5-1 planned sales because the flag lives in the footnote text
// of the SEC XML, not in any structured field. This table backs the
// 10b5-1-aware sentiment view on /insiders.
//
// Dedupe: (filingAccessionNo, txIndex) is the natural key (one Form 4 can
// list multiple transactions; the same filing is fetched only once).
export const insiderForm4 = pgTable("insider_form4", {
  id: serial("id").primaryKey(),
  filingAccessionNo: text("filing_accession_no").notNull(), // SEC accession
  txIndex: integer("tx_index").notNull(),                   // 0-based row inside the filing
  filingDate: text("filing_date").notNull(),                // YYYY-MM-DD
  transactionDate: text("transaction_date").notNull(),      // YYYY-MM-DD
  ticker: text("ticker").notNull(),                         // issuer trading symbol (UPPER)
  issuerCik: text("issuer_cik").notNull(),
  reportingOwnerCik: text("reporting_owner_cik"),
  reportingOwnerName: text("reporting_owner_name").notNull(),
  // Relationship to issuer — pipe-joined ("Director|10%Owner|Officer:CEO")
  reportingOwnerRelation: text("reporting_owner_relation"),
  transactionCode: text("transaction_code").notNull(),      // P/S/A/F/M/...
  // "buy" / "sell" / "other" — derived from code + acquiredDisposedCode
  direction: text("direction").notNull(),
  shares: doublePrecision("shares").notNull(),
  pricePerShare: doublePrecision("price_per_share"),        // null if no price (gifts, etc.)
  totalValue: doublePrecision("total_value"),               // shares × price
  /** True if any footnote referenced by this txn mentions a 10b5-1 plan. */
  rule10b5_1: boolean("rule_10b5_1").default(false).notNull(),
  /** Concatenated footnote text the txn references; surfaced in UI tooltips. */
  footnotes: text("footnotes"),
  filingUrl: text("filing_url").notNull(),                  // link to SEC filing index
  fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
}, (t) => ({
  byTicker: index("insider_form4_ticker_idx").on(t.ticker, t.filingDate),
  byFilingDate: index("insider_form4_filing_date_idx").on(t.filingDate),
  byAccession: index("insider_form4_accession_idx").on(t.filingAccessionNo, t.txIndex),
}));
export const insertInsiderForm4Schema = createInsertSchema(insiderForm4).omit({ id: true, fetchedAt: true });

// ─── Morning Checklist log (dashboard rebuild v1) ──────────────────────────
// One row per user per trading day, capturing which items were checked + the
// daily focus note. `items` is a jsonb map of itemId → boolean so the
// checklist's item set can evolve additively without migrating the table.
// History view reads back the last N days; phase-2 "force lock" gate reads
// today's row to decide whether to block site access.
export const morningChecklistLog = pgTable("morning_checklist_log", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  date: text("date").notNull(),                       // YYYY-MM-DD (user's local trading day)
  completedAt: timestamp("completed_at").defaultNow().notNull(),
  items: jsonb("items").notNull(),                    // Record<itemId, boolean>
  focusNote: text("focus_note"),                      // one-sentence intention
}, (table) => ({
  byUserDate: index("morning_checklist_user_date_idx").on(table.userId, table.date),
}));
export const insertMorningChecklistLogSchema = createInsertSchema(morningChecklistLog).omit({ id: true, completedAt: true });

// ─── Types ────────────────────────────────────────────────────────────────────

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type InsertFavorite = z.infer<typeof insertFavoriteSchema>;
export type Favorite = typeof favorites.$inferSelect;
export type InsertTrade = z.infer<typeof insertTradeSchema>;
export type Trade = typeof trades.$inferSelect;
export type AccountSettings = typeof accountSettings.$inferSelect;
export type InsertAccountSettings = z.infer<typeof insertAccountSettingsSchema>;
export type AccountTransaction = typeof accountTransactions.$inferSelect;
export type InsertAccountTransaction = z.infer<typeof insertAccountTransactionSchema>;
export type TradePriceHistory = typeof tradePriceHistory.$inferSelect;
export type InsertTradePriceHistory = z.infer<typeof insertTradePriceHistorySchema>;
export type DividendPortfolioItem = typeof dividendPortfolio.$inferSelect;
export type InsertDividendPortfolioItem = z.infer<typeof insertDividendPortfolioSchema>;
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;
export type Alert = typeof alerts.$inferSelect;
export type MorningChecklistLog = typeof morningChecklistLog.$inferSelect;
export type InsertMorningChecklistLog = z.infer<typeof insertMorningChecklistLogSchema>;
export type InsiderForm4 = typeof insiderForm4.$inferSelect;
export type InsertInsiderForm4 = z.infer<typeof insertInsiderForm4Schema>;
export type InsertAlert = z.infer<typeof insertAlertSchema>;
export type AlertRule = typeof alertRules.$inferSelect;
export type InsertAlertRule = z.infer<typeof insertAlertRuleSchema>;
export type DashboardLayoutRow = typeof dashboardLayouts.$inferSelect;
export type InsertDashboardLayout = z.infer<typeof insertDashboardLayoutSchema>;
export type HtfSetup = typeof htfSetups.$inferSelect;
export type InsertHtfSetup = z.infer<typeof insertHtfSetupSchema>;

// ─── Trade Type Definitions ───────────────────────────────────────────────────

export const TRADE_TYPES = {
  C: { label: "Call", category: "Option", legs: 1, targetROI: 100, isCredit: false },
  P: { label: "Put", category: "Option", legs: 1, targetROI: 100, isCredit: false },
  SC: { label: "Short Call", category: "Option", legs: 1, targetROI: 100, isCredit: true },
  SP: { label: "Short Put", category: "Option", legs: 1, targetROI: 100, isCredit: true },
  CCS: { label: "Call Credit Spread", category: "Option", legs: 2, targetROI: 80, isCredit: true },
  CDS: { label: "Call Debit Spread", category: "Option", legs: 2, targetROI: 80, isCredit: false },
  PCS: { label: "Put Credit Spread", category: "Option", legs: 2, targetROI: 80, isCredit: true },
  PDS: { label: "Put Debit Spread", category: "Option", legs: 2, targetROI: 80, isCredit: false },
  CBFLY: { label: "Call Butterfly", category: "Option", legs: 3, targetROI: 200, isCredit: false },
  PBFLY: { label: "Put Butterfly", category: "Option", legs: 3, targetROI: 200, isCredit: false },
  CUBFLY: { label: "Call Unbal. Fly", category: "Option", legs: 3, targetROI: 0, isCredit: true },
  PUBFLY: { label: "Put Unbal. Fly", category: "Option", legs: 3, targetROI: 0, isCredit: true },
  CUBFLYD: { label: "Debit CUBFLY", category: "Option", legs: 3, targetROI: 0, isCredit: false },
  PUBFLYD: { label: "Debit PUBFLY", category: "Option", legs: 3, targetROI: 0, isCredit: false },
  CCTV: { label: "Call CTV", category: "Option", legs: 4, targetROI: 0, isCredit: true, isDualVertical: true },
  PCTV: { label: "Put CTV", category: "Option", legs: 4, targetROI: 0, isCredit: true, isDualVertical: true },
  DTC: { label: "Day Trade Call", category: "Option", legs: 1, targetROI: 50, isCredit: false },
  DTP: { label: "Day Trade Put", category: "Option", legs: 1, targetROI: 50, isCredit: false },
  DTCBFLY: { label: "DT Call Butterfly", category: "Option", legs: 3, targetROI: 200, isCredit: false },
  DTPBFLY: { label: "DT Put Butterfly", category: "Option", legs: 3, targetROI: 200, isCredit: false },
  DTS: { label: "Day Trade Shares", category: "Stock", legs: 0, targetROI: 25, isCredit: false },
  LONG: { label: "Long Stock", category: "Stock", legs: 0, targetROI: 25, isCredit: false },
  SHORT: { label: "Short Stock", category: "Stock", legs: 0, targetROI: 25, isCredit: true },
} as const;

export type TradeTypeCode = keyof typeof TRADE_TYPES;

export const BEHAVIOR_TAGS = [
  "All to Plan",
  "Fear / Panic",
  "Greed / FOMO",
  "Bias / Stubborn",
  "Feed the Pigeons",
  "Other Issue",
] as const;
