import {
  type User, type InsertUser,
  type Favorite, type InsertFavorite,
  type Trade, type InsertTrade,
  type AccountSettings, type InsertAccountSettings,
  type AccountTransaction, type InsertAccountTransaction,
  type PasswordResetToken,
  type TradePriceHistory, type InsertTradePriceHistory,
  type DividendPortfolioItem, type InsertDividendPortfolioItem,
  users, favorites, trades, accountSettings, accountTransactions, passwordResetTokens, tradePriceHistory, dividendPortfolio,
} from "@shared/schema";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { eq, and, desc, sql, count } from "drizzle-orm";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://stockotter:St0ckOtter2026@localhost:5432/stockotter",
  max: 20,                    // max connections (default was 10)
  min: 2,                     // keep 2 idle connections warm
  idleTimeoutMillis: 30000,   // close idle connections after 30s
  connectionTimeoutMillis: 5000, // fail fast if can't connect in 5s
});

export const db = drizzle(pool);

export interface IStorage {
  // Users
  getUser(id: number): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  // Favorites (scoped by userId)
  getFavorites(userId: number, listType: string): Promise<Favorite[]>;
  addFavorite(fav: InsertFavorite): Promise<Favorite>;
  removeFavorite(userId: number, ticker: string, listType: string): Promise<void>;
  getFavorite(userId: number, ticker: string, listType: string): Promise<Favorite | undefined>;
  updateFavoriteScore(userId: number, ticker: string, listType: string, score: number, verdict: string): Promise<void>;
  // Trades (scoped by userId)
  getAllTrades(userId: number): Promise<Trade[]>;
  getTrade(userId: number, id: number): Promise<Trade | undefined>;
  createTrade(trade: InsertTrade): Promise<Trade>;
  updateTrade(userId: number, id: number, trade: Partial<InsertTrade>): Promise<Trade | undefined>;
  deleteTrade(userId: number, id: number): Promise<void>;
  updateTradePrice(userId: number, id: number, price: number): Promise<void>;
  // Account Settings (scoped by userId)
  getAccountSettings(userId: number): Promise<AccountSettings>;
  updateAccountSettings(userId: number, settings: Partial<InsertAccountSettings>): Promise<AccountSettings>;
  // Account Transactions (scoped by userId)
  getAccountTransactions(userId: number): Promise<AccountTransaction[]>;
  createAccountTransaction(tx: InsertAccountTransaction): Promise<AccountTransaction>;
  deleteAccountTransaction(userId: number, id: number): Promise<void>;
  // User profile & password
  updateUserProfile(userId: number, data: { email?: string; displayName?: string }): Promise<User>;
  updateUserPassword(userId: number, hashedPassword: string): Promise<void>;
  // Password reset tokens
  createPasswordResetToken(userId: number, token: string, expiresAt: Date): Promise<PasswordResetToken>;
  getPasswordResetToken(token: string): Promise<PasswordResetToken | undefined>;
  deletePasswordResetToken(token: string): Promise<void>;
  // Trade Price History
  recordPriceSnapshot(snapshot: InsertTradePriceHistory): Promise<void>;
  recordPriceSnapshots(snapshots: InsertTradePriceHistory[]): Promise<void>;
  getPriceHistory(tradeId: number): Promise<TradePriceHistory[]>;
  getPriceHistoryForUser(userId: number): Promise<TradePriceHistory[]>;
  getTradesMFEMAE(userId: number): Promise<{tradeId: number; mfe: number; mae: number; exitEfficiency: number}[]>;
  // Dividend Portfolio
  getDividendPortfolio(userId: number): Promise<DividendPortfolioItem[]>;
  addDividendPosition(item: InsertDividendPortfolioItem): Promise<DividendPortfolioItem>;
  updateDividendPosition(userId: number, id: number, data: Partial<InsertDividendPortfolioItem>): Promise<DividendPortfolioItem | undefined>;
  removeDividendPosition(userId: number, id: number): Promise<void>;
  // Subscription
  updateUserSubscription(userId: number, data: {
    subscriptionTier?: string;
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
    subscriptionExpiresAt?: Date | null;
  }): Promise<User>;
  getUserByStripeCustomerId(stripeCustomerId: string): Promise<User | undefined>;
  // Admin
  getAllUsers(): Promise<User[]>;
  deleteUser(userId: number): Promise<void>;
  getUserTradeCount(userId: number): Promise<number>;
  getUserFavoriteCount(userId: number): Promise<number>;
}

export class DatabaseStorage implements IStorage {
  async initialize() {
    const client = await pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          email TEXT NOT NULL UNIQUE,
          password TEXT NOT NULL,
          display_name TEXT,
          created_at TIMESTAMP DEFAULT NOW() NOT NULL
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS favorites (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id),
          ticker TEXT NOT NULL,
          company_name TEXT NOT NULL,
          list_type TEXT NOT NULL,
          score DOUBLE PRECISION,
          verdict TEXT,
          sector TEXT,
          added_at TEXT NOT NULL
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS trades (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id),
          pilot_or_add TEXT NOT NULL DEFAULT 'Pilot',
          trade_date TEXT NOT NULL,
          expiration TEXT,
          contracts_shares INTEGER NOT NULL DEFAULT 1,
          symbol TEXT NOT NULL,
          current_price DOUBLE PRECISION,
          target DOUBLE PRECISION,
          trade_type TEXT NOT NULL,
          trade_category TEXT NOT NULL DEFAULT 'Option',
          strikes TEXT,
          open_price DOUBLE PRECISION NOT NULL DEFAULT 0,
          comm_in DOUBLE PRECISION DEFAULT 0,
          allocation DOUBLE PRECISION,
          max_profit DOUBLE PRECISION,
          close_date TEXT,
          close_price DOUBLE PRECISION,
          comm_out DOUBLE PRECISION DEFAULT 0,
          spread_width DOUBLE PRECISION,
          credit_debit TEXT,
          trade_plan_notes TEXT,
          behavior_tag TEXT,
          created_at TEXT NOT NULL
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS account_settings (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) UNIQUE,
          starting_account_value DOUBLE PRECISION NOT NULL DEFAULT 10000,
          comm_per_shares_trade DOUBLE PRECISION DEFAULT 0,
          comm_per_option_contract DOUBLE PRECISION DEFAULT 0.65,
          max_allocation_per_trade DOUBLE PRECISION DEFAULT 500,
          total_allocated_limit DOUBLE PRECISION DEFAULT 0.30
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS account_transactions (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id),
          amount DOUBLE PRECISION NOT NULL,
          trans_type TEXT NOT NULL,
          date TEXT NOT NULL,
          note TEXT
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS trade_price_history (
          id SERIAL PRIMARY KEY,
          trade_id INTEGER NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
          user_id INTEGER NOT NULL REFERENCES users(id),
          date TEXT NOT NULL,
          price DOUBLE PRECISION NOT NULL,
          unrealized_pl DOUBLE PRECISION
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id),
          token TEXT NOT NULL UNIQUE,
          expires_at TIMESTAMP NOT NULL,
          created_at TIMESTAMP DEFAULT NOW() NOT NULL
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS dividend_portfolio (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id),
          ticker TEXT NOT NULL,
          company_name TEXT NOT NULL,
          shares DOUBLE PRECISION NOT NULL,
          avg_cost DOUBLE PRECISION NOT NULL,
          frequency TEXT,
          notes TEXT,
          added_at TEXT NOT NULL
        )
      `);
      // ─── Subscription columns (idempotent) ────────────────────────────────
      await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_tier TEXT DEFAULT 'free'`);
      await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT`);
      await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT`);
      await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMP`);
      await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS has_seen_tour BOOLEAN DEFAULT false`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS signal_log (
          id SERIAL PRIMARY KEY,
          ticker TEXT NOT NULL,
          signal_date TEXT NOT NULL,
          signal_type TEXT NOT NULL,
          source TEXT NOT NULL,
          score DOUBLE PRECISION,
          price_at_signal DOUBLE PRECISION NOT NULL,
          price_7d DOUBLE PRECISION,
          price_30d DOUBLE PRECISION,
          price_90d DOUBLE PRECISION,
          return_7d DOUBLE PRECISION,
          return_30d DOUBLE PRECISION,
          return_90d DOUBLE PRECISION,
          spy_return_7d DOUBLE PRECISION,
          spy_return_30d DOUBLE PRECISION,
          spy_return_90d DOUBLE PRECISION,
          created_at TIMESTAMP DEFAULT NOW() NOT NULL
        )
      `);
    } finally {
      client.release();
    }
  }

  // ─── Users ─────────────────────────────────────────────────────────────────

  async getUser(id: number): Promise<User | undefined> {
    const rows = await db.select().from(users).where(eq(users.id, id));
    return rows[0];
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const rows = await db.select().from(users).where(eq(users.email, email));
    return rows[0];
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const rows = await db.insert(users).values(insertUser).returning();
    return rows[0];
  }

  // ─── Favorites (userId scoped) ─────────────────────────────────────────────

  async getFavorites(userId: number, listType: string): Promise<Favorite[]> {
    return db.select().from(favorites).where(and(eq(favorites.userId, userId), eq(favorites.listType, listType)));
  }

  async addFavorite(fav: InsertFavorite): Promise<Favorite> {
    const rows = await db.insert(favorites).values(fav).returning();
    return rows[0];
  }

  async removeFavorite(userId: number, ticker: string, listType: string): Promise<void> {
    await db.delete(favorites)
      .where(and(eq(favorites.userId, userId), eq(favorites.ticker, ticker), eq(favorites.listType, listType)));
  }

  async getFavorite(userId: number, ticker: string, listType: string): Promise<Favorite | undefined> {
    const rows = await db.select().from(favorites)
      .where(and(eq(favorites.userId, userId), eq(favorites.ticker, ticker), eq(favorites.listType, listType)));
    return rows[0];
  }

  async updateFavoriteScore(userId: number, ticker: string, listType: string, score: number, verdict: string): Promise<void> {
    await db.update(favorites)
      .set({ score, verdict })
      .where(and(eq(favorites.userId, userId), eq(favorites.ticker, ticker), eq(favorites.listType, listType)));
  }

  // ─── Trades (userId scoped) ────────────────────────────────────────────────

  async getAllOpenTradesAllUsers(): Promise<Trade[]> {
    return db.select().from(trades).where(sql`close_date IS NULL`);
  }

  async getAllTrades(userId: number): Promise<Trade[]> {
    return db.select().from(trades).where(eq(trades.userId, userId)).orderBy(desc(trades.tradeDate));
  }

  async getTrade(userId: number, id: number): Promise<Trade | undefined> {
    const rows = await db.select().from(trades).where(and(eq(trades.id, id), eq(trades.userId, userId)));
    return rows[0];
  }

  async createTrade(trade: InsertTrade): Promise<Trade> {
    const rows = await db.insert(trades).values(trade).returning();
    return rows[0];
  }

  async updateTrade(userId: number, id: number, trade: Partial<InsertTrade>): Promise<Trade | undefined> {
    await db.update(trades).set(trade).where(and(eq(trades.id, id), eq(trades.userId, userId)));
    const rows = await db.select().from(trades).where(and(eq(trades.id, id), eq(trades.userId, userId)));
    return rows[0];
  }

  async deleteTrade(userId: number, id: number): Promise<void> {
    await db.delete(trades).where(and(eq(trades.id, id), eq(trades.userId, userId)));
  }

  async updateTradePrice(userId: number, id: number, price: number): Promise<void> {
    await db.update(trades).set({ currentPrice: price }).where(and(eq(trades.id, id), eq(trades.userId, userId)));
  }

  // ─── Account Settings (userId scoped) ──────────────────────────────────────

  async getAccountSettings(userId: number): Promise<AccountSettings> {
    const rows = await db.select().from(accountSettings).where(eq(accountSettings.userId, userId));
    if (rows.length === 0) {
      // Auto-create default settings for this user
      const created = await db.insert(accountSettings).values({
        userId,
        startingAccountValue: 10000,
        commPerSharesTrade: 0,
        commPerOptionContract: 0.65,
        maxAllocationPerTrade: 500,
        totalAllocatedLimit: 0.30,
      }).returning();
      return created[0];
    }
    return rows[0];
  }

  async updateAccountSettings(userId: number, settings: Partial<InsertAccountSettings>): Promise<AccountSettings> {
    await db.update(accountSettings).set(settings).where(eq(accountSettings.userId, userId));
    return this.getAccountSettings(userId);
  }

  // ─── Account Transactions (userId scoped) ──────────────────────────────────

  async getAccountTransactions(userId: number): Promise<AccountTransaction[]> {
    return db.select().from(accountTransactions).where(eq(accountTransactions.userId, userId)).orderBy(desc(accountTransactions.date));
  }

  async createAccountTransaction(tx: InsertAccountTransaction): Promise<AccountTransaction> {
    const rows = await db.insert(accountTransactions).values(tx).returning();
    return rows[0];
  }

  async deleteAccountTransaction(userId: number, id: number): Promise<void> {
    await db.delete(accountTransactions).where(and(eq(accountTransactions.id, id), eq(accountTransactions.userId, userId)));
  }

  // ─── User Profile & Password ──────────────────────────────────────────────

  async updateUserProfile(userId: number, data: { email?: string; displayName?: string }): Promise<User> {
    const updates: any = {};
    if (data.email !== undefined) updates.email = data.email;
    if (data.displayName !== undefined) updates.displayName = data.displayName;
    await db.update(users).set(updates).where(eq(users.id, userId));
    const rows = await db.select().from(users).where(eq(users.id, userId));
    return rows[0];
  }

  async updateUserPassword(userId: number, hashedPassword: string): Promise<void> {
    await db.update(users).set({ password: hashedPassword }).where(eq(users.id, userId));
  }

  // ─── Password Reset Tokens ───────────────────────────────────────────────

  async createPasswordResetToken(userId: number, token: string, expiresAt: Date): Promise<PasswordResetToken> {
    // Delete any existing tokens for this user first
    await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, userId));
    const rows = await db.insert(passwordResetTokens).values({ userId, token, expiresAt }).returning();
    return rows[0];
  }

  async getPasswordResetToken(token: string): Promise<PasswordResetToken | undefined> {
    const rows = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.token, token));
    return rows[0];
  }

  async deletePasswordResetToken(token: string): Promise<void> {
    await db.delete(passwordResetTokens).where(eq(passwordResetTokens.token, token));
  }

  // ─── Trade Price History ─────────────────────────────────────────────────

  async recordPriceSnapshot(snapshot: InsertTradePriceHistory): Promise<void> {
    await db.insert(tradePriceHistory).values(snapshot);
  }

  async recordPriceSnapshots(snapshots: InsertTradePriceHistory[]): Promise<void> {
    if (snapshots.length === 0) return;
    await db.insert(tradePriceHistory).values(snapshots);
  }

  async getPriceHistory(tradeId: number): Promise<TradePriceHistory[]> {
    return db.select().from(tradePriceHistory).where(eq(tradePriceHistory.tradeId, tradeId)).orderBy(tradePriceHistory.date);
  }

  async getPriceHistoryForUser(userId: number): Promise<TradePriceHistory[]> {
    return db.select().from(tradePriceHistory).where(eq(tradePriceHistory.userId, userId)).orderBy(tradePriceHistory.date);
  }

  async getTradesMFEMAE(userId: number): Promise<{tradeId: number; mfe: number; mae: number; exitEfficiency: number}[]> {
    // Get all closed trades for this user
    const closedTrades = await db.select().from(trades).where(and(eq(trades.userId, userId), sql`close_date IS NOT NULL`));
    
    const results = [];
    for (const trade of closedTrades) {
      const history = await db.select().from(tradePriceHistory).where(eq(tradePriceHistory.tradeId, trade.id));
      if (history.length === 0) continue;
      
      const plValues = history.map(h => h.unrealizedPL || 0);
      const mfe = Math.max(...plValues, 0); // best unrealized P/L
      const mae = Math.min(...plValues, 0); // worst unrealized P/L
      
      // Actual P/L for this trade
      const multiplier = trade.tradeCategory === 'Option' ? 100 : 1;
      const actualPL = trade.closePrice != null ? 
        ((trade.closePrice + trade.openPrice) * trade.contractsShares * multiplier) - ((trade.commIn || 0) + (trade.commOut || 0))
        : 0;
      
      const exitEfficiency = mfe > 0 ? (actualPL / mfe) * 100 : 0;
      
      results.push({ tradeId: trade.id, mfe, mae, exitEfficiency: Math.min(100, Math.max(-100, exitEfficiency)) });
    }
    return results;
  }

  // ─── Dividend Portfolio ──────────────────────────────────────────────────

  async getDividendPortfolio(userId: number): Promise<DividendPortfolioItem[]> {
    return db.select().from(dividendPortfolio).where(eq(dividendPortfolio.userId, userId));
  }

  async addDividendPosition(item: InsertDividendPortfolioItem): Promise<DividendPortfolioItem> {
    const rows = await db.insert(dividendPortfolio).values(item).returning();
    return rows[0];
  }

  async updateDividendPosition(userId: number, id: number, data: Partial<InsertDividendPortfolioItem>): Promise<DividendPortfolioItem | undefined> {
    const rows = await db.update(dividendPortfolio)
      .set(data)
      .where(and(eq(dividendPortfolio.id, id), eq(dividendPortfolio.userId, userId)))
      .returning();
    return rows[0];
  }

  async removeDividendPosition(userId: number, id: number): Promise<void> {
    await db.delete(dividendPortfolio).where(and(eq(dividendPortfolio.id, id), eq(dividendPortfolio.userId, userId)));
  }

  // ─── Subscription ─────────────────────────────────────────────────────────

  async updateUserSubscription(userId: number, data: {
    subscriptionTier?: string;
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
    subscriptionExpiresAt?: Date | null;
  }): Promise<User> {
    const updates: Record<string, any> = {};
    if (data.subscriptionTier !== undefined) updates.subscriptionTier = data.subscriptionTier;
    if (data.stripeCustomerId !== undefined) updates.stripeCustomerId = data.stripeCustomerId;
    if (data.stripeSubscriptionId !== undefined) updates.stripeSubscriptionId = data.stripeSubscriptionId;
    if (data.subscriptionExpiresAt !== undefined) updates.subscriptionExpiresAt = data.subscriptionExpiresAt;
    await db.update(users).set(updates).where(eq(users.id, userId));
    const rows = await db.select().from(users).where(eq(users.id, userId));
    return rows[0];
  }

  async getUserByStripeCustomerId(stripeCustomerId: string): Promise<User | undefined> {
    const rows = await db.select().from(users).where(eq(users.stripeCustomerId, stripeCustomerId));
    return rows[0];
  }

  // ─── Admin ────────────────────────────────────────────────────────────────

  async getAllUsers(): Promise<User[]> {
    return db.select().from(users).orderBy(desc(users.createdAt));
  }

  async deleteUser(userId: number): Promise<void> {
    // Delete user's data first (cascading)
    await db.delete(tradePriceHistory).where(eq(tradePriceHistory.userId, userId));
    await db.delete(accountTransactions).where(eq(accountTransactions.userId, userId));
    await db.delete(accountSettings).where(eq(accountSettings.userId, userId));
    await db.delete(trades).where(eq(trades.userId, userId));
    await db.delete(favorites).where(eq(favorites.userId, userId));
    await db.delete(dividendPortfolio).where(eq(dividendPortfolio.userId, userId));
    await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, userId));
    await db.delete(users).where(eq(users.id, userId));
  }

  async getUserTradeCount(userId: number): Promise<number> {
    const rows = await db.select({ count: count() }).from(trades).where(eq(trades.userId, userId));
    return rows[0]?.count ?? 0;
  }

  async getUserFavoriteCount(userId: number): Promise<number> {
    const rows = await db.select({ count: count() }).from(favorites).where(eq(favorites.userId, userId));
    return rows[0]?.count ?? 0;
  }
}

export const storage = new DatabaseStorage();
