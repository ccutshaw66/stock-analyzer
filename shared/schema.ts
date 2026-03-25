import { pgTable, text, integer, serial, doublePrecision, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  displayName: text("display_name"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
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
});

export const accountTransactions = pgTable("account_transactions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  amount: doublePrecision("amount").notNull(),
  transType: text("trans_type").notNull(),
  date: text("date").notNull(),
  note: text("note"),
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
