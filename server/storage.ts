import {
  type User, type InsertUser,
  type Favorite, type InsertFavorite,
  type Trade, type InsertTrade,
  type AccountSettings, type InsertAccountSettings,
  type AccountTransaction, type InsertAccountTransaction,
  users, favorites, trades, accountSettings, accountTransactions,
} from "@shared/schema";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { eq, and, desc } from "drizzle-orm";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://stockotter:St0ckOtter2026@localhost:5432/stockotter",
});

export const db = drizzle(pool);

export interface IStorage {
  // Users
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  // Favorites
  getFavorites(listType: string): Promise<Favorite[]>;
  addFavorite(fav: InsertFavorite): Promise<Favorite>;
  removeFavorite(ticker: string, listType: string): Promise<void>;
  getFavorite(ticker: string, listType: string): Promise<Favorite | undefined>;
  updateFavoriteScore(ticker: string, listType: string, score: number, verdict: string): Promise<void>;
  // Trades
  getAllTrades(): Promise<Trade[]>;
  getTrade(id: number): Promise<Trade | undefined>;
  createTrade(trade: InsertTrade): Promise<Trade>;
  updateTrade(id: number, trade: Partial<InsertTrade>): Promise<Trade | undefined>;
  deleteTrade(id: number): Promise<void>;
  updateTradePrice(id: number, price: number): Promise<void>;
  // Account Settings
  getAccountSettings(): Promise<AccountSettings>;
  updateAccountSettings(settings: Partial<InsertAccountSettings>): Promise<AccountSettings>;
  // Account Transactions
  getAccountTransactions(): Promise<AccountTransaction[]>;
  createAccountTransaction(tx: InsertAccountTransaction): Promise<AccountTransaction>;
  deleteAccountTransaction(id: number): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async initialize() {
    // Create tables if they don't exist using raw SQL
    const client = await pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          username TEXT NOT NULL UNIQUE,
          password TEXT NOT NULL
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS favorites (
          id SERIAL PRIMARY KEY,
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
          amount DOUBLE PRECISION NOT NULL,
          trans_type TEXT NOT NULL,
          date TEXT NOT NULL,
          note TEXT
        )
      `);

      // Seed default account settings if empty
      const result = await client.query('SELECT COUNT(*) FROM account_settings');
      if (parseInt(result.rows[0].count) === 0) {
        await db.insert(accountSettings).values({
          startingAccountValue: 10000,
          commPerSharesTrade: 0,
          commPerOptionContract: 0.65,
          maxAllocationPerTrade: 500,
          totalAllocatedLimit: 0.30,
        });
      }
    } finally {
      client.release();
    }
  }

  // ─── Users ─────────────────────────────────────────────────────────────────

  async getUser(id: number): Promise<User | undefined> {
    const rows = await db.select().from(users).where(eq(users.id, id));
    return rows[0];
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const rows = await db.select().from(users).where(eq(users.username, username));
    return rows[0];
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const rows = await db.insert(users).values(insertUser).returning();
    return rows[0];
  }

  // ─── Favorites ─────────────────────────────────────────────────────────────

  async getFavorites(listType: string): Promise<Favorite[]> {
    return db.select().from(favorites).where(eq(favorites.listType, listType));
  }

  async addFavorite(fav: InsertFavorite): Promise<Favorite> {
    const rows = await db.insert(favorites).values(fav).returning();
    return rows[0];
  }

  async removeFavorite(ticker: string, listType: string): Promise<void> {
    await db.delete(favorites)
      .where(and(eq(favorites.ticker, ticker), eq(favorites.listType, listType)));
  }

  async getFavorite(ticker: string, listType: string): Promise<Favorite | undefined> {
    const rows = await db.select().from(favorites)
      .where(and(eq(favorites.ticker, ticker), eq(favorites.listType, listType)));
    return rows[0];
  }

  async updateFavoriteScore(ticker: string, listType: string, score: number, verdict: string): Promise<void> {
    await db.update(favorites)
      .set({ score, verdict })
      .where(and(eq(favorites.ticker, ticker), eq(favorites.listType, listType)));
  }

  // ─── Trades ────────────────────────────────────────────────────────────────

  async getAllTrades(): Promise<Trade[]> {
    return db.select().from(trades).orderBy(desc(trades.tradeDate));
  }

  async getTrade(id: number): Promise<Trade | undefined> {
    const rows = await db.select().from(trades).where(eq(trades.id, id));
    return rows[0];
  }

  async createTrade(trade: InsertTrade): Promise<Trade> {
    const rows = await db.insert(trades).values(trade).returning();
    return rows[0];
  }

  async updateTrade(id: number, trade: Partial<InsertTrade>): Promise<Trade | undefined> {
    await db.update(trades).set(trade).where(eq(trades.id, id));
    const rows = await db.select().from(trades).where(eq(trades.id, id));
    return rows[0];
  }

  async deleteTrade(id: number): Promise<void> {
    await db.delete(trades).where(eq(trades.id, id));
  }

  async updateTradePrice(id: number, price: number): Promise<void> {
    await db.update(trades).set({ currentPrice: price }).where(eq(trades.id, id));
  }

  // ─── Account Settings ──────────────────────────────────────────────────────

  async getAccountSettings(): Promise<AccountSettings> {
    const rows = await db.select().from(accountSettings);
    return rows[0]!;
  }

  async updateAccountSettings(settings: Partial<InsertAccountSettings>): Promise<AccountSettings> {
    await db.update(accountSettings).set(settings).where(eq(accountSettings.id, 1));
    return (await this.getAccountSettings())!;
  }

  // ─── Account Transactions ──────────────────────────────────────────────────

  async getAccountTransactions(): Promise<AccountTransaction[]> {
    return db.select().from(accountTransactions).orderBy(desc(accountTransactions.date));
  }

  async createAccountTransaction(tx: InsertAccountTransaction): Promise<AccountTransaction> {
    const rows = await db.insert(accountTransactions).values(tx).returning();
    return rows[0];
  }

  async deleteAccountTransaction(id: number): Promise<void> {
    await db.delete(accountTransactions).where(eq(accountTransactions.id, id));
  }
}

export const storage = new DatabaseStorage();
