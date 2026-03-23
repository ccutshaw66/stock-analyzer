import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const favorites = sqliteTable("favorites", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ticker: text("ticker").notNull(),
  companyName: text("company_name").notNull(),
  listType: text("list_type").notNull(), // "watchlist" or "portfolio"
  score: real("score"),
  verdict: text("verdict"),
  sector: text("sector"),
  addedAt: text("added_at").notNull(),
});

// ─── Trade Tracker Tables ─────────────────────────────────────────────────────

export const trades = sqliteTable("trades", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  pilotOrAdd: text("pilot_or_add").notNull(), // "Pilot" or "Add"
  tradeDate: text("trade_date").notNull(),
  expiration: text("expiration"), // null for stock trades
  contractsShares: integer("contracts_shares").notNull(),
  symbol: text("symbol").notNull(),
  currentPrice: real("current_price"),
  target: real("target"),
  tradeType: text("trade_type").notNull(), // C, P, CCS, PCS, CDS, PDS, CBFLY, PBFLY, etc.
  tradeCategory: text("trade_category").notNull(), // "Stock" or "Option"
  strikes: text("strikes"), // e.g. "55/60" or "32.5/40/47.5"
  openPrice: real("open_price").notNull(), // negative=debit, positive=credit
  commIn: real("comm_in").default(0),
  allocation: real("allocation"), // risk $ amount
  maxProfit: real("max_profit"),
  closeDate: text("close_date"),
  closePrice: real("close_price"),
  commOut: real("comm_out").default(0),
  spreadWidth: real("spread_width"),
  creditDebit: text("credit_debit"), // "CREDIT" or "DEBIT"
  tradePlanNotes: text("trade_plan_notes"),
  behaviorTag: text("behavior_tag"), // Panic, FOMO, Bias, Other, Feed the Pigeons, All to Plan
  createdAt: text("created_at").notNull(),
});

export const accountSettings = sqliteTable("account_settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  startingAccountValue: real("starting_account_value").notNull().default(10000),
  commPerSharesTrade: real("comm_per_shares_trade").default(0),
  commPerOptionContract: real("comm_per_option_contract").default(0.65),
  maxAllocationPerTrade: real("max_allocation_per_trade").default(500),
  totalAllocatedLimit: real("total_allocated_limit").default(0.30),
});

export const accountTransactions = sqliteTable("account_transactions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  amount: real("amount").notNull(),
  transType: text("trans_type").notNull(), // Deposit, Withdrawal, Reconcile
  date: text("date").notNull(),
  note: text("note"),
});

// ─── Insert schemas ───────────────────────────────────────────────────────────

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
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

// ─── Trade Type Definitions ───────────────────────────────────────────────────

export const TRADE_TYPES = {
  // Options - Singles
  C: { label: "Call", category: "Option", legs: 1, targetROI: 100 },
  P: { label: "Put", category: "Option", legs: 1, targetROI: 100 },
  SC: { label: "Short Call", category: "Option", legs: 1, targetROI: 100 },
  SP: { label: "Short Put", category: "Option", legs: 1, targetROI: 100 },
  // Options - Verticals
  CCS: { label: "Call Credit Spread", category: "Option", legs: 2, targetROI: 80 },
  CDS: { label: "Call Debit Spread", category: "Option", legs: 2, targetROI: 80 },
  PCS: { label: "Put Credit Spread", category: "Option", legs: 2, targetROI: 80 },
  PDS: { label: "Put Debit Spread", category: "Option", legs: 2, targetROI: 80 },
  // Options - Butterflies
  CBFLY: { label: "Call Butterfly", category: "Option", legs: 3, targetROI: 200 },
  PBFLY: { label: "Put Butterfly", category: "Option", legs: 3, targetROI: 200 },
  CUBFLY: { label: "Call Unbal. Fly", category: "Option", legs: 3, targetROI: 0 },
  PUBFLY: { label: "Put Unbal. Fly", category: "Option", legs: 3, targetROI: 0 },
  CUBFLYD: { label: "Debit CUBFLY", category: "Option", legs: 3, targetROI: 0 },
  PUBFLYD: { label: "Debit PUBFLY", category: "Option", legs: 3, targetROI: 0 },
  // Options - CTVs
  CCTV: { label: "Call CTV", category: "Option", legs: 4, targetROI: 0 },
  PCTV: { label: "Put CTV", category: "Option", legs: 4, targetROI: 0 },
  // Day Trades
  DTC: { label: "Day Trade Call", category: "Option", legs: 1, targetROI: 50 },
  DTP: { label: "Day Trade Put", category: "Option", legs: 1, targetROI: 50 },
  DTCBFLY: { label: "DT Call Butterfly", category: "Option", legs: 3, targetROI: 200 },
  DTPBFLY: { label: "DT Put Butterfly", category: "Option", legs: 3, targetROI: 200 },
  DTS: { label: "Day Trade Shares", category: "Stock", legs: 0, targetROI: 25 },
  // Stocks
  LONG: { label: "Long Stock", category: "Stock", legs: 0, targetROI: 25 },
  SHORT: { label: "Short Stock", category: "Stock", legs: 0, targetROI: 25 },
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
