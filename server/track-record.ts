/**
 * Track Record System
 * 
 * 1. Daily Signal Logger — runs once per day during market hours,
 *    scans top stocks, logs VER/AMC/BBTC signals with the price at time of signal.
 * 
 * 2. Outcome Checker — runs daily, looks back at signals from 7/30/90 days ago,
 *    fills in the actual forward returns and SPY benchmark returns.
 * 
 * 3. Backtest Engine — runs VER/AMC/BBTC signals on historical data to build
 *    a track record going back 2+ years.
 */

import { db } from "./storage";
import { signalLog, favorites } from "@shared/schema";
import { eq, and, isNull, lte, sql } from "drizzle-orm";
import { computeRSISeries } from "./indicators";

// Curated large/mid-cap universe used when the screener is unavailable
const FALLBACK_UNIVERSE: string[] = [
  // Mega-cap tech
  "AAPL", "MSFT", "NVDA", "GOOGL", "GOOG", "AMZN", "META", "TSLA", "AVGO", "ORCL",
  "CRM", "ADBE", "NFLX", "AMD", "INTC", "QCOM", "CSCO", "IBM", "NOW", "PANW",
  "SNOW", "PLTR", "UBER", "ABNB", "SHOP", "SQ", "PYPL", "ROKU", "COIN", "MSTR",
  // Financials
  "JPM", "BAC", "WFC", "GS", "MS", "C", "V", "MA", "AXP", "BLK",
  "SCHW", "SPGI", "CME", "ICE", "COF", "USB", "PNC", "TFC",
  // Healthcare / pharma
  "UNH", "JNJ", "LLY", "ABBV", "MRK", "PFE", "TMO", "ABT", "DHR", "BMY",
  "AMGN", "GILD", "CVS", "MDT", "ISRG", "REGN", "VRTX", "ZTS",
  // Consumer
  "WMT", "COST", "HD", "LOW", "PG", "KO", "PEP", "MCD", "SBUX", "NKE",
  "TGT", "LULU", "CMG", "DIS", "BKNG", "TJX", "DG", "DLTR", "ULTA",
  // Industrials / energy
  "XOM", "CVX", "COP", "SLB", "EOG", "OXY", "PSX", "MPC", "VLO",
  "CAT", "DE", "HON", "GE", "BA", "LMT", "RTX", "NOC", "UPS", "FDX",
  // Semis / hardware
  "ASML", "TSM", "MU", "LRCX", "AMAT", "KLAC", "MRVL", "ARM", "ON",
  // Communication / internet
  "T", "VZ", "TMUS", "CMCSA", "DIS", "SPOT", "PINS", "SNAP", "RBLX",
  // Broad ETFs (benchmark + liquid breadth)
  "SPY", "QQQ", "IWM", "DIA", "XLK", "XLF", "XLE", "XLV", "SMH", "XLY",
];

// ─── Types ────────────────────────────────────────────────────────────────────

interface SignalEntry {
  ticker: string;
  signalDate: string;
  signalType: string;
  source: string;
  score: number | null;
  priceAtSignal: number;
}

// ─── Signal Logger ────────────────────────────────────────────────────────────

export async function logSignals(
  getQuote: (ticker: string) => Promise<any>,
  screenStocks: (options: any) => Promise<string[]>,
  computeEMA: (closes: number[], length: number) => number[],
  getChart: (ticker: string, range: string, interval: string) => Promise<any>,
  ensureReady: () => Promise<void>,
): Promise<number> {
  console.log("[track-record] Starting daily signal scan...");
  const today = new Date().toISOString().split("T")[0];

  // Check if we already logged today
  const existing = await db.select({ count: sql<number>`count(*)` })
    .from(signalLog)
    .where(eq(signalLog.signalDate, today));
  if (existing[0]?.count > 0) {
    console.log(`[track-record] Already logged ${existing[0].count} signals today, skipping.`);
    return 0;
  }

  await ensureReady();

  // Universe construction: merge (a) top ~150 from screener, (b) every
  // ticker any user has on their watchlist/dividend list, (c) curated
  // fallback list. Deduped, capped at 200 per run.
  const tickerSet = new Set<string>();

  // (a) Screener — top 150 liquid names
  try {
    const screened = await screenStocks({
      minPrice: 5, maxPrice: 5000, sector: "all",
      marketCapTier: "all", count: 150, showAll: true,
    });
    for (const t of screened) tickerSet.add(t.toUpperCase());
    console.log(`[track-record] Screener returned ${screened.length} tickers`);
  } catch (err: any) {
    console.log("[track-record] Screener failed, will rely on fallback + watchlists");
  }

  // (b) Every user's watchlist + dividend list
  try {
    const rows = await db
      .select({ ticker: favorites.ticker })
      .from(favorites);
    for (const r of rows) {
      if (r.ticker) tickerSet.add(r.ticker.toUpperCase());
    }
    console.log(`[track-record] Added user watchlist tickers — universe now ${tickerSet.size}`);
  } catch (err: any) {
    console.log("[track-record] Failed to merge watchlists:", err?.message);
  }

  // (c) Curated fallback universe (ensures coverage even if screener is down)
  for (const t of FALLBACK_UNIVERSE) tickerSet.add(t);

  // Always include SPY/QQQ/IWM as benchmarks
  ["SPY", "QQQ", "IWM"].forEach(t => tickerSet.add(t));

  const tickers = Array.from(tickerSet).slice(0, 200);
  console.log(`[track-record] Final universe: ${tickers.length} tickers`);

  const entries: SignalEntry[] = [];

  for (const ticker of tickers) {
    try {
      // Get current price
      const quote = await getQuote(ticker);
      if (!quote) continue;
      const price = quote.price?.regularMarketPrice || 0;
      if (!price) continue;

      // Get 1Y chart for technical analysis
      const chart = await getChart(ticker, "1y", "1d");
      if (!chart) continue;

      const timestamps = chart.chart?.result?.[0]?.timestamp || [];
      const closes = chart.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [];
      const volumes = chart.chart?.result?.[0]?.indicators?.quote?.[0]?.volume || [];

      if (closes.length < 50) continue;

      // Clean data
      const cleanCloses = closes.map((c: any, i: number) => c ?? closes[i - 1] ?? 0).filter((c: number) => c > 0);
      const cleanVolumes = volumes.map((v: any) => v ?? 0);

      // Compute EMAs
      const ema9 = computeEMA(cleanCloses, 9);
      const ema21 = computeEMA(cleanCloses, 21);
      const ema50 = computeEMA(cleanCloses, 50);

      const lastClose = cleanCloses[cleanCloses.length - 1];
      const lastEma9 = ema9[ema9.length - 1];
      const lastEma21 = ema21[ema21.length - 1];
      const lastEma50 = ema50[ema50.length - 1];

      // ── BBTC Signal ──
      const ema9Above21 = lastEma9 > lastEma21;
      const ema21Above50 = lastEma21 > lastEma50;
      const priceAboveEma9 = lastClose > lastEma9;

      let bbtcSignal = "HOLD";
      if (ema9Above21 && priceAboveEma9) bbtcSignal = "BUY";
      if (!ema9Above21 && !priceAboveEma9) bbtcSignal = "SELL";

      // ── VER Signal (Volume Exhaustion) ──
      const avgVol = cleanVolumes.slice(-20).reduce((a: number, b: number) => a + b, 0) / 20;
      const lastVol = cleanVolumes[cleanVolumes.length - 1] || 0;
      const volRatio = avgVol > 0 ? lastVol / avgVol : 1;

      // RSI — Wilder's smoothed, same as Scanner / VER / TradingView.
      // Previously this was a simple MA over the last 14 bars which produced
      // slightly different values than the rest of the app.
      const rsiSeries = computeRSISeries(cleanCloses, { period: 14 });
      const rsiLast = rsiSeries[rsiSeries.length - 1];
      const rsi = Number.isFinite(rsiLast) ? rsiLast : 50;

      let verSignal = "HOLD";
      if (rsi < 30 && volRatio > 1.5) verSignal = "BUY"; // oversold + high volume = exhaustion reversal
      if (rsi > 70 && volRatio > 1.5) verSignal = "SELL"; // overbought + high volume = exhaustion top

      // ── Combined Signal ──
      let combinedScore = 0;
      if (bbtcSignal === "BUY") combinedScore += 2;
      if (bbtcSignal === "SELL") combinedScore -= 2;
      if (verSignal === "BUY") combinedScore += 2;
      if (verSignal === "SELL") combinedScore -= 2;
      if (ema21Above50) combinedScore += 1; else combinedScore -= 1;

      let combinedSignal = "HOLD";
      if (combinedScore >= 3) combinedSignal = "STRONG_BUY";
      else if (combinedScore >= 1) combinedSignal = "BUY";
      else if (combinedScore <= -3) combinedSignal = "STRONG_SELL";
      else if (combinedScore <= -1) combinedSignal = "SELL";

      // Log each signal source
      if (bbtcSignal !== "HOLD") {
        entries.push({ ticker, signalDate: today, signalType: bbtcSignal, source: "BBTC", score: combinedScore, priceAtSignal: price });
      }
      if (verSignal !== "HOLD") {
        entries.push({ ticker, signalDate: today, signalType: verSignal, source: "VER", score: combinedScore, priceAtSignal: price });
      }
      // Always log the combined signal
      entries.push({ ticker, signalDate: today, signalType: combinedSignal, source: "COMBINED", score: combinedScore, priceAtSignal: price });

    } catch (err: any) {
      console.log(`[track-record] Failed to analyze ${ticker}: ${err.message}`);
    }
  }

  // Insert all entries
  if (entries.length > 0) {
    for (const entry of entries) {
      await db.insert(signalLog).values(entry);
    }
    console.log(`[track-record] Logged ${entries.length} signals for ${today}`);
  }

  return entries.length;
}

// ─── Outcome Checker ──────────────────────────────────────────────────────────

export async function checkOutcomes(
  getQuote: (ticker: string) => Promise<any>,
  ensureReady: () => Promise<void>,
): Promise<number> {
  console.log("[track-record] Checking outcomes...");
  await ensureReady();

  const today = new Date();
  let updated = 0;

  // Find signals that need 7-day check (signal_date is 7+ days ago, return_7d is null)
  const d7 = new Date(today); d7.setDate(d7.getDate() - 7);
  const d30 = new Date(today); d30.setDate(d30.getDate() - 30);
  const d90 = new Date(today); d90.setDate(d90.getDate() - 90);

  // Get SPY price for benchmark
  let spyPrice = 0;
  try {
    const spyQuote = await getQuote("SPY");
    spyPrice = spyQuote?.price?.regularMarketPrice || 0;
  } catch {}

  // Check 7-day outcomes
  const need7d = await db.select().from(signalLog)
    .where(and(
      isNull(signalLog.return7d),
      lte(signalLog.signalDate, d7.toISOString().split("T")[0]),
    ))
    .limit(50);

  for (const sig of need7d) {
    try {
      const quote = await getQuote(sig.ticker);
      const currentPrice = quote?.price?.regularMarketPrice;
      if (!currentPrice || !sig.priceAtSignal) continue;

      const ret = ((currentPrice - sig.priceAtSignal) / sig.priceAtSignal) * 100;

      // Get SPY return for same period
      const spySig = await db.select().from(signalLog)
        .where(and(
          eq(signalLog.ticker, "SPY"),
          eq(signalLog.signalDate, sig.signalDate),
          eq(signalLog.source, "COMBINED"),
        ))
        .limit(1);
      const spyAtSignal = spySig[0]?.priceAtSignal || 0;
      const spyRet = spyAtSignal > 0 && spyPrice > 0 ? ((spyPrice - spyAtSignal) / spyAtSignal) * 100 : null;

      await db.update(signalLog)
        .set({
          price7d: currentPrice,
          return7d: Number(ret.toFixed(2)),
          spyReturn7d: spyRet != null ? Number(spyRet.toFixed(2)) : null,
        })
        .where(eq(signalLog.id, sig.id));
      updated++;
    } catch {}
  }

  // Check 30-day outcomes
  const need30d = await db.select().from(signalLog)
    .where(and(
      isNull(signalLog.return30d),
      lte(signalLog.signalDate, d30.toISOString().split("T")[0]),
    ))
    .limit(50);

  for (const sig of need30d) {
    try {
      const quote = await getQuote(sig.ticker);
      const currentPrice = quote?.price?.regularMarketPrice;
      if (!currentPrice || !sig.priceAtSignal) continue;

      const ret = ((currentPrice - sig.priceAtSignal) / sig.priceAtSignal) * 100;
      const spySig = await db.select().from(signalLog)
        .where(and(eq(signalLog.ticker, "SPY"), eq(signalLog.signalDate, sig.signalDate), eq(signalLog.source, "COMBINED")))
        .limit(1);
      const spyAtSignal = spySig[0]?.priceAtSignal || 0;
      const spyRet = spyAtSignal > 0 && spyPrice > 0 ? ((spyPrice - spyAtSignal) / spyAtSignal) * 100 : null;

      await db.update(signalLog)
        .set({ price30d: currentPrice, return30d: Number(ret.toFixed(2)), spyReturn30d: spyRet != null ? Number(spyRet.toFixed(2)) : null })
        .where(eq(signalLog.id, sig.id));
      updated++;
    } catch {}
  }

  // Check 90-day outcomes
  const need90d = await db.select().from(signalLog)
    .where(and(
      isNull(signalLog.return90d),
      lte(signalLog.signalDate, d90.toISOString().split("T")[0]),
    ))
    .limit(50);

  for (const sig of need90d) {
    try {
      const quote = await getQuote(sig.ticker);
      const currentPrice = quote?.price?.regularMarketPrice;
      if (!currentPrice || !sig.priceAtSignal) continue;

      const ret = ((currentPrice - sig.priceAtSignal) / sig.priceAtSignal) * 100;
      const spySig = await db.select().from(signalLog)
        .where(and(eq(signalLog.ticker, "SPY"), eq(signalLog.signalDate, sig.signalDate), eq(signalLog.source, "COMBINED")))
        .limit(1);
      const spyAtSignal = spySig[0]?.priceAtSignal || 0;
      const spyRet = spyAtSignal > 0 && spyPrice > 0 ? ((spyPrice - spyAtSignal) / spyAtSignal) * 100 : null;

      await db.update(signalLog)
        .set({ price90d: currentPrice, return90d: Number(ret.toFixed(2)), spyReturn90d: spyRet != null ? Number(spyRet.toFixed(2)) : null })
        .where(eq(signalLog.id, sig.id));
      updated++;
    } catch {}
  }

  console.log(`[track-record] Updated ${updated} outcome records`);
  return updated;
}

// ─── Track Record Stats (for API) ─────────────────────────────────────────────

export async function getTrackRecordStats() {
  // Get all signals with outcomes
  const allSignals = await db.select().from(signalLog)
    .where(eq(signalLog.source, "COMBINED"));

  const withReturns7d = allSignals.filter(s => s.return7d != null);
  const withReturns30d = allSignals.filter(s => s.return30d != null);
  const withReturns90d = allSignals.filter(s => s.return90d != null);

  // Win rate by signal type
  function winRate(signals: typeof allSignals, returnField: 'return7d' | 'return30d' | 'return90d') {
    const withData = signals.filter(s => s[returnField] != null);
    if (withData.length === 0) return null;
    const wins = withData.filter(s => {
      const ret = s[returnField]!;
      const isBuy = s.signalType === "BUY" || s.signalType === "STRONG_BUY";
      const isSell = s.signalType === "SELL" || s.signalType === "STRONG_SELL";
      if (isBuy) return ret > 0;
      if (isSell) return ret < 0;
      return false;
    });
    return {
      winRate: Number(((wins.length / withData.length) * 100).toFixed(1)),
      avgReturn: Number((withData.reduce((s, r) => s + (r[returnField] || 0), 0) / withData.length).toFixed(2)),
      count: withData.length,
      wins: wins.length,
    };
  }

  // Score bracket analysis
  function byBracket(signals: typeof allSignals, returnField: 'return7d' | 'return30d' | 'return90d') {
    const brackets = [
      { label: "Strong Buy (3+)", min: 3, max: 99 },
      { label: "Buy (1-2)", min: 1, max: 2 },
      { label: "Hold (0)", min: 0, max: 0 },
      { label: "Sell (-1 to -2)", min: -2, max: -1 },
      { label: "Strong Sell (-3+)", min: -99, max: -3 },
    ];

    return brackets.map(b => {
      const inBracket = signals.filter(s =>
        s.score != null && s.score >= b.min && s.score <= b.max && s[returnField] != null
      );
      if (inBracket.length === 0) return { ...b, count: 0, avgReturn: 0, winRate: 0 };
      const avgRet = inBracket.reduce((s, r) => s + (r[returnField] || 0), 0) / inBracket.length;
      const wins = inBracket.filter(s => {
        const isBuy = s.score! > 0;
        return isBuy ? s[returnField]! > 0 : s[returnField]! < 0;
      });
      return {
        ...b,
        count: inBracket.length,
        avgReturn: Number(avgRet.toFixed(2)),
        winRate: Number(((wins.length / inBracket.length) * 100).toFixed(1)),
      };
    });
  }

  // Best and worst calls
  const bestCalls = [...withReturns30d]
    .filter(s => s.signalType === "BUY" || s.signalType === "STRONG_BUY")
    .sort((a, b) => (b.return30d || 0) - (a.return30d || 0))
    .slice(0, 5)
    .map(s => ({ ticker: s.ticker, date: s.signalDate, signal: s.signalType, score: s.score, priceAtSignal: s.priceAtSignal, return30d: s.return30d }));

  const worstCalls = [...withReturns30d]
    .filter(s => s.signalType === "BUY" || s.signalType === "STRONG_BUY")
    .sort((a, b) => (a.return30d || 0) - (b.return30d || 0))
    .slice(0, 5)
    .map(s => ({ ticker: s.ticker, date: s.signalDate, signal: s.signalType, score: s.score, priceAtSignal: s.priceAtSignal, return30d: s.return30d }));

  // vs SPY
  const vsSpyData = withReturns30d.filter(s => s.spyReturn30d != null && (s.signalType === "BUY" || s.signalType === "STRONG_BUY"));
  const avgOtterReturn = vsSpyData.length > 0 ? vsSpyData.reduce((s, r) => s + (r.return30d || 0), 0) / vsSpyData.length : 0;
  const avgSpyReturn = vsSpyData.length > 0 ? vsSpyData.reduce((s, r) => s + (r.spyReturn30d || 0), 0) / vsSpyData.length : 0;

  return {
    totalSignals: allSignals.length,
    signalsWithOutcomes: {
      day7: withReturns7d.length,
      day30: withReturns30d.length,
      day90: withReturns90d.length,
    },
    performance: {
      day7: winRate(allSignals, "return7d"),
      day30: winRate(allSignals, "return30d"),
      day90: winRate(allSignals, "return90d"),
    },
    byScoreBracket: {
      day30: byBracket(allSignals, "return30d"),
    },
    bestCalls,
    worstCalls,
    vsSpy: {
      otterAvg30d: Number(avgOtterReturn.toFixed(2)),
      spyAvg30d: Number(avgSpyReturn.toFixed(2)),
      alpha: Number((avgOtterReturn - avgSpyReturn).toFixed(2)),
      sampleSize: vsSpyData.length,
    },
    // Recent signals (last 10)
    recentSignals: allSignals
      .sort((a, b) => b.signalDate.localeCompare(a.signalDate))
      .slice(0, 20)
      .map(s => ({
        ticker: s.ticker, date: s.signalDate, signal: s.signalType, score: s.score,
        price: s.priceAtSignal, return7d: s.return7d, return30d: s.return30d, return90d: s.return90d,
      })),
  };
}
