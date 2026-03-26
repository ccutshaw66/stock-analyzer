import dotenv from "dotenv";
dotenv.config();
import pg from "pg";
import bcrypt from "bcryptjs";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://stockotter:St0ckOtter2026@localhost:5432/stockotter",
});

async function seed() {
  const client = await pool.connect();
  try {
    // Create demo user
    const hashedPassword = await bcrypt.hash("demo123", 12);
    const userResult = await client.query(
      `INSERT INTO users (email, password, display_name) VALUES ($1, $2, $3) ON CONFLICT (email) DO UPDATE SET display_name = $3 RETURNING id`,
      ["ottertrader@stockotter.ai", hashedPassword, "Otter Trader"]
    );
    const userId = userResult.rows[0].id;
    console.log(`Demo user created/updated: ID ${userId}`);

    // Clear existing demo data
    await client.query(`DELETE FROM trade_price_history WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM trades WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM favorites WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM account_transactions WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM account_settings WHERE user_id = $1`, [userId]);

    // Account settings
    await client.query(
      `INSERT INTO account_settings (user_id, starting_account_value, comm_per_shares_trade, comm_per_option_contract, max_allocation_per_trade, total_allocated_limit) VALUES ($1, 25000, 0, 0.65, 1000, 0.30)`,
      [userId]
    );

    // Watchlist
    const watchlistItems = [
      ["AAPL", "Apple Inc.", 85, "YES", "Technology"],
      ["MSFT", "Microsoft Corporation", 82, "YES", "Technology"],
      ["HD", "The Home Depot", 78, "STRONG BUY", "Consumer Cyclical"],
      ["JNJ", "Johnson & Johnson", 71, "YES", "Healthcare"],
      ["KO", "The Coca-Cola Company", 68, "WATCH", "Consumer Defensive"],
      ["O", "Realty Income", 65, "WATCH", "Real Estate"],
      ["JEPI", "JPMorgan Equity Premium Income", 72, "YES", "ETF"],
      ["XOM", "Exxon Mobil", 74, "YES", "Energy"],
      ["BAC", "Bank of America", 62, "WATCH", "Financial"],
      ["TSLA", "Tesla Inc.", 45, "WATCH", "Technology"],
    ];
    for (const [ticker, name, score, verdict, sector] of watchlistItems) {
      await client.query(
        `INSERT INTO favorites (user_id, ticker, company_name, list_type, score, verdict, sector, added_at) VALUES ($1, $2, $3, 'watchlist', $4, $5, $6, $7)`,
        [userId, ticker, name, score, verdict, sector, new Date().toISOString()]
      );
    }
    console.log(`Added ${watchlistItems.length} watchlist items`);

    // Generate trades - we need a LOT of variety
    const trades: any[] = [];
    const now = new Date();

    function daysAgo(d: number): string {
      const date = new Date(now);
      date.setDate(date.getDate() - d);
      return date.toISOString().split("T")[0];
    }

    function daysFromNow(d: number): string {
      const date = new Date(now);
      date.setDate(date.getDate() + d);
      return date.toISOString().split("T")[0];
    }

    // ═══════════════════════════════════════════════
    // PUT CREDIT SPREADS (PCS) - 5 open, 5 closed
    // ═══════════════════════════════════════════════

    // Open PCS trades
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(3), expiration: daysFromNow(18), contractsShares: 2, symbol: "AAPL", tradeType: "PCS", tradeCategory: "Option", strikes: "210/205", openPrice: 1.25, spreadWidth: 5, creditDebit: "CREDIT", commIn: 2.60, allocation: 750 });
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(5), expiration: daysFromNow(25), contractsShares: 3, symbol: "MSFT", tradeType: "PCS", tradeCategory: "Option", strikes: "400/395", openPrice: 1.50, spreadWidth: 5, creditDebit: "CREDIT", commIn: 3.90, allocation: 1050 });
    trades.push({ pilotOrAdd: "Add", tradeDate: daysAgo(2), expiration: daysFromNow(18), contractsShares: 1, symbol: "AAPL", tradeType: "PCS", tradeCategory: "Option", strikes: "208/203", openPrice: 1.10, spreadWidth: 5, creditDebit: "CREDIT", commIn: 1.30, allocation: 390 });
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(7), expiration: daysFromNow(14), contractsShares: 2, symbol: "HD", tradeType: "PCS", tradeCategory: "Option", strikes: "330/325", openPrice: 1.35, spreadWidth: 5, creditDebit: "CREDIT", commIn: 2.60, allocation: 730 });
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(1), expiration: daysFromNow(30), contractsShares: 1, symbol: "AMZN", tradeType: "PCS", tradeCategory: "Option", strikes: "185/180", openPrice: 1.45, spreadWidth: 5, creditDebit: "CREDIT", commIn: 1.30, allocation: 355 });

    // Closed PCS trades (mix of wins and losses)
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(45), expiration: daysAgo(15), contractsShares: 2, symbol: "SPY", tradeType: "PCS", tradeCategory: "Option", strikes: "500/495", openPrice: 1.50, spreadWidth: 5, creditDebit: "CREDIT", commIn: 2.60, allocation: 700, closeDate: daysAgo(20), closePrice: 0.30, commOut: 2.60 });
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(60), expiration: daysAgo(30), contractsShares: 3, symbol: "QQQ", tradeType: "PCS", tradeCategory: "Option", strikes: "440/435", openPrice: 1.25, spreadWidth: 5, creditDebit: "CREDIT", commIn: 3.90, allocation: 1125, closeDate: daysAgo(35), closePrice: 0, commOut: 0 });
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(40), expiration: daysAgo(10), contractsShares: 1, symbol: "NVDA", tradeType: "PCS", tradeCategory: "Option", strikes: "850/840", openPrice: 3.50, spreadWidth: 10, creditDebit: "CREDIT", commIn: 1.30, allocation: 650, closeDate: daysAgo(15), closePrice: 7.50, commOut: 1.30, behaviorTag: "Fear / Panic" });
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(90), expiration: daysAgo(60), contractsShares: 2, symbol: "META", tradeType: "PCS", tradeCategory: "Option", strikes: "480/475", openPrice: 1.30, spreadWidth: 5, creditDebit: "CREDIT", commIn: 2.60, allocation: 740, closeDate: daysAgo(65), closePrice: 0.25, commOut: 2.60, behaviorTag: "All to Plan" });
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(30), expiration: daysAgo(2), contractsShares: 2, symbol: "GOOGL", tradeType: "PCS", tradeCategory: "Option", strikes: "165/160", openPrice: 1.40, spreadWidth: 5, creditDebit: "CREDIT", commIn: 2.60, allocation: 720, closeDate: daysAgo(5), closePrice: 0.15, commOut: 2.60, behaviorTag: "All to Plan" });

    // ═══════════════════════════════════════════════
    // CALL CREDIT SPREADS (CCS) - 3 open, 5 closed
    // ═══════════════════════════════════════════════
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(4), expiration: daysFromNow(20), contractsShares: 2, symbol: "TSLA", tradeType: "CCS", tradeCategory: "Option", strikes: "300/305", openPrice: 1.20, spreadWidth: 5, creditDebit: "CREDIT", commIn: 2.60, allocation: 760 });
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(6), expiration: daysFromNow(15), contractsShares: 1, symbol: "NFLX", tradeType: "CCS", tradeCategory: "Option", strikes: "950/955", openPrice: 1.75, spreadWidth: 5, creditDebit: "CREDIT", commIn: 1.30, allocation: 325 });
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(2), expiration: daysFromNow(28), contractsShares: 3, symbol: "AMD", tradeType: "CCS", tradeCategory: "Option", strikes: "130/135", openPrice: 1.15, spreadWidth: 5, creditDebit: "CREDIT", commIn: 3.90, allocation: 1155 });

    // Closed CCS
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(50), expiration: daysAgo(20), contractsShares: 2, symbol: "ROKU", tradeType: "CCS", tradeCategory: "Option", strikes: "85/90", openPrice: 1.30, spreadWidth: 5, creditDebit: "CREDIT", commIn: 2.60, allocation: 740, closeDate: daysAgo(25), closePrice: 0.20, commOut: 2.60, behaviorTag: "All to Plan" });
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(75), expiration: daysAgo(45), contractsShares: 1, symbol: "SNAP", tradeType: "CCS", tradeCategory: "Option", strikes: "14/15", openPrice: 0.35, spreadWidth: 1, creditDebit: "CREDIT", commIn: 1.30, allocation: 65, closeDate: daysAgo(50), closePrice: 0.80, commOut: 1.30, behaviorTag: "Bias / Stubborn" });
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(35), expiration: daysAgo(5), contractsShares: 2, symbol: "DIS", tradeType: "CCS", tradeCategory: "Option", strikes: "115/120", openPrice: 1.10, spreadWidth: 5, creditDebit: "CREDIT", commIn: 2.60, allocation: 780, closeDate: daysAgo(10), closePrice: 0.15, commOut: 2.60, behaviorTag: "All to Plan" });
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(55), expiration: daysAgo(25), contractsShares: 3, symbol: "COIN", tradeType: "CCS", tradeCategory: "Option", strikes: "260/265", openPrice: 1.45, spreadWidth: 5, creditDebit: "CREDIT", commIn: 3.90, allocation: 1065, closeDate: daysAgo(30), closePrice: 0, commOut: 0, behaviorTag: "All to Plan" });
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(20), expiration: daysAgo(1), contractsShares: 1, symbol: "PLTR", tradeType: "CCS", tradeCategory: "Option", strikes: "28/30", openPrice: 0.65, spreadWidth: 2, creditDebit: "CREDIT", commIn: 1.30, allocation: 135, closeDate: daysAgo(3), closePrice: 1.50, commOut: 1.30, behaviorTag: "Greed / FOMO" });

    // ═══════════════════════════════════════════════
    // CALL DEBIT SPREADS (CDS) - 3 open, 5 closed
    // ═══════════════════════════════════════════════
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(3), expiration: daysFromNow(21), contractsShares: 2, symbol: "NVDA", tradeType: "CDS", tradeCategory: "Option", strikes: "900/910", openPrice: -3.50, spreadWidth: 10, creditDebit: "DEBIT", commIn: 2.60, allocation: 700 });
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(5), expiration: daysFromNow(14), contractsShares: 1, symbol: "AAPL", tradeType: "CDS", tradeCategory: "Option", strikes: "220/225", openPrice: -2.10, spreadWidth: 5, creditDebit: "DEBIT", commIn: 1.30, allocation: 210 });
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(1), expiration: daysFromNow(35), contractsShares: 3, symbol: "GOOGL", tradeType: "CDS", tradeCategory: "Option", strikes: "170/175", openPrice: -1.80, spreadWidth: 5, creditDebit: "DEBIT", commIn: 3.90, allocation: 540 });

    // Closed CDS
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(45), expiration: daysAgo(15), contractsShares: 2, symbol: "AMZN", tradeType: "CDS", tradeCategory: "Option", strikes: "180/185", openPrice: -2.00, spreadWidth: 5, creditDebit: "DEBIT", commIn: 2.60, allocation: 400, closeDate: daysAgo(20), closePrice: 3.80, commOut: 2.60, behaviorTag: "All to Plan" });
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(60), expiration: daysAgo(30), contractsShares: 1, symbol: "META", tradeType: "CDS", tradeCategory: "Option", strikes: "490/500", openPrice: -4.20, spreadWidth: 10, creditDebit: "DEBIT", commIn: 1.30, allocation: 420, closeDate: daysAgo(35), closePrice: 7.50, commOut: 1.30, behaviorTag: "Feed the Pigeons" });
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(30), expiration: daysAgo(5), contractsShares: 2, symbol: "TSLA", tradeType: "CDS", tradeCategory: "Option", strikes: "275/280", openPrice: -1.90, spreadWidth: 5, creditDebit: "DEBIT", commIn: 2.60, allocation: 380, closeDate: daysAgo(8), closePrice: 0.40, commOut: 2.60, behaviorTag: "Fear / Panic" });
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(80), expiration: daysAgo(50), contractsShares: 3, symbol: "MSFT", tradeType: "CDS", tradeCategory: "Option", strikes: "410/415", openPrice: -2.30, spreadWidth: 5, creditDebit: "DEBIT", commIn: 3.90, allocation: 690, closeDate: daysAgo(55), closePrice: 4.10, commOut: 3.90, behaviorTag: "All to Plan" });
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(25), expiration: daysAgo(1), contractsShares: 1, symbol: "AMD", tradeType: "CDS", tradeCategory: "Option", strikes: "120/125", openPrice: -2.50, spreadWidth: 5, creditDebit: "DEBIT", commIn: 1.30, allocation: 250, closeDate: daysAgo(3), closePrice: 0, commOut: 0 });

    // ═══════════════════════════════════════════════
    // PUT DEBIT SPREADS (PDS) - 2 open, 5 closed
    // ═══════════════════════════════════════════════
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(4), expiration: daysFromNow(17), contractsShares: 2, symbol: "RIVN", tradeType: "PDS", tradeCategory: "Option", strikes: "14/12", openPrice: -0.75, spreadWidth: 2, creditDebit: "DEBIT", commIn: 2.60, allocation: 150 });
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(2), expiration: daysFromNow(24), contractsShares: 1, symbol: "SNAP", tradeType: "PDS", tradeCategory: "Option", strikes: "12/10", openPrice: -0.60, spreadWidth: 2, creditDebit: "DEBIT", commIn: 1.30, allocation: 60 });

    // Closed PDS
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(50), expiration: daysAgo(20), contractsShares: 2, symbol: "INTC", tradeType: "PDS", tradeCategory: "Option", strikes: "22/20", openPrice: -0.80, spreadWidth: 2, creditDebit: "DEBIT", commIn: 2.60, allocation: 160, closeDate: daysAgo(25), closePrice: 1.50, commOut: 2.60, behaviorTag: "All to Plan" });
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(70), expiration: daysAgo(40), contractsShares: 1, symbol: "NKE", tradeType: "PDS", tradeCategory: "Option", strikes: "75/70", openPrice: -1.80, spreadWidth: 5, creditDebit: "DEBIT", commIn: 1.30, allocation: 180, closeDate: daysAgo(45), closePrice: 3.20, commOut: 1.30, behaviorTag: "All to Plan" });
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(35), expiration: daysAgo(5), contractsShares: 3, symbol: "F", tradeType: "PDS", tradeCategory: "Option", strikes: "11/10", openPrice: -0.35, spreadWidth: 1, creditDebit: "DEBIT", commIn: 3.90, allocation: 105, closeDate: daysAgo(10), closePrice: 0, commOut: 0 });
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(55), expiration: daysAgo(25), contractsShares: 2, symbol: "WBA", tradeType: "PDS", tradeCategory: "Option", strikes: "12/10", openPrice: -0.65, spreadWidth: 2, creditDebit: "DEBIT", commIn: 2.60, allocation: 130, closeDate: daysAgo(30), closePrice: 1.40, commOut: 2.60, behaviorTag: "All to Plan" });
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(40), expiration: daysAgo(12), contractsShares: 1, symbol: "PARA", tradeType: "PDS", tradeCategory: "Option", strikes: "12/10", openPrice: -0.50, spreadWidth: 2, creditDebit: "DEBIT", commIn: 1.30, allocation: 50, closeDate: daysAgo(15), closePrice: 0.20, commOut: 1.30, behaviorTag: "Bias / Stubborn" });

    // ═══════════════════════════════════════════════
    // SINGLE OPTIONS — Calls (C), Puts (P), Short Calls (SC), Short Puts (SP)
    // ═══════════════════════════════════════════════

    // Calls - 3 open, 3 closed
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(2), expiration: daysFromNow(30), contractsShares: 5, symbol: "SOFI", tradeType: "C", tradeCategory: "Option", strikes: "14", openPrice: -0.85, creditDebit: "DEBIT", commIn: 3.25, allocation: 425 });
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(4), expiration: daysFromNow(45), contractsShares: 2, symbol: "PLTR", tradeType: "C", tradeCategory: "Option", strikes: "30", openPrice: -2.15, creditDebit: "DEBIT", commIn: 1.30, allocation: 430 });
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(1), expiration: daysFromNow(60), contractsShares: 1, symbol: "NVDA", tradeType: "C", tradeCategory: "Option", strikes: "950", openPrice: -18.50, creditDebit: "DEBIT", commIn: 0.65, allocation: 1850 });
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(30), expiration: daysAgo(5), contractsShares: 3, symbol: "AAPL", tradeType: "C", tradeCategory: "Option", strikes: "215", openPrice: -3.20, creditDebit: "DEBIT", commIn: 1.95, allocation: 960, closeDate: daysAgo(8), closePrice: 6.50, commOut: 1.95, behaviorTag: "All to Plan" });
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(60), expiration: daysAgo(30), contractsShares: 2, symbol: "TSLA", tradeType: "C", tradeCategory: "Option", strikes: "260", openPrice: -8.40, creditDebit: "DEBIT", commIn: 1.30, allocation: 1680, closeDate: daysAgo(35), closePrice: 2.10, commOut: 1.30, behaviorTag: "Fear / Panic" });
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(45), expiration: daysAgo(15), contractsShares: 5, symbol: "AMD", tradeType: "C", tradeCategory: "Option", strikes: "125", openPrice: -1.50, creditDebit: "DEBIT", commIn: 3.25, allocation: 750, closeDate: daysAgo(20), closePrice: 4.30, commOut: 3.25, behaviorTag: "Feed the Pigeons" });

    // Puts - 2 open, 3 closed
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(3), expiration: daysFromNow(20), contractsShares: 3, symbol: "RIVN", tradeType: "P", tradeCategory: "Option", strikes: "13", openPrice: -0.90, creditDebit: "DEBIT", commIn: 1.95, allocation: 270 });
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(5), expiration: daysFromNow(35), contractsShares: 2, symbol: "COIN", tradeType: "P", tradeCategory: "Option", strikes: "200", openPrice: -5.20, creditDebit: "DEBIT", commIn: 1.30, allocation: 1040 });
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(40), expiration: daysAgo(10), contractsShares: 2, symbol: "NFLX", tradeType: "P", tradeCategory: "Option", strikes: "900", openPrice: -12.50, creditDebit: "DEBIT", commIn: 1.30, allocation: 2500, closeDate: daysAgo(15), closePrice: 22.00, commOut: 1.30, behaviorTag: "All to Plan" });
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(55), expiration: daysAgo(25), contractsShares: 1, symbol: "DIS", tradeType: "P", tradeCategory: "Option", strikes: "105", openPrice: -2.80, creditDebit: "DEBIT", commIn: 0.65, allocation: 280, closeDate: daysAgo(30), closePrice: 0.50, commOut: 0.65 });
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(35), expiration: daysAgo(5), contractsShares: 3, symbol: "INTC", tradeType: "P", tradeCategory: "Option", strikes: "20", openPrice: -0.45, creditDebit: "DEBIT", commIn: 1.95, allocation: 135, closeDate: daysAgo(8), closePrice: 1.80, commOut: 1.95, behaviorTag: "All to Plan" });

    // Short Calls - 2 open, 3 closed
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(3), expiration: daysFromNow(14), contractsShares: 1, symbol: "F", tradeType: "SC", tradeCategory: "Option", strikes: "13", openPrice: 0.35, creditDebit: "CREDIT", commIn: 0.65, allocation: 35 });
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(5), expiration: daysFromNow(21), contractsShares: 2, symbol: "T", tradeType: "SC", tradeCategory: "Option", strikes: "24", openPrice: 0.45, creditDebit: "CREDIT", commIn: 1.30, allocation: 90 });
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(30), expiration: daysAgo(5), contractsShares: 1, symbol: "BAC", tradeType: "SC", tradeCategory: "Option", strikes: "45", openPrice: 0.60, creditDebit: "CREDIT", commIn: 0.65, allocation: 60, closeDate: daysAgo(8), closePrice: 0.10, commOut: 0.65, behaviorTag: "All to Plan" });
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(50), expiration: daysAgo(20), contractsShares: 2, symbol: "KO", tradeType: "SC", tradeCategory: "Option", strikes: "62", openPrice: 0.55, creditDebit: "CREDIT", commIn: 1.30, allocation: 110, closeDate: daysAgo(25), closePrice: 0, commOut: 0, behaviorTag: "All to Plan" });
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(40), expiration: daysAgo(10), contractsShares: 3, symbol: "SOFI", tradeType: "SC", tradeCategory: "Option", strikes: "15", openPrice: 0.30, creditDebit: "CREDIT", commIn: 1.95, allocation: 90, closeDate: daysAgo(12), closePrice: 0.75, commOut: 1.95, behaviorTag: "Greed / FOMO" });

    // Short Puts - 2 open, 3 closed
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(4), expiration: daysFromNow(17), contractsShares: 1, symbol: "PG", tradeType: "SP", tradeCategory: "Option", strikes: "160", openPrice: 1.20, creditDebit: "CREDIT", commIn: 0.65, allocation: 120 });
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(2), expiration: daysFromNow(24), contractsShares: 2, symbol: "JNJ", tradeType: "SP", tradeCategory: "Option", strikes: "150", openPrice: 0.95, creditDebit: "CREDIT", commIn: 1.30, allocation: 190 });
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(35), expiration: daysAgo(5), contractsShares: 1, symbol: "XOM", tradeType: "SP", tradeCategory: "Option", strikes: "105", openPrice: 1.50, creditDebit: "CREDIT", commIn: 0.65, allocation: 150, closeDate: daysAgo(8), closePrice: 0.20, commOut: 0.65, behaviorTag: "All to Plan" });
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(60), expiration: daysAgo(30), contractsShares: 2, symbol: "VZ", tradeType: "SP", tradeCategory: "Option", strikes: "39", openPrice: 0.80, creditDebit: "CREDIT", commIn: 1.30, allocation: 160, closeDate: daysAgo(35), closePrice: 0, commOut: 0, behaviorTag: "All to Plan" });
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(45), expiration: daysAgo(15), contractsShares: 3, symbol: "MO", tradeType: "SP", tradeCategory: "Option", strikes: "52", openPrice: 0.65, creditDebit: "CREDIT", commIn: 1.95, allocation: 195, closeDate: daysAgo(18), closePrice: 1.80, commOut: 1.95, behaviorTag: "Bias / Stubborn" });

    // ═══════════════════════════════════════════════
    // BUTTERFLIES — CBFLY, PBFLY
    // ═══════════════════════════════════════════════
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(3), expiration: daysFromNow(14), contractsShares: 5, symbol: "SPY", tradeType: "CBFLY", tradeCategory: "Option", strikes: "565/570/575", openPrice: -0.80, spreadWidth: 5, creditDebit: "DEBIT", commIn: 9.75, allocation: 400 });
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(6), expiration: daysFromNow(7), contractsShares: 3, symbol: "QQQ", tradeType: "PBFLY", tradeCategory: "Option", strikes: "480/475/470", openPrice: -0.65, spreadWidth: 5, creditDebit: "DEBIT", commIn: 5.85, allocation: 195 });
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(30), expiration: daysAgo(5), contractsShares: 5, symbol: "IWM", tradeType: "CBFLY", tradeCategory: "Option", strikes: "210/215/220", openPrice: -0.70, spreadWidth: 5, creditDebit: "DEBIT", commIn: 9.75, allocation: 350, closeDate: daysAgo(7), closePrice: 2.80, commOut: 9.75, behaviorTag: "All to Plan" });
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(50), expiration: daysAgo(20), contractsShares: 3, symbol: "SPY", tradeType: "PBFLY", tradeCategory: "Option", strikes: "550/545/540", openPrice: -0.55, spreadWidth: 5, creditDebit: "DEBIT", commIn: 5.85, allocation: 165, closeDate: daysAgo(25), closePrice: 0.10, commOut: 5.85 });
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(40), expiration: daysAgo(10), contractsShares: 10, symbol: "SPY", tradeType: "CBFLY", tradeCategory: "Option", strikes: "560/565/570", openPrice: -0.50, spreadWidth: 5, creditDebit: "DEBIT", commIn: 19.50, allocation: 500, closeDate: daysAgo(12), closePrice: 3.50, commOut: 19.50, behaviorTag: "All to Plan" });

    // ═══════════════════════════════════════════════
    // CTV — CCTV, PCTV (dual vertical)
    // ═══════════════════════════════════════════════
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(5), expiration: daysFromNow(14), contractsShares: 3, symbol: "SPY", tradeType: "CCTV", tradeCategory: "Option", strikes: "560/565|565/570", openPrice: 0.45, spreadWidth: 5, creditDebit: "CREDIT", commIn: 7.80, allocation: 135 });
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(3), expiration: daysFromNow(21), contractsShares: 5, symbol: "QQQ", tradeType: "PCTV", tradeCategory: "Option", strikes: "470/475|475/480", openPrice: 0.55, spreadWidth: 5, creditDebit: "CREDIT", commIn: 13.00, allocation: 275 });
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(35), expiration: daysAgo(7), contractsShares: 5, symbol: "SPY", tradeType: "CCTV", tradeCategory: "Option", strikes: "555/560|560/565", openPrice: 0.50, spreadWidth: 5, creditDebit: "CREDIT", commIn: 13.00, allocation: 250, closeDate: daysAgo(10), closePrice: 0.10, commOut: 13.00, behaviorTag: "All to Plan" });
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(50), expiration: daysAgo(20), contractsShares: 3, symbol: "IWM", tradeType: "PCTV", tradeCategory: "Option", strikes: "205/210|210/215", openPrice: 0.40, spreadWidth: 5, creditDebit: "CREDIT", commIn: 7.80, allocation: 120, closeDate: daysAgo(25), closePrice: 0, commOut: 0, behaviorTag: "All to Plan" });
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(25), expiration: daysAgo(2), contractsShares: 5, symbol: "QQQ", tradeType: "CCTV", tradeCategory: "Option", strikes: "475/480|480/485", openPrice: 0.35, spreadWidth: 5, creditDebit: "CREDIT", commIn: 13.00, allocation: 175, closeDate: daysAgo(5), closePrice: 0.80, commOut: 13.00, behaviorTag: "Fear / Panic" });

    // ═══════════════════════════════════════════════
    // DAY TRADES — DTC, DTP, DTS, DTCBFLY, DTPBFLY
    // ═══════════════════════════════════════════════
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(1), expiration: daysFromNow(3), contractsShares: 10, symbol: "SPY", tradeType: "DTC", tradeCategory: "Option", strikes: "570", openPrice: -1.20, creditDebit: "DEBIT", commIn: 6.50, allocation: 1200 });
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(5), expiration: daysAgo(5), contractsShares: 5, symbol: "QQQ", tradeType: "DTC", tradeCategory: "Option", strikes: "480", openPrice: -2.50, creditDebit: "DEBIT", commIn: 3.25, allocation: 1250, closeDate: daysAgo(5), closePrice: 3.80, commOut: 3.25, behaviorTag: "All to Plan" });
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(8), expiration: daysAgo(8), contractsShares: 5, symbol: "SPY", tradeType: "DTP", tradeCategory: "Option", strikes: "565", openPrice: -1.80, creditDebit: "DEBIT", commIn: 3.25, allocation: 900, closeDate: daysAgo(8), closePrice: 3.20, commOut: 3.25, behaviorTag: "All to Plan" });
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(10), expiration: daysAgo(10), contractsShares: 10, symbol: "SPY", tradeType: "DTCBFLY", tradeCategory: "Option", strikes: "568/570/572", openPrice: -0.30, spreadWidth: 2, creditDebit: "DEBIT", commIn: 19.50, allocation: 300, closeDate: daysAgo(10), closePrice: 1.20, commOut: 19.50, behaviorTag: "All to Plan" });
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(12), expiration: daysAgo(12), contractsShares: 10, symbol: "QQQ", tradeType: "DTPBFLY", tradeCategory: "Option", strikes: "478/476/474", openPrice: -0.25, spreadWidth: 2, creditDebit: "DEBIT", commIn: 19.50, allocation: 250, closeDate: daysAgo(12), closePrice: 0.05, commOut: 19.50 });

    // Day Trade Shares
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(3), contractsShares: 100, symbol: "SOFI", tradeType: "DTS", tradeCategory: "Stock", openPrice: -13.50, creditDebit: "DEBIT", commIn: 0, allocation: 1350, closeDate: daysAgo(3), closePrice: 13.85, commOut: 0, behaviorTag: "All to Plan" });
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(7), contractsShares: 50, symbol: "PLTR", tradeType: "DTS", tradeCategory: "Stock", openPrice: -27.40, creditDebit: "DEBIT", commIn: 0, allocation: 1370, closeDate: daysAgo(7), closePrice: 26.80, commOut: 0, behaviorTag: "Fear / Panic" });

    // ═══════════════════════════════════════════════
    // STOCKS — LONG, SHORT
    // ═══════════════════════════════════════════════

    // Long stocks - 3 open, 3 closed
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(60), contractsShares: 50, symbol: "AAPL", tradeType: "LONG", tradeCategory: "Stock", openPrice: -218.50, creditDebit: "DEBIT", commIn: 0, allocation: 10925 });
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(30), contractsShares: 100, symbol: "O", tradeType: "LONG", tradeCategory: "Stock", openPrice: -55.20, creditDebit: "DEBIT", commIn: 0, allocation: 5520 });
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(45), contractsShares: 25, symbol: "JEPI", tradeType: "LONG", tradeCategory: "Stock", openPrice: -56.80, creditDebit: "DEBIT", commIn: 0, allocation: 1420 });
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(120), contractsShares: 100, symbol: "HD", tradeType: "LONG", tradeCategory: "Stock", openPrice: -325.00, creditDebit: "DEBIT", commIn: 0, allocation: 32500, closeDate: daysAgo(10), closePrice: 348.50, commOut: 0, behaviorTag: "All to Plan" });
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(90), contractsShares: 50, symbol: "XOM", tradeType: "LONG", tradeCategory: "Stock", openPrice: -108.00, creditDebit: "DEBIT", commIn: 0, allocation: 5400, closeDate: daysAgo(15), closePrice: 112.50, commOut: 0, behaviorTag: "All to Plan" });
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(75), contractsShares: 200, symbol: "F", tradeType: "LONG", tradeCategory: "Stock", openPrice: -11.20, creditDebit: "DEBIT", commIn: 0, allocation: 2240, closeDate: daysAgo(20), closePrice: 10.50, commOut: 0 });

    // Short stocks - 2 open, 3 closed
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(10), contractsShares: 50, symbol: "RIVN", tradeType: "SHORT", tradeCategory: "Stock", openPrice: 14.80, creditDebit: "CREDIT", commIn: 0, allocation: 740 });
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(15), contractsShares: 100, symbol: "SNAP", tradeType: "SHORT", tradeCategory: "Stock", openPrice: 11.50, creditDebit: "CREDIT", commIn: 0, allocation: 1150 });
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(60), contractsShares: 50, symbol: "PARA", tradeType: "SHORT", tradeCategory: "Stock", openPrice: 12.20, creditDebit: "CREDIT", commIn: 0, allocation: 610, closeDate: daysAgo(25), closePrice: 10.80, commOut: 0, behaviorTag: "All to Plan" });
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(45), contractsShares: 100, symbol: "WBA", tradeType: "SHORT", tradeCategory: "Stock", openPrice: 11.80, creditDebit: "CREDIT", commIn: 0, allocation: 1180, closeDate: daysAgo(20), closePrice: 13.20, commOut: 0, behaviorTag: "Bias / Stubborn" });
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(30), contractsShares: 75, symbol: "INTC", tradeType: "SHORT", tradeCategory: "Stock", openPrice: 21.50, creditDebit: "CREDIT", commIn: 0, allocation: 1612, closeDate: daysAgo(10), closePrice: 19.80, commOut: 0, behaviorTag: "All to Plan" });

    // ═══════════════════════════════════════════════
    // UNBALANCED BUTTERFLIES — CUBFLY, PUBFLY, CUBFLYD, PUBFLYD
    // ═══════════════════════════════════════════════
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(4), expiration: daysFromNow(10), contractsShares: 5, symbol: "SPY", tradeType: "CUBFLY", tradeCategory: "Option", strikes: "568/572/574", openPrice: 0.20, spreadWidth: 4, creditDebit: "CREDIT", commIn: 9.75, allocation: 100 });
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(20), expiration: daysAgo(2), contractsShares: 3, symbol: "QQQ", tradeType: "PUBFLY", tradeCategory: "Option", strikes: "476/472/470", openPrice: 0.15, spreadWidth: 4, creditDebit: "CREDIT", commIn: 5.85, allocation: 45, closeDate: daysAgo(5), closePrice: 0, commOut: 0, behaviorTag: "All to Plan" });
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(6), expiration: daysFromNow(14), contractsShares: 5, symbol: "IWM", tradeType: "CUBFLYD", tradeCategory: "Option", strikes: "212/216/218", openPrice: -0.40, spreadWidth: 4, creditDebit: "DEBIT", commIn: 9.75, allocation: 200 });
    trades.push({ pilotOrAdd: "Pilot", tradeDate: daysAgo(25), expiration: daysAgo(3), contractsShares: 5, symbol: "SPY", tradeType: "PUBFLYD", tradeCategory: "Option", strikes: "558/554/552", openPrice: -0.35, spreadWidth: 4, creditDebit: "DEBIT", commIn: 9.75, allocation: 175, closeDate: daysAgo(5), closePrice: 1.50, commOut: 9.75, behaviorTag: "All to Plan" });

    // Insert all trades
    for (const trade of trades) {
      await client.query(
        `INSERT INTO trades (user_id, pilot_or_add, trade_date, expiration, contracts_shares, symbol, trade_type, trade_category, strikes, open_price, spread_width, credit_debit, comm_in, allocation, close_date, close_price, comm_out, behavior_tag, trade_plan_notes, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
        [
          userId, trade.pilotOrAdd, trade.tradeDate, trade.expiration || null, trade.contractsShares,
          trade.symbol, trade.tradeType, trade.tradeCategory, trade.strikes || null,
          trade.openPrice, trade.spreadWidth || null, trade.creditDebit, trade.commIn || 0,
          trade.allocation || null, trade.closeDate || null, trade.closePrice ?? null,
          trade.commOut ?? null, trade.behaviorTag || null, trade.tradePlanNotes || null,
          new Date().toISOString()
        ]
      );
    }
    console.log(`Inserted ${trades.length} trades`);

    // Account transactions
    await client.query(`INSERT INTO account_transactions (user_id, amount, trans_type, date, note) VALUES ($1, 25000, 'Deposit', $2, 'Initial deposit')`, [userId, daysAgo(120)]);
    await client.query(`INSERT INTO account_transactions (user_id, amount, trans_type, date, note) VALUES ($1, 5000, 'Deposit', $2, 'Monthly add')`, [userId, daysAgo(60)]);

    console.log("Demo account seeded successfully!");
    console.log(`Login: ottertrader@stockotter.ai / demo123`);

  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(console.error);
