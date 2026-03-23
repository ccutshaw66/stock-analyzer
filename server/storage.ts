import {
  type User, type InsertUser,
  type Favorite, type InsertFavorite,
  type Trade, type InsertTrade,
  type AccountSettings, type InsertAccountSettings,
  type AccountTransaction, type InsertAccountTransaction,
  users, favorites, trades, accountSettings, accountTransactions,
} from "@shared/schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, and, desc } from "drizzle-orm";

const sqlite = new Database("data.db");
sqlite.pragma("journal_mode = WAL");

export const db = drizzle(sqlite);

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
  constructor() {
    // Ensure tables exist
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS favorites (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticker TEXT NOT NULL,
        company_name TEXT NOT NULL,
        list_type TEXT NOT NULL,
        score REAL,
        verdict TEXT,
        sector TEXT,
        added_at TEXT NOT NULL
      )
    `);
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pilot_or_add TEXT NOT NULL DEFAULT 'Pilot',
        trade_date TEXT NOT NULL,
        expiration TEXT,
        contracts_shares INTEGER NOT NULL DEFAULT 1,
        symbol TEXT NOT NULL,
        current_price REAL,
        target REAL,
        trade_type TEXT NOT NULL,
        trade_category TEXT NOT NULL DEFAULT 'Option',
        strikes TEXT,
        open_price REAL NOT NULL DEFAULT 0,
        comm_in REAL DEFAULT 0,
        allocation REAL,
        max_profit REAL,
        close_date TEXT,
        close_price REAL,
        comm_out REAL DEFAULT 0,
        spread_width REAL,
        credit_debit TEXT,
        trade_plan_notes TEXT,
        behavior_tag TEXT,
        created_at TEXT NOT NULL
      )
    `);
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS account_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        starting_account_value REAL NOT NULL DEFAULT 10000,
        comm_per_shares_trade REAL DEFAULT 0,
        comm_per_option_contract REAL DEFAULT 0.65,
        max_allocation_per_trade REAL DEFAULT 500,
        total_allocated_limit REAL DEFAULT 0.30
      )
    `);
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS account_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        amount REAL NOT NULL,
        trans_type TEXT NOT NULL,
        date TEXT NOT NULL,
        note TEXT
      )
    `);
    // Seed default account settings if empty
    const existing = db.select().from(accountSettings).get();
    if (!existing) {
      db.insert(accountSettings).values({
        startingAccountValue: 10000,
        commPerSharesTrade: 0,
        commPerOptionContract: 0.65,
        maxAllocationPerTrade: 500,
        totalAllocatedLimit: 0.30,
      }).run();
    }
  }

  // ─── Users ─────────────────────────────────────────────────────────────────

  async getUser(id: number): Promise<User | undefined> {
    return db.select().from(users).where(eq(users.id, id)).get();
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return db.select().from(users).where(eq(users.username, username)).get();
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    return db.insert(users).values(insertUser).returning().get();
  }

  // ─── Favorites ─────────────────────────────────────────────────────────────

  async getFavorites(listType: string): Promise<Favorite[]> {
    return db.select().from(favorites).where(eq(favorites.listType, listType)).all();
  }

  async addFavorite(fav: InsertFavorite): Promise<Favorite> {
    return db.insert(favorites).values(fav).returning().get();
  }

  async removeFavorite(ticker: string, listType: string): Promise<void> {
    db.delete(favorites)
      .where(and(eq(favorites.ticker, ticker), eq(favorites.listType, listType)))
      .run();
  }

  async getFavorite(ticker: string, listType: string): Promise<Favorite | undefined> {
    return db.select().from(favorites)
      .where(and(eq(favorites.ticker, ticker), eq(favorites.listType, listType)))
      .get();
  }

  async updateFavoriteScore(ticker: string, listType: string, score: number, verdict: string): Promise<void> {
    db.update(favorites)
      .set({ score, verdict })
      .where(and(eq(favorites.ticker, ticker), eq(favorites.listType, listType)))
      .run();
  }

  // ─── Trades ────────────────────────────────────────────────────────────────

  async getAllTrades(): Promise<Trade[]> {
    return db.select().from(trades).orderBy(desc(trades.tradeDate)).all();
  }

  async getTrade(id: number): Promise<Trade | undefined> {
    return db.select().from(trades).where(eq(trades.id, id)).get();
  }

  async createTrade(trade: InsertTrade): Promise<Trade> {
    return db.insert(trades).values(trade).returning().get();
  }

  async updateTrade(id: number, trade: Partial<InsertTrade>): Promise<Trade | undefined> {
    db.update(trades).set(trade).where(eq(trades.id, id)).run();
    return db.select().from(trades).where(eq(trades.id, id)).get();
  }

  async deleteTrade(id: number): Promise<void> {
    db.delete(trades).where(eq(trades.id, id)).run();
  }

  async updateTradePrice(id: number, price: number): Promise<void> {
    db.update(trades).set({ currentPrice: price }).where(eq(trades.id, id)).run();
  }

  // ─── Account Settings ──────────────────────────────────────────────────────

  async getAccountSettings(): Promise<AccountSettings> {
    const settings = db.select().from(accountSettings).get();
    return settings!;
  }

  async updateAccountSettings(settings: Partial<InsertAccountSettings>): Promise<AccountSettings> {
    db.update(accountSettings).set(settings).where(eq(accountSettings.id, 1)).run();
    return (await this.getAccountSettings())!;
  }

  // ─── Account Transactions ──────────────────────────────────────────────────

  async getAccountTransactions(): Promise<AccountTransaction[]> {
    return db.select().from(accountTransactions).orderBy(desc(accountTransactions.date)).all();
  }

  async createAccountTransaction(tx: InsertAccountTransaction): Promise<AccountTransaction> {
    return db.insert(accountTransactions).values(tx).returning().get();
  }

  async deleteAccountTransaction(id: number): Promise<void> {
    db.delete(accountTransactions).where(eq(accountTransactions.id, id)).run();
  }
}

export const storage = new DatabaseStorage();
