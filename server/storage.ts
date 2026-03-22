import { type User, type InsertUser, type Favorite, type InsertFavorite, users, favorites } from "@shared/schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, and } from "drizzle-orm";

const sqlite = new Database("data.db");
sqlite.pragma("journal_mode = WAL");

export const db = drizzle(sqlite);

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  getFavorites(listType: string): Promise<Favorite[]>;
  addFavorite(fav: InsertFavorite): Promise<Favorite>;
  removeFavorite(ticker: string, listType: string): Promise<void>;
  getFavorite(ticker: string, listType: string): Promise<Favorite | undefined>;
  updateFavoriteScore(ticker: string, listType: string, score: number, verdict: string): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  constructor() {
    // Ensure the favorites table exists
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
  }

  async getUser(id: number): Promise<User | undefined> {
    return db.select().from(users).where(eq(users.id, id)).get();
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return db.select().from(users).where(eq(users.username, username)).get();
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    return db.insert(users).values(insertUser).returning().get();
  }

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
}

export const storage = new DatabaseStorage();
