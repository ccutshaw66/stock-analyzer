/**
 * Standalone seed runner: `npm run seed:demo`
 */
import dotenv from "dotenv";
dotenv.config();
import pg from "pg";
import { seedDemoAccount } from "./demo-seed";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://stockotter:St0ckOtter2026@localhost:5432/stockotter",
});

async function main() {
  try {
    await seedDemoAccount(pool);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);
