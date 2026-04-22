import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage, db } from "./storage";
import { tradePriceHistory } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth, registerHandler, loginHandler, logoutHandler, meHandler, updateProfileHandler, changePasswordHandler, forgotPasswordHandler, resetPasswordHandler } from "./auth";
import { getCached, setCache, clearCache, getCacheStats, TTL } from "./cache";
import { enqueue, getQueueStats, recordCacheHit } from "./request-queue";
import { DEMO_EMAIL, DEMO_IDLE_TIMEOUT_MS, seedDemoAccount } from "./demo-seed";
import { getUserTier, createCheckoutSession, createPortalSession, TIER_LIMITS } from "./stripe";
import { runGateSystem, analyzeTicker, type GateSystemResult } from "./signal-engine";
import pg from "pg";
import { computeRSISeries } from "./indicators";
import { computeBBTC, computeVER, computeAMC, scoreAMC } from "./signals";
import {
  getPolygonQuoteSummary,
  getPolygonChart,
  polygonSearch,
  getPolygonOptionsChain,
  getPolygonUniverse,
  polygonScreener,
  polygonHasOptions,
  getPolygonEarningsRow,
} from "./polygon";

// ─── Demo Account Activity Tracking ──────────────────────────────────────────
let demoLastActivity: number = 0; // timestamp of last API request from demo user
let demoUserId: number | null = null; // cached demo user ID
let demoResetInProgress = false;

function isDemoUser(req: any): boolean {
  return req.user?.email === DEMO_EMAIL;
}

function touchDemoActivity(req: any) {
  if (isDemoUser(req)) {
    demoLastActivity = Date.now();
    if (!demoUserId) demoUserId = req.user!.id;
  }
}

// ============================================================
// Yahoo Finance direct API fetcher (bypasses yahoo-finance2 lib
// which gets blocked on cloud servers like Railway/Render)
// ============================================================

const YF_BASE_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
};

let _crumb: string | null = null;
let _cookie: string | null = null;
let _crumbTimestamp = 0;

function extractCookies(r: Response): string {
  const parts: string[] = [];
  if (typeof r.headers.getSetCookie === 'function') {
    for (const c of r.headers.getSetCookie()) parts.push(c.split(";")[0]);
  }
  if (parts.length === 0) {
    const raw = r.headers.get('set-cookie');
    if (raw) for (const c of raw.split(/,(?=[A-Z])/)) parts.push(c.trim().split(";")[0]);
  }
  return parts.filter(Boolean).join("; ");
}

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
];

async function getYahooCrumb(): Promise<{ crumb: string; cookie: string }> {
  // Cache crumb for 5 minutes
  if (_crumb && _cookie && Date.now() - _crumbTimestamp < 5 * 60 * 1000) {
    return { crumb: _crumb, cookie: _cookie };
  }

  console.log("[yahoo] Fetching new crumb...");
  const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  const headers: Record<string, string> = {
    ...YF_BASE_HEADERS,
    "User-Agent": ua,
  };

  let cookie = "";

  // Method 1: fc.yahoo.com with consent cookie pre-set
  try {
    const r = await fetch("https://fc.yahoo.com/", {
      headers: { ...headers, Cookie: "A3=d=AQABBCEfZ2sCEGeYRHxNTUFZQJGoCx0FEgEBAQEBaGwDZmYAAAAAAA&S=AQAAApCLhM_S" },
      redirect: "manual",
    });
    cookie = extractCookies(r);
    if (cookie) console.log("[yahoo] fc.yahoo.com: cookie obtained");
  } catch (e) {
    console.log("[yahoo] fc.yahoo.com failed:", (e as Error).message);
  }

  // Method 2: consent.yahoo.com (bypasses geo blocks)
  if (!cookie) {
    try {
      const r = await fetch("https://consent.yahoo.com/v2/collectConsent?sessionId=1", {
        headers,
        redirect: "manual",
      });
      cookie = extractCookies(r);
      if (cookie) console.log("[yahoo] consent.yahoo.com: cookie obtained");
    } catch (e) {
      console.log("[yahoo] consent.yahoo.com failed:", (e as Error).message);
    }
  }

  // Method 3: login.yahoo.com
  if (!cookie) {
    try {
      const r = await fetch("https://login.yahoo.com/", {
        headers,
        redirect: "manual",
      });
      cookie = extractCookies(r);
      if (cookie) console.log("[yahoo] login.yahoo.com: cookie obtained");
    } catch (e) {
      console.log("[yahoo] login.yahoo.com failed:", (e as Error).message);
    }
  }

  // Method 4: finance.yahoo.com direct
  if (!cookie) {
    try {
      const r = await fetch("https://finance.yahoo.com/", {
        headers,
        redirect: "follow",
      });
      cookie = extractCookies(r);
      if (cookie) console.log("[yahoo] finance.yahoo.com: cookie obtained");
    } catch (e) {
      console.log("[yahoo] finance.yahoo.com failed:", (e as Error).message);
    }
  }

  // Method 5: Synthetic cookie (last resort — works for some endpoints)
  if (!cookie) {
    cookie = "A1=d=AQABBCEfZ2sCEGeYRHxNTUFZQJGoCx0FEgEBAQEBaGwDZmYAAAAAAA&S=AQAAApCLhM_S; A3=d=AQABBCEfZ2sCEGeYRHxNTUFZQJGoCx0FEgEBAQEBaGwDZmYAAAAAAA&S=AQAAApCLhM_S";
    console.log("[yahoo] Using synthetic cookie as last resort");
  }

  console.log("[yahoo] Cookie:", cookie ? "obtained" : "MISSING");

  if (!cookie) {
    throw new Error("Failed to obtain Yahoo Finance cookie");
  }

  // Try query1 first (better for cloud servers), then query2, with 429 retry
  let crumb = "";
  let crumbStatus = 0;
  for (const host of ["query1", "query2"]) {
    const crumbResp = await fetch(`https://${host}.finance.yahoo.com/v1/test/getcrumb`, {
      headers: { ...headers, Accept: "text/plain", Cookie: cookie },
    });
    crumbStatus = crumbResp.status;
    if (crumbResp.status === 429) {
      console.log(`[yahoo] ${host} crumb returned 429 (rate limited), waiting 3s...`);
      await new Promise(r => setTimeout(r, 3000));
      continue;
    }
    if (crumbResp.status === 200) {
      crumb = await crumbResp.text();
      console.log(`[yahoo] Crumb from ${host}:`, crumb ? crumb.substring(0, 15) + "..." : "EMPTY");
      break;
    }
    console.log(`[yahoo] ${host} crumb failed (${crumbResp.status})`);
  }

  // Validate crumb
  if (!crumb || crumb.length > 50 || crumb.includes("<") || crumb.includes("{")) {
    throw new Error(`Failed to obtain crumb (status ${crumbStatus})`);
  }

  _crumb = crumb;
  _cookie = cookie;
  _crumbTimestamp = Date.now();

  return { crumb, cookie };
}

// Direct fetch (used by the queue internally)
async function _yahooFetchDirect(url: string, retries = 3): Promise<any> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const { crumb, cookie } = await getYahooCrumb();
      const separator = url.includes("?") ? "&" : "?";
      const fullUrl = `${url}${separator}crumb=${encodeURIComponent(crumb)}`;
      console.log(`[yahoo] Fetching: ${fullUrl.substring(0, 120)}...`);

      const resp = await fetch(fullUrl, {
        headers: { ...YF_BASE_HEADERS, Cookie: cookie },
      });

      if (resp.status === 429) {
        console.log(`[yahoo] Rate limited (429), waiting ${(attempt + 1) * 2}s before retry...`);
        _crumb = null; _cookie = null; _crumbTimestamp = 0;
        if (attempt < retries) { await new Promise(r => setTimeout(r, (attempt + 1) * 2000)); continue; }
        throw new Error(`Yahoo Finance rate limited (429)`);
      }

      if (resp.status === 401 || resp.status === 403) {
        console.log(`[yahoo] Auth error ${resp.status}, refreshing crumb...`);
        _crumb = null; _cookie = null; _crumbTimestamp = 0;
        if (attempt < retries) { await new Promise(r => setTimeout(r, 1000)); continue; }
        throw new Error(`Yahoo Finance returned ${resp.status}`);
      }

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        console.log(`[yahoo] Error ${resp.status}: ${errText.substring(0, 150)}`);
        // If the error body suggests auth/crumb issue, retry with fresh crumb
        if (errText.includes('Unauthorized') || errText.includes('crumb')) {
          _crumb = null; _cookie = null; _crumbTimestamp = 0;
          if (attempt < retries) { await new Promise(r => setTimeout(r, 500)); continue; }
        }
        throw new Error(`Yahoo Finance API error: ${resp.status}`);
      }

      const json = await resp.json();
      
      // Check if quoteSummary returned null result (bad crumb returns 200 but empty result)
      if (json?.quoteSummary?.result === null && json?.quoteSummary?.error) {
        console.log(`[yahoo] quoteSummary returned error: ${JSON.stringify(json.quoteSummary.error)}`);
        _crumb = null; _cookie = null; _crumbTimestamp = 0;
        if (attempt < retries) { await new Promise(r => setTimeout(r, 500)); continue; }
      }
      
      return json;
    } catch (err: any) {
      if (attempt < retries) {
        _crumb = null;
        _cookie = null;
        _crumbTimestamp = 0;
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      throw err;
    }
  }
}

// Queued Yahoo fetch — all requests go through the global rate limiter
async function yahooFetch(url: string, retries = 3): Promise<any> {
  return enqueue(() => _yahooFetchDirect(url, retries), url.substring(0, 80));
}

// Use query1 as primary (better compatibility with cloud server IPs)
const YF_QUERY_BASE = "https://query1.finance.yahoo.com";

async function getQuote(ticker: string): Promise<any> {
  const cacheKey = `quote:${ticker.toUpperCase()}`;
  const cached = getCached(cacheKey);
  if (cached) {
    recordCacheHit();
    return cached;
  }
  // Primary: Polygon (Stocks Starter). Returns a Yahoo-shaped quoteSummary.result[0] object.
  const result = await getPolygonQuoteSummary(ticker);
  if (result) setCache(cacheKey, result, TTL.quote);
  return result;
}

// Lightweight quote — Polygon snapshot returns everything in one call already,
// so we can share the code path with getQuote.
async function getQuoteLight(ticker: string): Promise<any> {
  return getQuote(ticker);
}

async function getChart(ticker: string, range: string, interval: string): Promise<any> {
  const cacheKey = `chart:${ticker.toUpperCase()}:${range}:${interval}`;
  const cached = getCached(cacheKey);
  if (cached) {
    console.log(`[chart] Cache hit: ${ticker} ${range}`);
    return cached;
  }

  // Polygon Stocks Starter gives ~5 years of history. For longer ranges (10y/25y/max)
  // we fall back to Yahoo so the Verdict 25y stress test keeps working.
  const isLongRange = range === "10y" || range === "25y" || range === "max";

  if (isLongRange) {
    try {
      const data = await yahooFetch(
        `${YF_QUERY_BASE}/v8/finance/chart/${encodeURIComponent(ticker)}?range=${range}&interval=${interval}&includePrePost=false`
      );
      const result = data?.chart?.result?.[0] || null;
      if (result) setCache(cacheKey, result, TTL.chart);
      return result;
    } catch (err) {
      console.log(`[chart] Yahoo long-range fallback failed for ${ticker} ${range}, trying Polygon:`, (err as Error).message);
      // Fall through to Polygon (will be capped at ~5y)
    }
  }

  try {
    const result = await getPolygonChart(ticker, range, interval);
    if (result && result.timestamp?.length) {
      setCache(cacheKey, result, TTL.chart);
      return result;
    }
  } catch (err) {
    console.log(`[chart] Polygon failed for ${ticker} ${range}:`, (err as Error).message);
  }

  // Last-resort fallback: Yahoo (for any range)
  try {
    const data = await yahooFetch(
      `${YF_QUERY_BASE}/v8/finance/chart/${encodeURIComponent(ticker)}?range=${range}&interval=${interval}&includePrePost=false`
    );
    const result = data?.chart?.result?.[0] || null;
    if (result) setCache(cacheKey, result, TTL.chart);
    return result;
  } catch (err) {
    console.log(`[chart] All sources failed for ${ticker} ${range}`);
    return null;
  }
}

// ============================================================
// Institutional / Market Maker Data Fetchers
// ============================================================

async function getInstitutionalData(ticker: string): Promise<any> {
  const cacheKey = `inst:${ticker.toUpperCase()}`;
  const cached = getCached(cacheKey);
  if (cached) { recordCacheHit(); return cached; }
  const modules = [
    "institutionOwnership", "insiderHolders", "insiderTransactions",
    "majorHoldersBreakdown", "netSharePurchaseActivity", "fundOwnership",
    "price", "summaryDetail"
  ].join("%2C");
  const data = await yahooFetch(
    `${YF_QUERY_BASE}/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=${modules}`
  );
  const result = data?.quoteSummary?.result?.[0] || null;
  if (result) setCache(cacheKey, result, TTL.institutional);
  return result;
}

function parseInstitutionalData(raw: any, ticker: string) {
  if (!raw) return null;

  const price = raw.price || {};
  const summary = raw.summaryDetail || {};
  const majorBreakdown = raw.majorHoldersBreakdown || {};
  const instOwnership = raw.institutionOwnership?.ownershipList || [];
  const fundOwnership = raw.fundOwnership?.ownershipList || [];
  const insiderHolders = raw.insiderHolders?.holders || [];
  const insiderTxns = raw.insiderTransactions?.transactions || [];
  const netActivity = raw.netSharePurchaseActivity || {};

  // Top institutional holders
  const topInstitutions = instOwnership.slice(0, 25).map((inst: any) => ({
    name: inst.organization || "Unknown",
    shares: inst.position?.raw || 0,
    value: inst.value?.raw || 0,
    pctHeld: inst.pctHeld?.raw || 0,
    changeQoQ: inst.pctChange?.raw || 0,
    reportDate: inst.reportDate?.fmt || null,
  }));

  // Top fund holders (mutual funds / ETFs)
  const topFunds = fundOwnership.slice(0, 15).map((fund: any) => ({
    name: fund.organization || "Unknown",
    shares: fund.position?.raw || 0,
    value: fund.value?.raw || 0,
    pctHeld: fund.pctHeld?.raw || 0,
    changeQoQ: fund.pctChange?.raw || 0,
    reportDate: fund.reportDate?.fmt || null,
  }));

  // Insider holders (current positions)
  const insiders = insiderHolders.map((h: any) => ({
    name: h.name || "Unknown",
    relation: h.relation || "Unknown",
    shares: h.positionDirect?.raw || 0,
    sharesIndirect: h.positionIndirect?.raw || 0,
    latestTransaction: h.transactionDescription || null,
    latestDate: h.latestTransDate?.fmt || null,
  }));

  // Insider transactions (recent buys/sells)
  const recentInsiderTxns = insiderTxns.slice(0, 30).map((tx: any) => ({
    insider: tx.filerName || "Unknown",
    relation: tx.filerRelation || "",
    type: tx.transactionText || "Unknown",
    shares: tx.shares?.raw || 0,
    value: tx.value?.raw || 0,
    date: tx.startDate?.fmt || null,
  }));

  // Compute money flow signals
  const insiderBuyCount = netActivity.buyInfoCount?.raw || 0;
  const insiderSellCount = netActivity.sellInfoCount?.raw || 0;
  const insiderBuyShares = netActivity.buyInfoShares?.raw || 0;
  const insiderSellShares = netActivity.sellInfoShares?.raw || 0;
  const netInsiderShares = insiderBuyShares - insiderSellShares;
  const insiderBuyPct = netActivity.buyPercentInsiderShares?.raw || 0;
  const insiderSellPct = netActivity.sellPercentInsiderShares?.raw || 0;

  // Institutional inflow/outflow from QoQ changes
  let instInflow = 0;
  let instOutflow = 0;
  let instIncreased = 0;
  let instDecreased = 0;
  let instNew = 0;
  let instSoldOut = 0;
  for (const inst of instOwnership) {
    const chg = inst.pctChange?.raw || 0;
    if (chg > 50) instNew++;
    else if (chg > 0) instIncreased++;
    if (chg < -90) instSoldOut++;
    else if (chg < 0) instDecreased++;
    if (chg > 0) instInflow += (inst.value?.raw || 0) * (chg / 100);
    if (chg < 0) instOutflow += Math.abs((inst.value?.raw || 0) * (chg / 100));
  }

  // Money Flow Score: -100 (all selling) to +100 (all buying)
  const totalFlow = instInflow + instOutflow;
  const flowScore = totalFlow > 0 ? Math.round(((instInflow - instOutflow) / totalFlow) * 100) : 0;
  const insiderScore = (insiderBuyCount - insiderSellCount);
  const combinedScore = Math.max(-100, Math.min(100, flowScore + insiderScore * 10));

  // Signal
  let signal = "NEUTRAL";
  if (combinedScore >= 40) signal = "STRONG INFLOW";
  else if (combinedScore >= 15) signal = "ACCUMULATING";
  else if (combinedScore <= -40) signal = "STRONG OUTFLOW";
  else if (combinedScore <= -15) signal = "DISTRIBUTING";

  return {
    ticker,
    companyName: price.shortName || price.longName || ticker,
    currentPrice: price.regularMarketPrice?.raw || 0,
    marketCap: price.marketCap?.raw || summary.marketCap?.raw || 0,
    volume: price.regularMarketVolume?.raw || 0,
    avgVolume: summary.averageVolume?.raw || 0,

    // Ownership breakdown
    insiderPct: (majorBreakdown.insidersPercentHeld?.raw || 0) * 100,
    institutionPct: (majorBreakdown.institutionsPercentHeld?.raw || 0) * 100,
    institutionCount: majorBreakdown.institutionsCount?.raw || 0,
    floatPct: (majorBreakdown.institutionsFloatPercentHeld?.raw || 0) * 100,

    // Money flow
    flowScore: combinedScore,
    signal,
    instInflow: Math.round(instInflow),
    instOutflow: Math.round(instOutflow),
    instIncreased,
    instDecreased,
    instNew,
    instSoldOut,

    // Net insider activity (6 months)
    insiderBuyCount,
    insiderSellCount,
    insiderBuyShares,
    insiderSellShares,
    netInsiderShares,
    insiderBuyPct: insiderBuyPct * 100,
    insiderSellPct: insiderSellPct * 100,

    // Detailed lists
    topInstitutions,
    topFunds,
    insiders,
    recentInsiderTxns,
  };
}

// ============================================================
// Types
// ============================================================

interface ScoringCategory {
  name: string;
  score: number;
  weight: number;
  reasoning: string;
}

interface RedFlag {
  label: string;
  flagged: boolean;
  detail: string;
}

interface DecisionQuestion {
  question: string;
  answer: "Yes" | "No" | "N/A";
  color: "green" | "red" | "yellow";
}

function safeNum(val: any): number | null {
  if (val === undefined || val === null || isNaN(val)) return null;
  const n = Number(val);
  // Yahoo sometimes returns raw values as {raw: 123, fmt: "123"}
  if (typeof val === "object" && val.raw !== undefined) return safeNum(val.raw);
  return n;
}

function formatLargeNumber(num: number | null): string {
  if (num === null) return "N/A";
  const abs = Math.abs(num);
  if (abs >= 1e12) return (num / 1e12).toFixed(2) + "T";
  if (abs >= 1e9) return (num / 1e9).toFixed(2) + "B";
  if (abs >= 1e6) return (num / 1e6).toFixed(2) + "M";
  if (abs >= 1e3) return (num / 1e3).toFixed(2) + "K";
  return num.toFixed(2);
}

// Helper to safely extract a raw numeric value from Yahoo's {raw, fmt} format
function raw(val: any): number | null {
  if (val === undefined || val === null) return null;
  if (typeof val === "object" && val.raw !== undefined) return safeNum(val.raw);
  return safeNum(val);
}

function computeScoring(data: any): ScoringCategory[] {
  const { quote, financials, historicalReturns } = data;

  // 1. Income Strength (15%)
  let incomeScore = 5;
  const divYield = safeNum(quote?.dividendYield);
  if (divYield !== null) {
    if (divYield > 4) incomeScore = 9;
    else if (divYield > 2.5) incomeScore = 7;
    else if (divYield > 1) incomeScore = 5;
    else if (divYield > 0) incomeScore = 3;
    else incomeScore = 2;
  } else {
    incomeScore = 2;
  }

  // 2. Income Quality (15%)
  let incomeQualityScore = 5;
  const payoutRatio = safeNum(financials?.payoutRatio);
  if (payoutRatio !== null) {
    if (payoutRatio > 0 && payoutRatio < 50) incomeQualityScore = 9;
    else if (payoutRatio >= 50 && payoutRatio < 75) incomeQualityScore = 7;
    else if (payoutRatio >= 75 && payoutRatio < 100) incomeQualityScore = 5;
    else if (payoutRatio >= 100) incomeQualityScore = 3;
    else incomeQualityScore = 4;
  }

  // 3. Business/Holdings Quality (15%)
  let businessScore = 5;
  const revenueGrowth = safeNum(financials?.revenueGrowth);
  const grossMargin = safeNum(financials?.grossMargin);
  if (revenueGrowth !== null && revenueGrowth > 10) businessScore += 2;
  else if (revenueGrowth !== null && revenueGrowth > 0) businessScore += 1;
  else if (revenueGrowth !== null && revenueGrowth < -5) businessScore -= 2;
  if (grossMargin !== null && grossMargin > 40) businessScore += 2;
  else if (grossMargin !== null && grossMargin > 20) businessScore += 1;
  businessScore = Math.max(1, Math.min(10, businessScore));

  // 4. Balance Sheet/Structure Quality (15%)
  let balanceScore = 5;
  const debtToEquity = safeNum(financials?.debtToEquity);
  const currentRatio = safeNum(financials?.currentRatio);
  if (debtToEquity !== null) {
    if (debtToEquity < 30) balanceScore += 2;
    else if (debtToEquity < 80) balanceScore += 1;
    else if (debtToEquity > 150) balanceScore -= 2;
    else if (debtToEquity > 100) balanceScore -= 1;
  }
  if (currentRatio !== null) {
    if (currentRatio > 2) balanceScore += 1;
    else if (currentRatio < 1) balanceScore -= 1;
  }
  balanceScore = Math.max(1, Math.min(10, balanceScore));

  // 5. Performance Quality (15%)
  let performanceScore = 5;
  const ret1y = historicalReturns?.oneYear;
  const ret3y = historicalReturns?.threeYear;
  if (ret1y !== null && ret1y !== undefined) {
    if (ret1y > 20) performanceScore += 2;
    else if (ret1y > 5) performanceScore += 1;
    else if (ret1y < -10) performanceScore -= 2;
    else if (ret1y < 0) performanceScore -= 1;
  }
  if (ret3y !== null && ret3y !== undefined) {
    if (ret3y > 50) performanceScore += 1;
    else if (ret3y < -10) performanceScore -= 1;
  }
  performanceScore = Math.max(1, Math.min(10, performanceScore));

  // 6. Valuation/Fee Sanity (10%)
  let valuationScore = 5;
  const pe = safeNum(quote?.trailingPE);
  const forwardPe = safeNum(quote?.forwardPE);
  if (pe !== null) {
    if (pe < 0) valuationScore = 3;
    else if (pe < 12) valuationScore = 9;
    else if (pe < 20) valuationScore = 7;
    else if (pe < 30) valuationScore = 5;
    else if (pe < 50) valuationScore = 4;
    else valuationScore = 2;
  }
  if (forwardPe !== null && pe !== null && forwardPe < pe) {
    valuationScore = Math.min(10, valuationScore + 1);
  }

  // 7. Liquidity/Scale (5%)
  let liquidityScore = 5;
  const marketCap = safeNum(quote?.marketCap);
  const avgVolume = safeNum(quote?.averageDailyVolume3Month);
  if (marketCap !== null) {
    if (marketCap > 100e9) liquidityScore += 2;
    else if (marketCap > 10e9) liquidityScore += 1;
    else if (marketCap < 1e9) liquidityScore -= 1;
    else if (marketCap < 300e6) liquidityScore -= 2;
  }
  if (avgVolume !== null) {
    if (avgVolume > 5e6) liquidityScore += 1;
    else if (avgVolume < 100e3) liquidityScore -= 1;
  }
  liquidityScore = Math.max(1, Math.min(10, liquidityScore));

  // 8. Thesis Durability (10%)
  let thesisScore = 5;
  const beta = safeNum(quote?.beta);
  if (beta !== null) {
    if (beta < 0.8) thesisScore += 1;
    else if (beta > 1.5) thesisScore -= 1;
  }
  if (revenueGrowth !== null && revenueGrowth > 5) thesisScore += 1;
  if (debtToEquity !== null && debtToEquity < 50) thesisScore += 1;
  if (divYield !== null && divYield > 2) thesisScore += 1;
  thesisScore = Math.max(1, Math.min(10, thesisScore));

  return [
    { name: "Income Strength", score: incomeScore, weight: 0.15, reasoning: divYield ? `Dividend yield: ${divYield.toFixed(2)}%` : "No dividend" },
    { name: "Income Quality", score: incomeQualityScore, weight: 0.15, reasoning: payoutRatio ? `Payout ratio: ${payoutRatio.toFixed(1)}%` : "No payout data" },
    { name: "Business Quality", score: businessScore, weight: 0.15, reasoning: `Rev growth: ${revenueGrowth?.toFixed(1) ?? "N/A"}%, Gross margin: ${grossMargin?.toFixed(1) ?? "N/A"}%` },
    { name: "Balance Sheet Quality", score: balanceScore, weight: 0.15, reasoning: `D/E: ${debtToEquity?.toFixed(1) ?? "N/A"}%, Current ratio: ${currentRatio?.toFixed(2) ?? "N/A"}` },
    { name: "Performance Quality", score: performanceScore, weight: 0.15, reasoning: `1Y return: ${ret1y?.toFixed(1) ?? "N/A"}%` },
    { name: "Valuation Sanity", score: valuationScore, weight: 0.10, reasoning: `P/E: ${pe?.toFixed(1) ?? "N/A"}, Forward P/E: ${forwardPe?.toFixed(1) ?? "N/A"}` },
    { name: "Liquidity & Scale", score: liquidityScore, weight: 0.05, reasoning: `Market cap: ${formatLargeNumber(marketCap)}` },
    { name: "Thesis Durability", score: thesisScore, weight: 0.10, reasoning: `Beta: ${beta?.toFixed(2) ?? "N/A"}` },
  ];
}

function computeVerdict(weightedScore: number): { verdict: string; ruling: string } {
  if (weightedScore >= 8.5) return { verdict: "STRONG CONVICTION", ruling: "Strong long-term hold — fundamentals, income, and performance all align." };
  if (weightedScore >= 7.0) return { verdict: "INVESTMENT GRADE", ruling: "Solid long-term hold — good fundamentals with some areas to monitor." };
  if (weightedScore >= 5.5) return { verdict: "SPECULATIVE", ruling: "Mixed fundamentals — needs improvement in key areas before committing." };
  return { verdict: "HIGH RISK", ruling: "Significant concerns across multiple categories — not recommended for long-term holding." };
}

function generateBullBear(data: any): { positives: string[]; risks: string[] } {
  const positives: string[] = [];
  const risks: string[] = [];
  const { quote, financials, historicalReturns } = data;

  const pe = safeNum(quote?.trailingPE);
  const divYield = safeNum(quote?.dividendYield);
  const marketCap = safeNum(quote?.marketCap);
  const revenueGrowth = safeNum(financials?.revenueGrowth);
  const grossMargin = safeNum(financials?.grossMargin);
  const debtToEquity = safeNum(financials?.debtToEquity);
  const fcf = safeNum(financials?.freeCashFlow);
  const ret1y = historicalReturns?.oneYear;

  if (revenueGrowth !== null && revenueGrowth > 10) positives.push(`Strong revenue growth at ${revenueGrowth.toFixed(1)}%`);
  if (grossMargin !== null && grossMargin > 40) positives.push(`High gross margins at ${grossMargin.toFixed(1)}%`);
  if (divYield !== null && divYield > 2) positives.push(`Attractive dividend yield of ${divYield.toFixed(2)}%`);
  if (debtToEquity !== null && debtToEquity < 50) positives.push(`Conservative leverage with D/E of ${debtToEquity.toFixed(1)}%`);
  if (fcf !== null && fcf > 0) positives.push(`Positive free cash flow: ${formatLargeNumber(fcf)}`);
  if (marketCap !== null && marketCap > 50e9) positives.push(`Large-cap stability (${formatLargeNumber(marketCap)} market cap)`);
  if (ret1y !== null && ret1y !== undefined && ret1y > 15) positives.push(`Strong 1-year return of ${ret1y.toFixed(1)}%`);
  if (pe !== null && pe > 0 && pe < 20) positives.push(`Reasonable valuation at ${pe.toFixed(1)}x earnings`);

  if (pe !== null && pe > 40) risks.push(`Elevated valuation at ${pe.toFixed(1)}x earnings`);
  if (pe !== null && pe < 0) risks.push(`Negative earnings — currently unprofitable`);
  if (debtToEquity !== null && debtToEquity > 100) risks.push(`High leverage with D/E of ${debtToEquity.toFixed(1)}%`);
  if (revenueGrowth !== null && revenueGrowth < 0) risks.push(`Revenue declining at ${revenueGrowth.toFixed(1)}%`);
  if (divYield === null || divYield === 0) risks.push(`No dividend income`);
  if (ret1y !== null && ret1y !== undefined && ret1y < -10) risks.push(`Poor 1-year return of ${ret1y.toFixed(1)}%`);
  const beta = safeNum(quote?.beta);
  if (beta !== null && beta > 1.5) risks.push(`High volatility with beta of ${beta.toFixed(2)}`);
  if (marketCap !== null && marketCap < 2e9) risks.push(`Small-cap risk (${formatLargeNumber(marketCap)} market cap)`);

  const fallbackPositives = [
    "Established public company with market access",
    "Listed on major exchange with regulatory oversight",
    "Transparent financial reporting and governance",
  ];
  const fallbackRisks = [
    "General market and macroeconomic risk",
    "Sector-specific regulatory or competitive pressures",
    "Interest rate and monetary policy sensitivity",
  ];
  let pIdx = 0;
  while (positives.length < 3 && pIdx < fallbackPositives.length) positives.push(fallbackPositives[pIdx++]);
  let rIdx = 0;
  while (risks.length < 3 && rIdx < fallbackRisks.length) risks.push(fallbackRisks[rIdx++]);

  return { positives: positives.slice(0, 3), risks: risks.slice(0, 3) };
}

function generateRedFlags(data: any): RedFlag[] {
  const { quote, financials } = data;
  const pe = safeNum(quote?.trailingPE);
  const debtToEquity = safeNum(financials?.debtToEquity);
  const payoutRatio = safeNum(financials?.payoutRatio);
  const revenueGrowth = safeNum(financials?.revenueGrowth);
  const currentRatio = safeNum(financials?.currentRatio);
  const marketCap = safeNum(quote?.marketCap);
  const avgVolume = safeNum(quote?.averageDailyVolume3Month);
  const grossMargin = safeNum(financials?.grossMargin);
  const fcf = safeNum(financials?.freeCashFlow);

  return [
    { label: "Negative Earnings", flagged: pe !== null && pe < 0, detail: pe !== null && pe < 0 ? `P/E is negative (${pe.toFixed(1)})` : "Company is profitable" },
    { label: "Excessive Debt", flagged: debtToEquity !== null && debtToEquity > 150, detail: debtToEquity !== null ? `D/E ratio: ${debtToEquity.toFixed(1)}%` : "No debt data" },
    { label: "Dividend Cut Risk", flagged: payoutRatio !== null && payoutRatio > 100, detail: payoutRatio !== null ? `Payout ratio: ${payoutRatio.toFixed(1)}%` : "No payout data" },
    { label: "Revenue Decline", flagged: revenueGrowth !== null && revenueGrowth < -5, detail: revenueGrowth !== null ? `Revenue growth: ${revenueGrowth.toFixed(1)}%` : "No growth data" },
    { label: "Low Liquidity", flagged: avgVolume !== null && avgVolume < 100000, detail: avgVolume !== null ? `Avg volume: ${formatLargeNumber(avgVolume)}` : "No volume data" },
    { label: "Micro-Cap Risk", flagged: marketCap !== null && marketCap < 300e6, detail: marketCap !== null ? `Market cap: ${formatLargeNumber(marketCap)}` : "No market cap data" },
    { label: "Poor Liquidity Ratio", flagged: currentRatio !== null && currentRatio < 1, detail: currentRatio !== null ? `Current ratio: ${currentRatio.toFixed(2)}` : "No data" },
    { label: "Extremely High Valuation", flagged: pe !== null && pe > 60, detail: pe !== null ? `P/E: ${pe.toFixed(1)}` : "No P/E data" },
    { label: "Negative Free Cash Flow", flagged: fcf !== null && fcf < 0, detail: fcf !== null ? `FCF: ${formatLargeNumber(fcf)}` : "No FCF data" },
    { label: "Eroding Margins", flagged: grossMargin !== null && grossMargin < 15, detail: grossMargin !== null ? `Gross margin: ${grossMargin.toFixed(1)}%` : "No margin data" },
  ];
}

function generateDecisionShortcut(data: any): DecisionQuestion[] {
  const { quote, financials, historicalReturns } = data;
  const pe = safeNum(quote?.trailingPE);
  const divYield = safeNum(quote?.dividendYield);
  const debtToEquity = safeNum(financials?.debtToEquity);
  const revenueGrowth = safeNum(financials?.revenueGrowth);
  const ret1y = historicalReturns?.oneYear;
  const marketCap = safeNum(quote?.marketCap);
  const fcf = safeNum(financials?.freeCashFlow);

  return [
    { question: "Is the company profitable?", answer: pe !== null && pe > 0 ? "Yes" : "No", color: pe !== null && pe > 0 ? "green" : "red" },
    { question: "Is revenue growing?", answer: revenueGrowth !== null && revenueGrowth > 0 ? "Yes" : revenueGrowth === null ? "N/A" : "No", color: revenueGrowth !== null && revenueGrowth > 0 ? "green" : revenueGrowth === null ? "yellow" : "red" },
    { question: "Is debt manageable (D/E < 100%)?", answer: debtToEquity !== null && debtToEquity < 100 ? "Yes" : debtToEquity === null ? "N/A" : "No", color: debtToEquity !== null && debtToEquity < 100 ? "green" : debtToEquity === null ? "yellow" : "red" },
    { question: "Does it pay or grow dividends?", answer: divYield !== null && divYield > 0 ? "Yes" : "No", color: divYield !== null && divYield > 0 ? "green" : "red" },
    { question: "Has it outperformed over 1 year?", answer: ret1y != null && ret1y > 0 ? "Yes" : ret1y == null ? "N/A" : "No", color: ret1y != null && ret1y > 0 ? "green" : ret1y == null ? "yellow" : "red" },
    { question: "Is it large-cap (>$10B)?", answer: marketCap !== null && marketCap > 10e9 ? "Yes" : "No", color: marketCap !== null && marketCap > 10e9 ? "green" : "red" },
    { question: "Is free cash flow positive?", answer: fcf !== null && fcf > 0 ? "Yes" : fcf === null ? "N/A" : "No", color: fcf !== null && fcf > 0 ? "green" : fcf === null ? "yellow" : "red" },
  ];
}

// ============================================================
// Extract data from Yahoo's quoteSummary response
// ============================================================

function extractQuoteData(summary: any) {
  const price = summary?.price || {};
  const detail = summary?.summaryDetail || {};
  const keyStats = summary?.defaultKeyStatistics || {};
  const financialData = summary?.financialData || {};
  const profile = summary?.summaryProfile || {};
  const recTrend = summary?.recommendationTrend;

  // Build a normalized quote object
  const quote: any = {
    longName: price.longName || price.shortName || null,
    shortName: price.shortName || null,
    quoteType: price.quoteType || "EQUITY",
    currency: price.currency || "USD",
    regularMarketPrice: raw(price.regularMarketPrice),
    regularMarketChange: raw(price.regularMarketChange),
    regularMarketChangePercent: raw(price.regularMarketChangePercent) !== null ? raw(price.regularMarketChangePercent)! * (Math.abs(raw(price.regularMarketChangePercent)!) < 1 ? 100 : 1) : null,
    marketCap: raw(price.marketCap),
    trailingPE: raw(detail.trailingPE) || raw(keyStats.trailingPE),
    forwardPE: raw(detail.forwardPE) || raw(keyStats.forwardPE),
    epsTrailingTwelveMonths: raw(keyStats.trailingEps),
    dividendYield: raw(detail.dividendYield) !== null ? raw(detail.dividendYield)! * 100 : (raw(detail.trailingAnnualDividendYield) !== null ? raw(detail.trailingAnnualDividendYield)! * 100 : null),
    regularMarketVolume: raw(price.regularMarketVolume),
    averageDailyVolume3Month: raw(price.averageDailyVolume3Month) || raw(detail.averageVolume),
    beta: raw(keyStats.beta),
    fiftyTwoWeekHigh: raw(detail.fiftyTwoWeekHigh),
    fiftyTwoWeekLow: raw(detail.fiftyTwoWeekLow),
    sector: profile.sector || null,
    industry: profile.industry || null,
  };

  // Build financials
  const financials: any = {
    revenueGrowth: raw(financialData.revenueGrowth) !== null ? raw(financialData.revenueGrowth)! * 100 : null,
    grossMargin: raw(financialData.grossMargins) !== null ? raw(financialData.grossMargins)! * 100 : null,
    ebitdaMargin: raw(financialData.ebitdaMargins) !== null ? raw(financialData.ebitdaMargins)! * 100 : null,
    operatingMargin: raw(financialData.operatingMargins) !== null ? raw(financialData.operatingMargins)! * 100 : null,
    profitMargin: raw(financialData.profitMargins) !== null ? raw(financialData.profitMargins)! * 100 : null,
    debtToEquity: raw(financialData.debtToEquity),
    currentRatio: raw(financialData.currentRatio),
    returnOnEquity: raw(financialData.returnOnEquity) !== null ? raw(financialData.returnOnEquity)! * 100 : null,
    freeCashFlow: raw(financialData.freeCashflow),
    operatingCashFlow: raw(financialData.operatingCashflow),
    totalRevenue: raw(financialData.totalRevenue),
    totalDebt: raw(financialData.totalDebt),
    totalCash: raw(financialData.totalCash),
    payoutRatio: raw(keyStats.payoutRatio) !== null ? raw(keyStats.payoutRatio)! * 100 : null,
    earningsGrowth: raw(financialData.earningsGrowth) !== null ? raw(financialData.earningsGrowth)! * 100 : null,
  };

  // Analyst data
  const trend = recTrend?.trend?.[0] || {};
  const analystData = {
    buy: (raw(trend.strongBuy) ?? 0) + (raw(trend.buy) ?? 0),
    hold: raw(trend.hold) ?? 0,
    sell: (raw(trend.sell) ?? 0) + (raw(trend.strongSell) ?? 0),
    targetMean: raw(financialData.targetMeanPrice),
    targetHigh: raw(financialData.targetHighPrice),
    targetLow: raw(financialData.targetLowPrice),
    recommendation: financialData.recommendationKey || null,
  };

  return { quote, financials, analystData, profile };
}

function extractChartData(chartResult: any): { chartData: any[]; computedReturn: number | null } {
  if (!chartResult || !chartResult.timestamp) return { chartData: [], computedReturn: null };

  const timestamps = chartResult.timestamp;
  const closes = chartResult.indicators?.quote?.[0]?.close || [];

  const chartData = timestamps.map((t: number, i: number) => {
    const close = closes[i];
    if (close == null) return null;
    const date = new Date(t * 1000).toISOString().split("T")[0];
    return { date, close: Number(close.toFixed(2)) };
  }).filter(Boolean);

  let computedReturn: number | null = null;
  const validCloses = chartData.filter((d: any) => d.close > 0);
  if (validCloses.length >= 2) {
    const first = validCloses[0].close;
    const last = validCloses[validCloses.length - 1].close;
    computedReturn = ((last - first) / first) * 100;
  }

  return { chartData, computedReturn };
}

// ============================================================
// Routes
// ============================================================

import { registerSearchRoutes } from "./api/routes/search";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // ─── New compartmentalized routes (Phase 1 strangler) ──────────────────
  registerSearchRoutes(app);

  // Warm up Yahoo crumb on startup — API routes wait for this before making Yahoo calls
  let _warmupDone = false;
  const _warmupPromise = (async () => {
    for (let attempt = 1; attempt <= 5; attempt++) {
      await new Promise(r => setTimeout(r, attempt * 2000)); // 2s, 4s, 6s, 8s, 10s
      try {
        await getYahooCrumb();
        console.log("[yahoo] Crumb warmed up — ready to serve requests");
        _warmupDone = true;
        return;
      } catch (e: any) {
        console.log(`[yahoo] Warmup attempt ${attempt}/5 failed: ${e.message}`);
        _crumb = null; _cookie = null; _crumbTimestamp = 0;
      }
    }
    console.log("[yahoo] Warmup failed after 5 attempts — requests will retry on their own");
    _warmupDone = true; // unblock requests even on failure so they can try themselves
  })();

  // Helper: ensure warmup is done before any Yahoo API call
  async function ensureReady() {
    if (!_warmupDone) {
      console.log("[yahoo] Request waiting for warmup to complete...");
      await _warmupPromise;
    }
  }

  // ─── Auth Routes (public) ─────────────────────────────────────────────────
  app.post("/api/auth/register", registerHandler);
  app.post("/api/auth/login", loginHandler);
  app.post("/api/auth/logout", logoutHandler);
  app.post("/api/auth/forgot-password", forgotPasswordHandler);
  app.post("/api/auth/reset-password", resetPasswordHandler);
  app.get("/api/auth/me", requireAuth, meHandler);

  // ─── Protect all other API routes ─────────────────────────────────────────
  app.use("/api", requireAuth);

  // ─── Track demo user activity ──────────────────────────────────────────────
  app.use("/api", (req, _res, next) => {
    touchDemoActivity(req);
    next();
  });

  // ─── Feature Gating ─────────────────────────────────────────────────────────────

  // Daily usage counters: Map<userId, { date: string, scans: number, analysis: number }>
  const dailyUsage = new Map<number, { date: string; scans: number; analysis: number }>();

  function getDailyUsage(userId: number) {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const existing = dailyUsage.get(userId);
    if (!existing || existing.date !== today) {
      const fresh = { date: today, scans: 0, analysis: 0 };
      dailyUsage.set(userId, fresh);
      return fresh;
    }
    return existing;
  }

  /**
   * Feature gating middleware factory.
   * feature: 'mmExposure' | 'scansPerDay' | 'analysisPerDay' | 'tradeLimit'
   */
  function checkFeatureAccess(feature: 'mmExposure' | 'scansPerDay' | 'analysisPerDay' | 'tradeLimit') {
    return async (req: any, res: any, next: NextFunction) => {
      try {
        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ error: 'Not authenticated' });

        const tier = await getUserTier(userId);
        const limits = TIER_LIMITS[tier];

        if (feature === 'mmExposure') {
          if (!limits.mmExposure) {
            return res.status(403).json({
              error: 'Upgrade to Pro to access MM Exposure',
              tier,
              upgradeUrl: '/api/subscription/checkout',
            });
          }
          return next();
        }

        const usage = getDailyUsage(userId);

        if (feature === 'scansPerDay') {
          if (usage.scans >= limits.scansPerDay) {
            return res.status(403).json({
              error: `Daily scan limit reached (${limits.scansPerDay} scans/day on ${tier} plan). Upgrade for more.`,
              tier,
              upgradeUrl: '/api/subscription/checkout',
              limit: limits.scansPerDay,
              used: usage.scans,
            });
          }
          usage.scans++;
          return next();
        }

        if (feature === 'analysisPerDay') {
          if (usage.analysis >= limits.analysisPerDay) {
            return res.status(403).json({
              error: `Daily analysis limit reached (${limits.analysisPerDay} analyses/day on ${tier} plan). Upgrade for more.`,
              tier,
              upgradeUrl: '/api/subscription/checkout',
              limit: limits.analysisPerDay,
              used: usage.analysis,
            });
          }
          usage.analysis++;
          return next();
        }

        if (feature === 'tradeLimit') {
          // For trade limit, check total trade count in DB
          const tradeCount = await storage.getUserTradeCount(userId);
          if (tradeCount >= limits.tradeLimit) {
            return res.status(403).json({
              error: `Trade limit reached (${limits.tradeLimit} trades on ${tier} plan). Upgrade to add more.`,
              tier,
              upgradeUrl: '/api/subscription/checkout',
              limit: limits.tradeLimit,
              used: tradeCount,
            });
          }
          return next();
        }

        next();
      } catch (err: any) {
        console.error('[featureGate] Error:', err.message);
        // On error, allow through to avoid blocking legitimate users
        next();
      }
    };
  }

  // ─── Subscription Routes ───────────────────────────────────────────────────

  // POST /api/subscription/checkout — create Stripe Checkout session
  app.post("/api/subscription/checkout", async (req, res) => {
    try {
      const { tier } = req.body as { tier: 'pro' | 'elite' };
      if (!tier || !['pro', 'elite'].includes(tier)) {
        return res.status(400).json({ error: 'Invalid tier. Must be "pro" or "elite".' });
      }
      const user = (req as any).user;
      const url = await createCheckoutSession(user.id, user.email, tier);
      res.json({ url });
    } catch (err: any) {
      console.error('[subscription] checkout error:', err.message);
      res.status(500).json({ error: err.message || 'Failed to create checkout session' });
    }
  });

  // POST /api/subscription/portal — create Stripe billing portal session
  app.post("/api/subscription/portal", async (req, res) => {
    try {
      const user = (req as any).user;
      const dbUser = await storage.getUser(user.id);
      if (!dbUser?.stripeCustomerId) {
        return res.status(400).json({ error: 'No Stripe customer found. Please subscribe first.' });
      }
      const url = await createPortalSession(dbUser.stripeCustomerId);
      res.json({ url });
    } catch (err: any) {
      console.error('[subscription] portal error:', err.message);
      res.status(500).json({ error: err.message || 'Failed to create portal session' });
    }
  });

  // GET /api/subscription/status — return current tier, expiry, limits
  app.get("/api/subscription/status", async (req, res) => {
    try {
      const user = (req as any).user;
      const dbUser = await storage.getUser(user.id);
      const tier = await getUserTier(user.id);
      const limits = TIER_LIMITS[tier];
      const usage = getDailyUsage(user.id);
      res.json({
        tier,
        subscriptionExpiresAt: dbUser?.subscriptionExpiresAt || null,
        stripeCustomerId: dbUser?.stripeCustomerId || null,
        limits,
        usage: {
          scansUsed: usage.scans,
          scansRemaining: Math.max(0, limits.scansPerDay - usage.scans),
          analysisUsed: usage.analysis,
          analysisRemaining: Math.max(0, limits.analysisPerDay - usage.analysis),
        },
      });
    } catch (err: any) {
      console.error('[subscription] status error:', err.message);
      res.status(500).json({ error: err.message || 'Failed to get subscription status' });
    }
  });

  // ─── Per-user API rate limiter (scan endpoints) ───────────────────────
  const userScanTimestamps = new Map<number, number[]>();
  const MAX_SCANS_PER_MINUTE = 3;

  function checkScanRateLimit(req: any, res: any): boolean {
    const userId = req.user?.id;
    if (!userId) return false;
    const now = Date.now();
    const timestamps = userScanTimestamps.get(userId) || [];
    // Remove entries older than 60 seconds
    const recent = timestamps.filter(t => now - t < 60000);
    if (recent.length >= MAX_SCANS_PER_MINUTE) {
      res.status(429).json({ error: `Rate limited — max ${MAX_SCANS_PER_MINUTE} scans per minute. Results are cached, try again in a moment.` });
      return true;
    }
    recent.push(now);
    userScanTimestamps.set(userId, recent);
    return false;
  }

  // ─── Protected Auth Routes ──────────────────────────────────────────────────
  app.patch("/api/auth/profile", updateProfileHandler);
  app.post("/api/auth/change-password", changePasswordHandler);

  app.post("/api/auth/complete-tour", async (req, res) => {
    try {
      const { users } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      const { db } = await import("./storage");
      await db.update(users).set({ hasSeenTour: true }).where(eq(users.id, req.user!.id));
      res.json({ ok: true });
    } catch { res.status(500).json({ error: "Failed" }); }
  });

  // ─── Admin Routes ───────────────────────────────────────────────────────────
  const ADMIN_EMAILS_LIST = ["awisper@me.com", "christopher.cutshaw@gmail.com", "admin@stockotter.ai"];

  app.get("/api/admin/users", async (req, res) => {
    if (!ADMIN_EMAILS_LIST.includes(req.user!.email)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    try {
      const allUsers = await storage.getAllUsers();
      const usersWithDetails = allUsers.map((u) => {
        const usage = getDailyUsage(u.id);
        const tier = (u.subscriptionTier || "free") as keyof typeof TIER_LIMITS;
        const limits = TIER_LIMITS[tier] || TIER_LIMITS.free;
        return {
          id: u.id,
          email: u.email,
          displayName: u.displayName,
          createdAt: u.createdAt,
          lastLoginAt: u.lastLoginAt || null,
          tier: u.subscriptionTier || "free",
          isAdmin: ADMIN_EMAILS_LIST.includes(u.email),
          stripeCustomerId: u.stripeCustomerId || null,
          subscriptionExpiresAt: u.subscriptionExpiresAt || null,
          usage: {
            scansUsed: usage.scans,
            scansLimit: limits.scansPerDay,
            analysisUsed: usage.analysis,
            analysisLimit: limits.analysisPerDay,
          },
        };
      });
      res.json(usersWithDetails);
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Failed to fetch users" });
    }
  });

  app.delete("/api/admin/users/:id", async (req, res) => {
    if (!ADMIN_EMAILS_LIST.includes(req.user!.email)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    try {
      const userId = parseInt(req.params.id);
      if (userId === req.user!.id) {
        return res.status(400).json({ error: "Cannot delete your own account" });
      }
      await storage.deleteUser(userId);
      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Failed to delete user" });
    }
  });

  // Admin: update user subscription tier
  app.patch("/api/admin/users/:id/tier", async (req, res) => {
    if (!ADMIN_EMAILS_LIST.includes(req.user!.email)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    try {
      const userId = parseInt(req.params.id);
      const { tier } = req.body;
      if (!["free", "pro", "elite"].includes(tier)) {
        return res.status(400).json({ error: "Invalid tier. Must be free, pro, or elite" });
      }
      await storage.updateUserSubscription(userId, { subscriptionTier: tier });
      res.json({ ok: true, userId, tier });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Failed to update tier" });
    }
  });

  // Admin: system stats (KPIs, cache, queue health)
  app.get("/api/admin/stats", async (req, res) => {
    if (!ADMIN_EMAILS_LIST.includes(req.user!.email)) return res.status(403).json({ error: "Admin only" });
    try {
      const allUsers = await storage.getAllUsers();
      const tiers = { free: 0, pro: 0, elite: 0 };
      let activeToday = 0;
      let activeThisWeek = 0;
      const now = Date.now();
      for (const u of allUsers) {
        const t = (u.subscriptionTier || "free") as keyof typeof tiers;
        if (t in tiers) tiers[t]++;
        if (u.lastLoginAt) {
          const loginMs = new Date(u.lastLoginAt).getTime();
          if (now - loginMs < 24 * 60 * 60 * 1000) activeToday++;
          if (now - loginMs < 7 * 24 * 60 * 60 * 1000) activeThisWeek++;
        }
      }

      const cacheStats = getCacheStats();
      const queueStats = getQueueStats();

      // Uptime
      const uptimeSeconds = process.uptime();
      const uptimeHours = Math.floor(uptimeSeconds / 3600);
      const uptimeMins = Math.floor((uptimeSeconds % 3600) / 60);

      // Memory
      const mem = process.memoryUsage();

      res.json({
        users: { total: allUsers.length, ...tiers, activeToday, activeThisWeek },
        system: {
          uptime: `${uptimeHours}h ${uptimeMins}m`,
          uptimeSeconds,
          memoryMB: Math.round(mem.heapUsed / 1024 / 1024),
          memoryMaxMB: Math.round(mem.heapTotal / 1024 / 1024),
          nodeVersion: process.version,
        },
        cache: { size: cacheStats.size, keys: cacheStats.keys.length },
        queue: queueStats,
      });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Failed to fetch stats" });
    }
  });

  app.get("/api/admin/cache", async (req, res) => {
    if (!ADMIN_EMAILS_LIST.includes(req.user!.email)) return res.status(403).json({ error: "Admin only" });
    if (req.query.clear === "true") { clearCache(); return res.json({ cleared: true }); }
    res.json({ ...getCacheStats(), queue: getQueueStats() });
  });

  // ─── Dividend Routes (BEFORE parameterized routes) ──────────────────────

  function extractDividendData(ticker: string, quote: any) {
    const sd = quote?.summaryDetail || {};
    const pr = quote?.price || {};
    const ks = quote?.defaultKeyStatistics || {};
    const fd = quote?.financialData || {};
    const ce = quote?.calendarEvents || {};

    const dividendYield = sd.dividendYield?.raw != null ? Number((sd.dividendYield.raw * 100).toFixed(2)) : 0;
    const dividendRate = sd.dividendRate?.raw ?? 0;
    const payoutRatio = sd.payoutRatio?.raw != null ? Number((sd.payoutRatio.raw * 100).toFixed(2)) : 0;
    const trailingYield = sd.trailingAnnualDividendYield?.raw != null ? Number((sd.trailingAnnualDividendYield.raw * 100).toFixed(2)) : 0;
    const fiveYearAvgYield = sd.fiveYearAvgDividendYield?.raw ?? null;
    const lastDividendValue = ks.lastDividendValue?.raw ?? null;
    const lastDividendDate = ks.lastDividendDate?.fmt ?? null;
    const exDividendDate = ce.exDividendDate?.fmt ?? sd.exDividendDate?.fmt ?? null;
    const dividendDate = ce.dividendDate?.fmt ?? sd.exDividendDate?.fmt ?? null; // next payment date
    const price = pr.regularMarketPrice?.raw ?? fd.currentPrice?.raw ?? 0;
    const companyName = pr.shortName ?? ticker;

    // Estimate frequency
    let frequency = "Quarterly";
    if (lastDividendValue && lastDividendValue > 0 && dividendRate > 0) {
      const ratio = dividendRate / lastDividendValue;
      if (ratio >= 10) frequency = "Monthly";
      else if (ratio >= 3) frequency = "Quarterly";
      else if (ratio >= 1.5) frequency = "Semi-Annual";
      else frequency = "Annual";
    }

    // Score calculation (0-100)
    let score = 0;
    // Yield scoring (max 25)
    if (dividendYield > 5) score += 25;
    else if (dividendYield > 3) score += 20;
    else if (dividendYield > 2) score += 15;
    else if (dividendYield > 1) score += 10;

    // Payout ratio — REITs and MLPs often have 80%+, that's normal for them (max 20)
    if (payoutRatio > 0 && payoutRatio <= 80) score += 20;
    else if (payoutRatio > 80 && payoutRatio <= 100) score += 15;
    else if (payoutRatio > 100) score += 5;
    else if (payoutRatio === 0) score += 10; // no data — give benefit of doubt

    // Current yield vs 5-year average — paying above average is bullish (max 15)
    if (fiveYearAvgYield != null && dividendYield > fiveYearAvgYield) score += 15;
    else if (fiveYearAvgYield != null) score += 5; // at least has a 5-year track record

    // Active dividend (max 10)
    if (dividendRate > 0) score += 10;

    // Frequency bonus (max 15)
    if (frequency === "Monthly") score += 15;
    else if (frequency === "Quarterly") score += 15;
    else if (frequency === "Semi-Annual") score += 10;
    else if (frequency === "Annual") score += 5;

    // Yield above 3% bonus (max 5) — rewards solid income stocks
    if (dividendYield >= 3 && payoutRatio > 0 && payoutRatio < 100) score += 5;
    // Extra bump for high yield + sustainable (max 5)
    if (dividendYield >= 4 && payoutRatio > 0 && payoutRatio <= 80) score += 5;

    return {
      ticker,
      companyName,
      price: Number(price.toFixed(2)),
      dividendYield,
      dividendRate: Number(dividendRate.toFixed(2)),
      exDividendDate,
      distributionDate: dividendDate,  // when you get paid
      payoutRatio,
      trailingYield,
      fiveYearAvgYield: fiveYearAvgYield != null ? Number(fiveYearAvgYield.toFixed(2)) : null,
      lastDividendValue: lastDividendValue != null ? Number(lastDividendValue.toFixed(4)) : null,
      lastDividendDate,
      frequency,
      annualDividend: Number(dividendRate.toFixed(2)),
      dividendGrowth: null as number | null,
      score,
    };
  }

  app.get("/api/dividends/scan", checkFeatureAccess('scansPerDay'), async (req, res) => {
    if (checkScanRateLimit(req, res)) return;
    try {
      await ensureReady();

      const refresh = req.query.refresh === "1" || req.query.refresh === "true";

      // Parse filter params early so cache key reflects them
      const minYield = parseFloat(req.query.minYield as string) || 0;
      const freqFilter = (req.query.frequency as string) || "All";
      const maxPayout = parseFloat(req.query.maxPayout as string) || 100;
      const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 30, 1), 500);

      const tickersParam = req.query.tickers as string | undefined;
      const customTickers = tickersParam
        ? tickersParam.split(",").map(t => t.trim().toUpperCase()).filter(Boolean)
        : null;

      // Resolve universe: custom tickers OR full Polygon universe (cached 24h)
      const UNIVERSE_TTL = 24 * 60 * 60 * 1000;
      const universeCacheKey = "polygon:universe:500m";
      let tickers: string[];
      if (customTickers && customTickers.length) {
        tickers = [...new Set(customTickers)].slice(0, 500);
      } else {
        const cachedUniverse = getCached(universeCacheKey);
        if (cachedUniverse && !refresh) {
          tickers = cachedUniverse;
        } else {
          console.log("[dividends-scan] Fetching Polygon universe...");
          tickers = await getPolygonUniverse({ minMarketCap: 500_000_000 });
          setCache(universeCacheKey, tickers, UNIVERSE_TTL);
        }
      }

      // Aggregated result cache (6h) — key on filters too since they can change output
      const SCAN_CACHE_TTL = 6 * 60 * 60 * 1000;
      const scanCacheKey = customTickers
        ? `dividends-scan:custom:${customTickers.slice().sort().join(",")}:${minYield}:${freqFilter}:${maxPayout}:${limit}`
        : `dividends-scan:universe:500m:${minYield}:${freqFilter}:${maxPayout}:${limit}`;

      if (!refresh) {
        const cached = getCached(scanCacheKey);
        if (cached) {
          res.setHeader("X-Scanned-At", cached.scannedAt);
          res.setHeader("X-Total-Scanned", String(cached.totalScanned));
          res.setHeader("X-Dividend-Payers", String(cached.dividendPayers));
          res.setHeader("X-Matching-Filters", String(cached.matchingFilters));
          res.setHeader("X-Cached", "true");
          return res.json(cached.results);
        }
      }

      console.log(`[dividends-scan] Scanning ${tickers.length} tickers (refresh=${refresh})`);
      const scanStart = Date.now();
      const results: any[] = [];

      // Polygon Starter has no per-second cap; parallelize in batches of 20
      const BATCH_SIZE = 20;
      for (let b = 0; b < tickers.length; b += BATCH_SIZE) {
        const batch = tickers.slice(b, b + BATCH_SIZE);
        const batchResults = await Promise.allSettled(batch.map(async (ticker) => {
          try {
            const quote = await getQuoteLight(ticker);
            if (!quote) return null;
            const d = extractDividendData(ticker, quote);
            // Skip tickers with no dividend at all
            if (!d || (d.dividendYield === 0 && d.dividendRate === 0)) return null;
            return d;
          } catch {
            return null;
          }
        }));
        for (const r of batchResults) {
          if (r.status === "fulfilled" && r.value) results.push(r.value);
        }
        // Progress every 10 batches (=200 tickers)
        if ((b / BATCH_SIZE) % 10 === 0) {
          console.log(`[dividends-scan] Progress: ${Math.min(b + BATCH_SIZE, tickers.length)}/${tickers.length} (${results.length} dividend payers)`);
        }
      }

      // Apply filters
      let filtered = results;
      if (minYield > 0) filtered = filtered.filter(d => d.dividendYield >= minYield);
      if (freqFilter !== "All") filtered = filtered.filter(d => d.frequency === freqFilter);
      if (maxPayout < 100) filtered = filtered.filter(d => d.payoutRatio <= maxPayout || d.payoutRatio === 0);

      filtered.sort((a, b) => b.score - a.score);
      filtered = filtered.slice(0, limit);

      const elapsed = Date.now() - scanStart;
      console.log(`[dividends-scan] Complete: ${filtered.length}/${results.length} after filters in ${elapsed}ms`);

      const payload = {
        scannedAt: new Date().toISOString(),
        lastScannedAt: new Date().toISOString(),
        totalScanned: tickers.length,
        dividendPayers: results.length,
        matchingFilters: filtered.length,
        elapsedMs: elapsed,
        cacheTtlMinutes: SCAN_CACHE_TTL / 60000,
        results: filtered,
      };
      setCache(scanCacheKey, payload, SCAN_CACHE_TTL);
      // UI expects a bare array — expose metadata via headers instead
      res.setHeader("X-Scanned-At", payload.scannedAt);
      res.setHeader("X-Total-Scanned", String(payload.totalScanned));
      res.setHeader("X-Dividend-Payers", String(payload.dividendPayers));
      res.setHeader("X-Matching-Filters", String(payload.matchingFilters));
      res.setHeader("X-Cached", "false");
      res.json(filtered);
    } catch (error: any) {
      console.error("[dividends-scan] Error:", error);
      res.status(500).json({ error: error?.message || "Failed to scan dividends" });
    }
  });

  // ─── Weekly Dividend Strategy (Bowtie Nation-inspired) ──────────────────

  app.get("/api/dividends/weekly-strategy", async (req, res) => {
    try {
      // Static strategy data — no Yahoo calls unless ?refresh=true
      // All picks target dividend score 70+ (3%+ yield, sustainable payout, consistent growth)
      const weeklyPlan = [
        // ── Q1 Schedule: Jan, Apr, Jul, Oct ──
        { ticker: "XOM", week: 1, months: "Jan/Apr/Jul/Oct", role: "Week 1 Quarterly", note: "Oil supermajor, 3.4% yield, 40+ years of increases, massive cash flow" },
        { ticker: "EOG", week: 2, months: "Jan/Apr/Jul/Oct", role: "Week 2 Quarterly", note: "Natural gas leader, 3.4% yield, 20% annual dividend growth" },
        { ticker: "ABBV", week: 3, months: "Jan/Apr/Jul/Oct", role: "Week 3 Quarterly", note: "Pharma powerhouse, 3.5% yield, 50+ year dividend streak" },
        { ticker: "T", week: 4, months: "Jan/Apr/Jul/Oct", role: "Week 4 Quarterly", note: "Telecom giant, 4%+ yield, stabilized after restructuring" },
        // ── Q2 Schedule: Feb, May, Aug, Nov ──
        { ticker: "KMI", week: 1, months: "Feb/May/Aug/Nov", role: "Week 1 Quarterly", note: "Pipeline giant, 4% yield, 80K miles of infrastructure" },
        { ticker: "DUK", week: 2, months: "Feb/May/Aug/Nov", role: "Week 2 Quarterly", note: "Utility stable income, 3.5% yield, 9M+ customers" },
        { ticker: "VZ", week: 3, months: "Feb/May/Aug/Nov", role: "Week 3 Quarterly", note: "Telecom, 5.5%+ yield, 19 consecutive years of increases" },
        { ticker: "PFE", week: 4, months: "Feb/May/Aug/Nov", role: "Week 4 Quarterly", note: "Pharma giant, 6%+ yield, massive pipeline" },
        // ── Q3 Schedule: Mar, Jun, Sep, Dec ──
        { ticker: "CVX", week: 1, months: "Mar/Jun/Sep/Dec", role: "Week 1 Quarterly", note: "Energy, 3.9% yield, Very Safe payout, 37 years of increases" },
        { ticker: "OKE", week: 2, months: "Mar/Jun/Sep/Dec", role: "Week 2 Quarterly", note: "Pipeline, 4.3% yield, 26 years of increases, 90K miles of infrastructure" },
        { ticker: "MO", week: 3, months: "Mar/Jun/Sep/Dec", role: "Week 3 Quarterly", note: "Highest yield in group, 7%+ yield, 50+ year payer" },
        { ticker: "KMB", week: 4, months: "Mar/Jun/Sep/Dec", role: "Week 4 Quarterly", note: "Consumer staples, 4.9% yield, Kleenex/Huggies, 52 year streak" },
        // ── Monthly Payers (double up every week) ──
        { ticker: "O", week: 0, months: "Monthly", role: "Monthly Payer", note: "The Monthly Dividend Company. REIT, 5%+ yield, Dividend Aristocrat" },
        { ticker: "JEPI", week: 0, months: "Monthly", role: "Monthly Payer", note: "JP Morgan covered call ETF, ~8% yield, lower volatility" },
        { ticker: "MAIN", week: 0, months: "Monthly", role: "Monthly Payer", note: "BDC king, ~6% yield + special dividends, internally managed" },
        { ticker: "EPD", week: 0, months: "Monthly", role: "Monthly Payer", note: "MLP pipeline, 6.4% yield, 25 consecutive years of increases" },
      ];

      const refreshPrices = req.query.refresh === "true";

      if (refreshPrices) {
        // Enrich with live Yahoo data (only when explicitly requested)
        await ensureReady();
        const results = [];
        for (const item of weeklyPlan) {
          try {
            const quote = await getQuoteLight(item.ticker);
            const divData = quote ? extractDividendData(item.ticker, quote) : null;
            results.push({
              ...item,
              companyName: divData?.companyName || item.ticker,
              price: divData?.price || 0,
              dividendYield: divData?.dividendYield || 0,
              dividendRate: divData?.dividendRate || 0,
              annualDividend: divData?.annualDividend || 0,
              exDividendDate: divData?.exDividendDate || null,
              distributionDate: divData?.distributionDate || null,
              frequency: divData?.frequency || (item.months === "Monthly" ? "Monthly" : "Quarterly"),
              payoutRatio: divData?.payoutRatio || 0,
              score: divData?.score || 0,
            });
          } catch (err: any) {
            results.push({ ...item, companyName: item.ticker, price: 0, dividendYield: 0, dividendRate: 0, annualDividend: 0, exDividendDate: null, distributionDate: null, frequency: item.months === "Monthly" ? "Monthly" : "Quarterly", payoutRatio: 0, score: 0 });
          }
        }
        const totalYield = results.reduce((s, r) => s + r.dividendYield, 0) / results.length;
        res.json({
          strategy: "Weekly Dividend Calendar",
          description: "12 quarterly payers staggered across weeks + 4 monthly payers = dividends every single week. All picks target 70+ dividend quality score. Buy equal dollar amounts of each.",
          weeklyPlan: results,
          refreshed: true,
          stats: { totalStocks: results.length, quarterlyPayers: results.filter(r => r.months !== "Monthly").length, monthlyPayers: results.filter(r => r.months === "Monthly").length, avgYield: Number(totalYield.toFixed(2)), avgScore: Math.round(results.reduce((s, r) => s + r.score, 0) / results.length) },
        });
      } else {
        // Static response — no Yahoo calls, instant load
        res.json({
          strategy: "Weekly Dividend Calendar",
          description: "12 quarterly payers staggered across weeks + 4 monthly payers = dividends every single week. All picks target 70+ dividend quality score. Buy equal dollar amounts of each.",
          weeklyPlan: weeklyPlan.map(item => ({
            ...item,
            companyName: item.ticker,
            price: 0,
            dividendYield: 0,
            dividendRate: 0,
            annualDividend: 0,
            exDividendDate: null,
            distributionDate: null,
            frequency: item.months === "Monthly" ? "Monthly" : "Quarterly",
            payoutRatio: 0,
            score: 0,
          })),
          refreshed: false,
          stats: { totalStocks: weeklyPlan.length, quarterlyPayers: weeklyPlan.filter(r => r.months !== "Monthly").length, monthlyPayers: weeklyPlan.filter(r => r.months === "Monthly").length, avgYield: 0, avgScore: 0 },
        });
      }
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Failed to build weekly strategy" });
    }
  });

  // ─── Dividend Portfolio (auto from open LONG trades) ──────────────────────

  app.get("/api/dividend-portfolio", async (req, res) => {
    try {
      // Get all open LONG stock trades — these are the positions that could pay dividends
      const allTrades = await storage.getAllTrades(req.user!.id);
      const openLongs = allTrades.filter(t => !t.closeDate && t.tradeType === "LONG");

      if (openLongs.length === 0) return res.json([]);

      // Group by symbol (user might have multiple LONG entries for same stock)
      const grouped: Record<string, { shares: number; totalCost: number; tradeIds: number[]; tradeDate: string }> = {};
      for (const t of openLongs) {
        if (!grouped[t.symbol]) {
          grouped[t.symbol] = { shares: 0, totalCost: 0, tradeIds: [], tradeDate: t.tradeDate };
        }
        grouped[t.symbol].shares += t.contractsShares;
        grouped[t.symbol].totalCost += Math.abs(t.openPrice) * t.contractsShares;
        grouped[t.symbol].tradeIds.push(t.id);
        // Keep earliest trade date
        if (t.tradeDate < grouped[t.symbol].tradeDate) grouped[t.symbol].tradeDate = t.tradeDate;
      }

      await ensureReady();
      const results = [];

      for (const [symbol, pos] of Object.entries(grouped)) {
        const avgCost = pos.totalCost / pos.shares;
        try {
          const quote = await getQuoteLight(symbol);
          const divData = quote ? extractDividendData(symbol, quote) : null;

          // Only include if the stock actually pays a dividend
          if (!divData || divData.dividendRate <= 0) continue;

          results.push({
            symbol,
            companyName: divData.companyName,
            shares: pos.shares,
            avgCost: Number(avgCost.toFixed(2)),
            tradeDate: pos.tradeDate,
            tradeIds: pos.tradeIds,
            // Live dividend data
            currentPrice: divData.price,
            dividendYield: divData.dividendYield,
            dividendRate: divData.dividendRate,
            exDividendDate: divData.exDividendDate,
            distributionDate: divData.distributionDate,
            frequency: divData.frequency,
            payoutRatio: divData.payoutRatio,
            fiveYearAvgYield: divData.fiveYearAvgYield,
            lastDividendValue: divData.lastDividendValue,
            lastDividendDate: divData.lastDividendDate,
            annualDividend: divData.annualDividend,
            score: divData.score,
            // Calculated
            marketValue: divData.price * pos.shares,
            costBasis: pos.totalCost,
            unrealizedPL: (divData.price - avgCost) * pos.shares,
            annualIncome: divData.dividendRate * pos.shares,
            yieldOnCost: avgCost > 0 ? (divData.dividendRate / avgCost) * 100 : 0,
          });
        } catch (err: any) {
          console.log(`[div-portfolio] Failed to check ${symbol}: ${err.message}`);
        }
      }

      // Sort by annual income descending
      results.sort((a, b) => b.annualIncome - a.annualIncome);
      res.json(results);
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Failed to build dividend portfolio" });
    }
  });

  // ─── Market Maker Exposure ─────────────────────────────────────────────────

  async function getOptionsChain(ticker: string, expDate?: number): Promise<any> {
    const cacheKey = `options:${ticker.toUpperCase()}:${expDate || 'default'}`;
    const cached = getCached(cacheKey);
    if (cached) { recordCacheHit(); return cached; }
    // Primary: Polygon Options Starter. Returns a Yahoo-shaped optionChain.result[0] object.
    const result = await getPolygonOptionsChain(ticker, expDate);
    if (result) setCache(cacheKey, result, TTL.options);
    return result;
  }

  // Black-Scholes gamma calculation
  function bsGamma(S: number, K: number, T: number, r: number, sigma: number): number {
    if (T <= 0 || sigma <= 0 || S <= 0) return 0;
    const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
    const pdf = Math.exp(-0.5 * d1 * d1) / Math.sqrt(2 * Math.PI);
    return pdf / (S * sigma * Math.sqrt(T));
  }

  app.get("/api/mm-exposure/:ticker", checkFeatureAccess('mmExposure'), async (req, res) => {
    const ticker = req.params.ticker.toUpperCase();
    try {
      await ensureReady();

      // Get first page (default expiry + list of all expirations)
      const firstPage = await getOptionsChain(ticker);
      if (!firstPage || !firstPage.options?.length) {
        return res.status(404).json({ error: `No options data for ${ticker}` });
      }

      const spot = firstPage.quote?.regularMarketPrice || 0;
      if (!spot) return res.status(404).json({ error: `No price data for ${ticker}` });

      const companyName = firstPage.quote?.shortName || firstPage.quote?.longName || ticker;
      const expirationDates: number[] = firstPage.expirationDates || [];

      // Fetch up to 4 nearest expirations for GEX calculation
      const maxExpiries = Math.min(4, expirationDates.length);
      const allCalls: any[] = [];
      const allPuts: any[] = [];

      // First page already has the nearest expiration
      const firstOpts = firstPage.options[0];
      if (firstOpts.calls) allCalls.push(...firstOpts.calls.map((c: any) => ({ ...c, expDate: expirationDates[0] })));
      if (firstOpts.puts) allPuts.push(...firstOpts.puts.map((p: any) => ({ ...p, expDate: expirationDates[0] })));

      // Fetch additional expirations
      for (let i = 1; i < maxExpiries; i++) {
        try {
          const page = await getOptionsChain(ticker, expirationDates[i]);
          if (page?.options?.[0]) {
            if (page.options[0].calls) allCalls.push(...page.options[0].calls.map((c: any) => ({ ...c, expDate: expirationDates[i] })));
            if (page.options[0].puts) allPuts.push(...page.options[0].puts.map((p: any) => ({ ...p, expDate: expirationDates[i] })));
          }
        } catch { /* skip failed expiration fetches */ }
      }

      const now = Date.now() / 1000;
      const r = 0.05; // risk-free rate approximation

      // ── GEX by strike ──
      // Strike range: focus on +/- 15% from spot
      const lowerBound = spot * 0.85;
      const upperBound = spot * 1.15;

      interface StrikeData {
        strike: number;
        callOI: number;
        putOI: number;
        callVolume: number;
        putVolume: number;
        callGEX: number;
        putGEX: number;
        netGEX: number;
        callIV: number;
        putIV: number;
      }

      const strikeMap: Record<number, StrikeData> = {};

      function getOrCreate(strike: number): StrikeData {
        if (!strikeMap[strike]) {
          strikeMap[strike] = { strike, callOI: 0, putOI: 0, callVolume: 0, putVolume: 0, callGEX: 0, putGEX: 0, netGEX: 0, callIV: 0, putIV: 0 };
        }
        return strikeMap[strike];
      }

      // Process calls
      for (const c of allCalls) {
        const K = c.strike;
        if (K < lowerBound || K > upperBound) continue;
        const oi = c.openInterest || 0;
        const vol = c.volume || 0;
        const iv = c.impliedVolatility || 0;
        const T = Math.max((c.expDate - now) / (365.25 * 24 * 3600), 1 / 365); // years to expiry
        const gamma = bsGamma(spot, K, T, r, iv);
        // GEX = gamma * OI * 100 * spot^2 * 0.01  ($ per 1% move)
        const gex = gamma * oi * 100 * spot * spot * 0.01;
        const sd = getOrCreate(K);
        sd.callOI += oi;
        sd.callVolume += vol;
        sd.callGEX += gex;
        if (iv > sd.callIV) sd.callIV = iv;
      }

      // Process puts (dealers assumed short puts → multiply by -1)
      for (const p of allPuts) {
        const K = p.strike;
        if (K < lowerBound || K > upperBound) continue;
        const oi = p.openInterest || 0;
        const vol = p.volume || 0;
        const iv = p.impliedVolatility || 0;
        const T = Math.max((p.expDate - now) / (365.25 * 24 * 3600), 1 / 365);
        const gamma = bsGamma(spot, K, T, r, iv);
        const gex = gamma * oi * 100 * spot * spot * 0.01 * -1; // negative for puts
        const sd = getOrCreate(K);
        sd.putOI += oi;
        sd.putVolume += vol;
        sd.putGEX += gex;
        if (iv > sd.putIV) sd.putIV = iv;
      }

      // Compute netGEX and build sorted array
      const strikes = Object.values(strikeMap)
        .map(s => { s.netGEX = s.callGEX + s.putGEX; return s; })
        .sort((a, b) => a.strike - b.strike);

      // ── Key Levels ──
      const totalGEX = strikes.reduce((s, d) => s + d.netGEX, 0);

      // Call Wall = strike with highest call OI ABOVE current price (resistance)
      // Put Wall = strike with highest put OI BELOW current price (support)
      // Filter: must be at least 2% away from spot to be meaningful
      const minDistancePct = 0.02; // 2% minimum distance from spot
      const callCandidates = strikes.filter(s => s.strike > spot * (1 + minDistancePct) && s.callOI > 0);
      const putCandidates = strikes.filter(s => s.strike < spot * (1 - minDistancePct) && s.putOI > 0);

      const callWall = callCandidates.length > 0
        ? callCandidates.reduce((max, s) => s.callOI > max.callOI ? s : max, callCandidates[0])
        : null;
      const putWall = putCandidates.length > 0
        ? putCandidates.reduce((max, s) => s.putOI > max.putOI ? s : max, putCandidates[0])
        : null;

      // Gamma Flip = where netGEX crosses zero
      let gammaFlip: number | null = null;
      for (let i = 0; i < strikes.length - 1; i++) {
        if ((strikes[i].netGEX <= 0 && strikes[i + 1].netGEX > 0) ||
            (strikes[i].netGEX >= 0 && strikes[i + 1].netGEX < 0)) {
          // Linear interpolation
          const s1 = strikes[i].strike, g1 = strikes[i].netGEX;
          const s2 = strikes[i + 1].strike, g2 = strikes[i + 1].netGEX;
          gammaFlip = s1 + (0 - g1) * (s2 - s1) / (g2 - g1);
          break;
        }
      }

      // Max Pain = strike where total $ value of expired options is minimized
      // (price where most options expire worthless)
      let maxPainStrike = spot;
      let minPain = Infinity;
      for (const s of strikes) {
        let pain = 0;
        // For each strike, calc total intrinsic value of all options if underlying = this strike
        for (const other of strikes) {
          // Call pain: max(0, strike_s - other_call_strike) * callOI
          if (s.strike > other.strike) pain += (s.strike - other.strike) * other.callOI * 100;
          // Put pain: max(0, other_put_strike - strike_s) * putOI
          if (other.strike > s.strike) pain += (other.strike - s.strike) * other.putOI * 100;
        }
        if (pain < minPain) { minPain = pain; maxPainStrike = s.strike; }
      }

      // ── Put/Call Ratio ──
      const totalCallOI = strikes.reduce((s, d) => s + d.callOI, 0);
      const totalPutOI = strikes.reduce((s, d) => s + d.putOI, 0);
      const totalCallVol = strikes.reduce((s, d) => s + d.callVolume, 0);
      const totalPutVol = strikes.reduce((s, d) => s + d.putVolume, 0);
      const pcRatioOI = totalCallOI > 0 ? totalPutOI / totalCallOI : 0;
      const pcRatioVol = totalCallVol > 0 ? totalPutVol / totalCallVol : 0;

      // ── Unusual Activity (high volume/OI ratio) ──
      const unusual: any[] = [];
      for (const c of allCalls) {
        const K = c.strike;
        if (K < lowerBound || K > upperBound) continue;
        const oi = c.openInterest || 0;
        const vol = c.volume || 0;
        if (oi > 100 && vol > 100 && vol / oi > 2.0) {
          unusual.push({
            type: "CALL", strike: K, volume: vol, openInterest: oi,
            ratio: Number((vol / oi).toFixed(1)),
            iv: Number(((c.impliedVolatility || 0) * 100).toFixed(1)),
            expiry: new Date(c.expDate * 1000).toISOString().split("T")[0],
            bid: c.bid || 0, ask: c.ask || 0,
          });
        }
      }
      for (const p of allPuts) {
        const K = p.strike;
        if (K < lowerBound || K > upperBound) continue;
        const oi = p.openInterest || 0;
        const vol = p.volume || 0;
        if (oi > 100 && vol > 100 && vol / oi > 2.0) {
          unusual.push({
            type: "PUT", strike: K, volume: vol, openInterest: oi,
            ratio: Number((vol / oi).toFixed(1)),
            iv: Number(((p.impliedVolatility || 0) * 100).toFixed(1)),
            expiry: new Date(p.expDate * 1000).toISOString().split("T")[0],
            bid: p.bid || 0, ask: p.ask || 0,
          });
        }
      }
      unusual.sort((a, b) => b.ratio - a.ratio);

      // ── Regime Detection ──
      const isPositiveGamma = totalGEX > 0;
      const regime = isPositiveGamma ? "POSITIVE_GAMMA" : "NEGATIVE_GAMMA";
      const regimeLabel = isPositiveGamma ? "Dealer Long Gamma (Dampening)" : "Dealer Short Gamma (Amplifying)";
      const regimeDesc = isPositiveGamma
        ? "Market makers are hedged — they BUY dips and SELL rallies. Expect mean-reversion, tighter ranges, and pinning near high-GEX strikes. Sell premium strategies work well here."
        : "Market makers are exposed — they SELL into dips and BUY into rallies, amplifying moves. Expect breakouts, wider ranges, and trend-following behavior. Directional plays and bought options can outperform.";

      // ── Where to Hide (trade ideas based on MM positioning) ──
      const spotVsFlip = gammaFlip ? (spot > gammaFlip ? "above" : "below") : null;
      const spotVsMaxPain = spot > maxPainStrike ? "above" : spot < maxPainStrike ? "below" : "at";

      const tradeIdeas: { strategy: string; reasoning: string; level: string; sentiment: string }[] = [];

      // PCS near put wall (support)
      if (putWall) {
        tradeIdeas.push({
          strategy: `Put Credit Spread near $${putWall.strike.toFixed(0)}`,
          reasoning: `Put wall at $${putWall.strike.toFixed(0)} — massive put OI (${putWall.putOI.toLocaleString()}) creates dealer buying pressure here. MMs defend this level.`,
          level: `$${putWall.strike.toFixed(0)}`,
          sentiment: "Bullish",
        });
      }

      // CCS near call wall (resistance)
      if (callWall) {
        tradeIdeas.push({
          strategy: `Call Credit Spread near $${callWall.strike.toFixed(0)}`,
          reasoning: `Call wall at $${callWall.strike.toFixed(0)} — highest call OI (${callWall.callOI.toLocaleString()}) acts as a ceiling. MMs sell into rallies here.`,
          level: `$${callWall.strike.toFixed(0)}`,
          sentiment: "Bearish",
        });
      }

      // Butterfly at max pain
      if (maxPainStrike) {
        tradeIdeas.push({
          strategy: `Butterfly centered at $${maxPainStrike.toFixed(0)}`,
          reasoning: `Max pain at $${maxPainStrike.toFixed(0)} — price tends to gravitate here into expiration. MMs profit most when options expire worthless at this level.`,
          level: `$${maxPainStrike.toFixed(0)}`,
          sentiment: "Neutral",
        });
      }

      // Gamma regime play
      if (isPositiveGamma) {
        tradeIdeas.push({
          strategy: "Sell premium (credit spreads, iron condors)",
          reasoning: "Positive gamma regime = MMs dampening moves. Range-bound, mean-reverting. Premium selling thrives.",
          level: `$${putWall?.strike.toFixed(0) || '?'} - $${callWall?.strike.toFixed(0) || '?'}`,
          sentiment: "Neutral",
        });
      } else {
        tradeIdeas.push({
          strategy: "Buy directional options (calls or puts with trend)",
          reasoning: "Negative gamma regime = MMs amplifying moves. Trends accelerate. Bought options can run.",
          level: gammaFlip ? `Flip at $${gammaFlip.toFixed(0)}` : "Watch for breakout",
          sentiment: spotVsFlip === "above" ? "Bullish" : "Bearish",
        });
      }

      // Unusual activity suggestion
      if (unusual.length > 0) {
        const top = unusual[0];
        tradeIdeas.push({
          strategy: `Follow unusual ${top.type} flow at $${top.strike}`,
          reasoning: `${top.volume.toLocaleString()} volume vs ${top.openInterest.toLocaleString()} OI (${top.ratio}x ratio) on ${top.expiry} ${top.type}s at $${top.strike}. Fresh institutional positioning.`,
          level: `$${top.strike}`,
          sentiment: top.type === "CALL" ? "Bullish" : "Bearish",
        });
      }

      res.json({
        ticker,
        companyName,
        spot,
        // Key levels
        callWall: callWall ? { strike: callWall.strike, callOI: callWall.callOI, callGEX: Number(callWall.callGEX.toFixed(0)) } : null,
        putWall: putWall ? { strike: putWall.strike, putOI: putWall.putOI, putGEX: Number(putWall.putGEX.toFixed(0)) } : null,
        gammaFlip: gammaFlip ? Number(gammaFlip.toFixed(2)) : null,
        maxPain: maxPainStrike,
        totalGEX: Number(totalGEX.toFixed(0)),
        // Regime
        regime,
        regimeLabel,
        regimeDesc,
        // Ratios
        putCallRatioOI: Number(pcRatioOI.toFixed(2)),
        putCallRatioVol: Number(pcRatioVol.toFixed(2)),
        totalCallOI, totalPutOI, totalCallVol, totalPutVol,
        // GEX chart data
        gexByStrike: strikes.map(s => ({
          strike: s.strike,
          callGEX: Number(s.callGEX.toFixed(0)),
          putGEX: Number(s.putGEX.toFixed(0)),
          netGEX: Number(s.netGEX.toFixed(0)),
          callOI: s.callOI,
          putOI: s.putOI,
          callVolume: s.callVolume,
          putVolume: s.putVolume,
        })),
        // Unusual activity
        unusualActivity: unusual.slice(0, 15),
        // Trade ideas
        tradeIdeas,
        // Expiration dates for reference
        expirations: expirationDates.slice(0, maxExpiries).map(d => new Date(d * 1000).toISOString().split("T")[0]),
      });
    } catch (error: any) {
      console.error(`[mm-exposure] Error for ${ticker}:`, error.message);
      res.status(500).json({ error: error?.message || "Failed to fetch MM exposure data" });
    }
  });

  app.get("/api/dividends/:ticker", async (req, res) => {
    const ticker = req.params.ticker.toUpperCase();
    try {
      await ensureReady();
      const quote = await getQuoteLight(ticker);
      if (!quote) {
        return res.status(404).json({ error: `No data found for ${ticker}` });
      }
      res.json(extractDividendData(ticker, quote));
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Failed to fetch dividend data" });
    }
  });

  // ─── Ticker Search / Autocomplete ─────────────────────────────────────

  app.get("/api/search", async (req, res) => {
    const q = (req.query.q as string || "").trim();
    if (!q || q.length < 1) return res.json([]);
    try {
      const results = await polygonSearch(q);
      res.json(results);
    } catch (err: any) {
      console.log(`[search] Polygon failed for "${q}":`, err.message);
      res.json([]);
    }
  });

  app.get("/api/analyze/:ticker", checkFeatureAccess('analysisPerDay'), async (req, res) => {
    const ticker = req.params.ticker.toUpperCase();

    try {
      await ensureReady();
      // Fetch all data in parallel
      const [summaryResult, chart1YResult, chart3YResult, chart5YResult] = await Promise.allSettled([
        getQuote(ticker),
        getChart(ticker, "1y", "1d"),
        getChart(ticker, "3y", "1wk"),
        getChart(ticker, "5y", "1wk"),
      ]);

      const summary = summaryResult.status === "fulfilled" ? summaryResult.value : null;
      const chart1Y = chart1YResult.status === "fulfilled" ? chart1YResult.value : null;
      const chart3Y = chart3YResult.status === "fulfilled" ? chart3YResult.value : null;
      const chart5Y = chart5YResult.status === "fulfilled" ? chart5YResult.value : null;

      if (!summary) {
        console.log(`[analyze] ${ticker}: quoteSummary returned null. summaryResult status: ${summaryResult.status}, reason: ${summaryResult.status === 'rejected' ? (summaryResult as any).reason?.message : 'fulfilled but null'}`);
        return res.status(404).json({ error: `Ticker "${ticker}" not found or no data available.` });
      }

      const { quote, financials, analystData, profile } = extractQuoteData(summary);

      if (!quote.regularMarketPrice && !quote.marketCap) {
        console.log(`[analyze] ${ticker}: No price or market cap in quote data. Keys: ${Object.keys(quote).filter(k => quote[k] != null).join(',')}`);
        return res.status(404).json({ error: `Ticker "${ticker}" not found or no data available.` });
      }

      const { chartData: rawChartData, computedReturn: ret1Y } = extractChartData(chart1Y);
      const { computedReturn: ret3Y } = extractChartData(chart3Y);
      const { computedReturn: ret5Y } = extractChartData(chart5Y);

      // Add EMA 9/21/50 + SMA 200 overlays to chart data
      const chartCloses = rawChartData.map((d: any) => d.close);
      const ema9Arr = computeEMA(chartCloses, 9);
      const ema21Arr = computeEMA(chartCloses, 21);
      const ema50Arr = computeEMA(chartCloses, 50);
      const sma200Arr = computeSMA(chartCloses, 200);
      const chartData = rawChartData.map((d: any, i: number) => ({
        ...d,
        ema9: !isNaN(ema9Arr[i]) ? Number(ema9Arr[i].toFixed(2)) : null,
        ema21: !isNaN(ema21Arr[i]) ? Number(ema21Arr[i].toFixed(2)) : null,
        ema50: !isNaN(ema50Arr[i]) ? Number(ema50Arr[i].toFixed(2)) : null,
        sma200: !isNaN(sma200Arr[i]) ? Number(sma200Arr[i].toFixed(2)) : null,
      }));

      const historicalReturns = {
        oneYear: ret1Y,
        threeYear: ret3Y,
        fiveYear: ret5Y,
      };

      const fullData = { quote, financials, historicalReturns };

      // Compute scoring
      const scoring = computeScoring(fullData);
      const weightedScore = scoring.reduce((sum, cat) => sum + cat.score * cat.weight, 0);
      const { verdict, ruling } = computeVerdict(weightedScore);
      const { positives, risks } = generateBullBear(fullData);
      const redFlags = generateRedFlags(fullData);
      const decisionShortcut = generateDecisionShortcut(fullData);

      // Determine asset type
      let assetType = "Stock";
      if (quote.quoteType === "ETF") assetType = "ETF";
      else if (quote.quoteType === "MUTUALFUND") assetType = "Mutual Fund";
      else if (quote.quoteType === "CRYPTOCURRENCY") assetType = "Cryptocurrency";

      // Mission fit
      const divYield = safeNum(quote?.dividendYield);
      let missionFit = "Growth";
      let bestUse = "Capital Appreciation";
      if (divYield !== null && divYield > 3) { missionFit = "Income"; bestUse = "Dividend Income"; }
      else if (divYield !== null && divYield > 1) { missionFit = "Balanced"; bestUse = "Growth + Income"; }

      // Income analysis
      const incomeAnalysis = {
        yieldAttractiveness: divYield !== null && divYield > 3 ? "High" : divYield !== null && divYield > 1.5 ? "Moderate" : "Low",
        yieldColor: divYield !== null && divYield > 3 ? "green" : divYield !== null && divYield > 1.5 ? "yellow" : "red",
        incomeQuality: financials.payoutRatio === null ? "Unknown" : financials.payoutRatio < 75 ? "Sustainable" : financials.payoutRatio < 100 ? "Stretched" : "At Risk",
        incomeQualityColor: financials.payoutRatio === null ? "yellow" : financials.payoutRatio < 75 ? "green" : financials.payoutRatio < 100 ? "yellow" : "red",
        dividendGrowth: financials.earningsGrowth !== null && financials.earningsGrowth > 5 ? "Growing" : financials.earningsGrowth !== null && financials.earningsGrowth > 0 ? "Stable" : "Declining",
        dividendGrowthColor: financials.earningsGrowth !== null && financials.earningsGrowth > 5 ? "green" : financials.earningsGrowth !== null && financials.earningsGrowth > 0 ? "yellow" : "red",
        cutRisk: financials.payoutRatio !== null && financials.payoutRatio > 100 ? "High" : financials.payoutRatio !== null && financials.payoutRatio > 75 ? "Moderate" : "Low",
        cutRiskColor: financials.payoutRatio !== null && financials.payoutRatio > 100 ? "red" : financials.payoutRatio !== null && financials.payoutRatio > 75 ? "yellow" : "green",
      };

      // Business quality
      const businessQuality = {
        revenueTrend: financials.revenueGrowth !== null ? (financials.revenueGrowth > 5 ? "up" : financials.revenueGrowth < -5 ? "down" : "flat") : "flat",
        revenueGrowth: financials.revenueGrowth,
        ebitdaMargin: financials.ebitdaMargin,
        ebitdaTrend: financials.ebitdaMargin !== null ? (financials.ebitdaMargin > 20 ? "up" : financials.ebitdaMargin > 10 ? "flat" : "down") : "flat",
        fcfTrend: financials.freeCashFlow !== null ? (financials.freeCashFlow > 0 ? "up" : "down") : "flat",
        freeCashFlow: financials.freeCashFlow,
        debtToEquity: financials.debtToEquity,
        payoutRatio: financials.payoutRatio,
      };

      // Sentiment
      const totalRatings = analystData.buy + analystData.hold + analystData.sell;
      let sentiment = "Neutral";
      if (totalRatings > 0) {
        const bullPct = analystData.buy / totalRatings;
        if (bullPct > 0.6) sentiment = "Bullish";
        else if (bullPct < 0.3) sentiment = "Bearish";
      }

      const responseData = {
        ticker,
        companyName: quote.longName || quote.shortName || ticker,
        assetType,
        sector: quote.sector || profile?.sector || "N/A",
        industry: quote.industry || profile?.industry || "N/A",
        description: profile?.longBusinessSummary || null,
        employees: raw(profile?.fullTimeEmployees),
        verdict,
        score: Number(weightedScore.toFixed(2)),
        ruling,
        missionFit,
        bestUse,
        positives,
        risks,
        price: quote.regularMarketPrice,
        change: quote.regularMarketChange,
        changePercent: quote.regularMarketChangePercent,
        currency: quote.currency || "USD",
        marketCap: quote.marketCap,
        pe: quote.trailingPE,
        forwardPe: quote.forwardPE,
        eps: quote.epsTrailingTwelveMonths,
        dividendYield: divYield,
        volume: quote.regularMarketVolume,
        avgVolume: quote.averageDailyVolume3Month,
        beta: quote.beta,
        fiftyTwoWeekHigh: quote.fiftyTwoWeekHigh,
        fiftyTwoWeekLow: quote.fiftyTwoWeekLow,
        sentiment,
        analystData,
        businessQuality,
        financials,
        historicalReturns,
        chartData,
        incomeAnalysis,
        scoring,
        redFlags,
        decisionShortcut,
      };

      res.json(responseData);
    } catch (error: any) {
      console.error(`Error analyzing ${ticker}:`, error?.message || error);
      res.status(500).json({ error: `Failed to analyze ticker "${ticker}". ${error?.message || "Unknown error."}` });
    }
  });

  // ============================================================
  // Favorites API
  // ============================================================

  // Get all favorites for a list type
  app.get("/api/favorites/:listType", async (req, res) => {
    try {
      const listType = req.params.listType;
      if (listType !== "watchlist" && listType !== "portfolio") {
        return res.status(400).json({ error: "listType must be 'watchlist' or 'portfolio'" });
      }
      const items = await storage.getFavorites(req.user!.id, listType);
      res.json(items);
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Failed to fetch favorites" });
    }
  });

  // Add a favorite
  app.post("/api/favorites", async (req, res) => {
    try {
      const { ticker, companyName, listType, score, verdict, sector } = req.body;
      if (!ticker || !listType) {
        return res.status(400).json({ error: "ticker and listType are required" });
      }
      // Check if already exists
      const existing = await storage.getFavorite(req.user!.id, ticker.toUpperCase(), listType);
      if (existing) {
        return res.status(409).json({ error: "Already in list" });
      }
      const fav = await storage.addFavorite({
        userId: req.user!.id,
        ticker: ticker.toUpperCase(),
        companyName: companyName || ticker.toUpperCase(),
        listType,
        score: score ?? null,
        verdict: verdict ?? null,
        sector: sector ?? null,
        addedAt: new Date().toISOString(),
      });
      res.json(fav);
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Failed to add favorite" });
    }
  });

  // Remove a favorite
  app.delete("/api/favorites/:listType/:ticker", async (req, res) => {
    try {
      const { listType, ticker } = req.params;
      await storage.removeFavorite(req.user!.id, ticker.toUpperCase(), listType);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Failed to remove favorite" });
    }
  });

  // ============================================================
  // Trade Analysis API
  // ============================================================

  function computeEMA(closes: number[], length: number): number[] {
    const ema: number[] = new Array(closes.length).fill(NaN);
    const k = 2 / (length + 1);
    // seed with SMA of first 'length' values
    let sum = 0;
    for (let i = 0; i < length && i < closes.length; i++) sum += closes[i];
    if (closes.length >= length) {
      ema[length - 1] = sum / length;
      for (let i = length; i < closes.length; i++) {
        ema[i] = closes[i] * k + ema[i - 1] * (1 - k);
      }
    }
    return ema;
  }

  function computeSMA(closes: number[], length: number): number[] {
    const sma: number[] = new Array(closes.length).fill(NaN);
    let sum = 0;
    for (let i = 0; i < closes.length; i++) {
      sum += closes[i];
      if (i >= length) sum -= closes[i - length];
      if (i >= length - 1) sma[i] = sum / length;
    }
    return sma;
  }

  // RSI is imported from the canonical indicators module (see top of file).
  // Local wrapper preserves the positional-arg signature used by this route.
  function computeRSI(closes: number[], period: number): number[] {
    return computeRSISeries(closes, { period });
  }

  function computeATR(highs: number[], lows: number[], closes: number[], period: number): number[] {
    const atr: number[] = new Array(closes.length).fill(NaN);
    const tr: number[] = new Array(closes.length).fill(0);
    tr[0] = highs[0] - lows[0];
    for (let i = 1; i < closes.length; i++) {
      tr[i] = Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      );
    }
    let sum = 0;
    for (let i = 0; i < period && i < tr.length; i++) sum += tr[i];
    if (tr.length >= period) {
      atr[period - 1] = sum / period;
      for (let i = period; i < tr.length; i++) {
        atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
      }
    }
    return atr;
  }

  app.get("/api/trade-analysis/:ticker", async (req, res) => {
    const ticker = req.params.ticker.toUpperCase();
    try {
      await ensureReady();
      // Fetch 1-year daily for BBTC + RSI, 2-year weekly for SMA200
      const [chart1YResult, chart2YResult] = await Promise.allSettled([
        getChart(ticker, "1y", "1d"),
        getChart(ticker, "2y", "1wk"),
      ]);

      const chart1Y = chart1YResult.status === "fulfilled" ? chart1YResult.value : null;
      const chart2Y = chart2YResult.status === "fulfilled" ? chart2YResult.value : null;

      if (!chart1Y || !chart1Y.timestamp) {
        return res.status(404).json({ error: `No chart data available for "${ticker}".` });
      }

      const timestamps: number[] = chart1Y.timestamp;
      const quoteData = chart1Y.indicators?.quote?.[0] || {};
      const opens: number[] = quoteData.open || [];
      const highs: number[] = quoteData.high || [];
      const lows: number[] = quoteData.low || [];
      const closes: number[] = quoteData.close || [];
      const volumes: number[] = quoteData.volume || [];

      // Clean nulls — replace with previous valid value
      for (let i = 0; i < closes.length; i++) {
        if (closes[i] == null && i > 0) closes[i] = closes[i - 1];
        if (highs[i] == null && i > 0) highs[i] = highs[i - 1];
        if (lows[i] == null && i > 0) lows[i] = lows[i - 1];
        if (opens[i] == null && i > 0) opens[i] = opens[i - 1];
        if (volumes[i] == null) volumes[i] = 0;
      }

      // Compute BBTC indicators on daily data
      const ema9 = computeEMA(closes, 9);
      const ema21 = computeEMA(closes, 21);
      const ema50 = computeEMA(closes, 50);
      const atr14 = computeATR(highs, lows, closes, 14);

      // Compute VER indicators
      const rsi14 = computeRSI(closes, 14);

      // Compute Bollinger Bands for VER
      const bbPeriod = 20;
      const bbStdDev = 2;
      const bbSma = computeSMA(closes, bbPeriod);
      const bbUpper: number[] = new Array(closes.length).fill(NaN);
      const bbLower: number[] = new Array(closes.length).fill(NaN);
      for (let i = bbPeriod - 1; i < closes.length; i++) {
        let sum = 0;
        for (let j = i - bbPeriod + 1; j <= i; j++) {
          sum += (closes[j] - bbSma[i]) ** 2;
        }
        const stdDev = Math.sqrt(sum / bbPeriod);
        bbUpper[i] = bbSma[i] + bbStdDev * stdDev;
        bbLower[i] = bbSma[i] - bbStdDev * stdDev;
      }

      // Compute volume average for VER
      const volAvg20: number[] = new Array(closes.length).fill(NaN);
      for (let i = 19; i < closes.length; i++) {
        let sum = 0;
        for (let j = i - 19; j <= i; j++) sum += volumes[j] || 0;
        volAvg20[i] = sum / 20;
      }

      // SMA200 (used by AMC reversion entry and chart data)
      const sma200Daily = computeSMA(closes, 200);

      // ---- Strategy 1: BBTC EMA Pyramid Risk ----
      const bbtcResult = computeBBTC({ closes, highs, lows, ema9, ema21, ema50, atr14 });
      const bbtcSignals = bbtcResult.signals;
      const entryPrice = bbtcResult.entryPrice;
      const highestSinceEntry = bbtcResult.highestSinceEntry;

      // ---- Strategy 2: VER (Volume Exhaustion Reversal) ----
      const verResult = computeVER({ closes, highs, lows, volumes, rsi14, bbUpper, bbLower, volAvg20 });
      const verSignals = verResult.signals;

      // ---- Build response ----
      const lastIdx = closes.length - 1;
      const currentPrice = closes[lastIdx];

      // BBTC current state (from computeBBTC result)
      const lastBbtcSignal = bbtcResult.lastSignal;
      const bbtcTopSignal = bbtcResult.topSignal;
      const bbtcBias = bbtcResult.bias;
      const bbtcTrend = bbtcResult.trend;

      let bbtcSignalDetail = "";
      if (bbtcTrend === "UP") bbtcSignalDetail = "EMA9 above EMA21, bullish trend confirmed";
      else if (bbtcTrend === "DOWN") bbtcSignalDetail = "EMA9 below EMA21, bearish trend confirmed";
      else bbtcSignalDetail = "EMAs converging, no clear directional bias";

      const lastAtr = isNaN(atr14[lastIdx]) ? null : Number(atr14[lastIdx].toFixed(2));
      const stopPrice = entryPrice && lastAtr ? Number((entryPrice - lastAtr * 2.0).toFixed(2)) : null;
      const targetPrice = entryPrice && lastAtr ? Number((entryPrice + lastAtr * 3.0).toFixed(2)) : null;
      const trailStop = lastAtr ? Number((highestSinceEntry - lastAtr * 1.5).toFixed(2)) : null;

      // Recent BBTC signals
      const bbtcRecent: {date: string; signal: string; price: number}[] = [];
      for (let i = lastIdx; i >= 0 && bbtcRecent.length < 10; i--) {
        if (bbtcSignals[i]) {
          bbtcRecent.unshift({
            date: new Date(timestamps[i] * 1000).toISOString().split("T")[0],
            signal: bbtcSignals[i]!,
            price: Number(closes[i].toFixed(2)),
          });
        }
      }

      // VER current state (from computeVER result)
      const lastVerSignal = verResult.lastSignal;
      const verTopSignal = verResult.topSignal;

      const currentVol = volumes[lastIdx] || 0;
      const avgVol = !isNaN(volAvg20[lastIdx]) ? volAvg20[lastIdx] : 0;
      const volRatio = avgVol > 0 ? (currentVol / avgVol) : 0;

      let verSignalDetail = "";
      if (verTopSignal === "ENTER") verSignalDetail = `Bullish reversal: RSI divergence at ${rsi14[lastIdx]?.toFixed(1)}, volume ${volRatio.toFixed(1)}x avg, price bouncing off lower Bollinger Band`;
      else if (verTopSignal === "SELL") verSignalDetail = `Bearish reversal: RSI divergence at ${rsi14[lastIdx]?.toFixed(1)}, volume ${volRatio.toFixed(1)}x avg, price rejected at upper Bollinger Band`;
      else verSignalDetail = `RSI ${rsi14[lastIdx]?.toFixed(1) ?? "N/A"}, Vol ${volRatio.toFixed(1)}x avg — no exhaustion reversal detected`;

      const verRecent: {date: string; signal: string; price: number}[] = [];
      for (let i = lastIdx; i >= 0 && verRecent.length < 10; i--) {
        if (verSignals[i]) {
          verRecent.unshift({
            date: new Date(timestamps[i] * 1000).toISOString().split("T")[0],
            signal: verSignals[i]!,
            price: Number(closes[i].toFixed(2)),
          });
        }
      }

      // Combined signal
      const bbtcIsBuy = bbtcTopSignal === "ENTER";
      const bbtcIsSell = bbtcTopSignal === "SELL";
      const verIsBuy = verTopSignal === "ENTER";
      const verIsSell = verTopSignal === "SELL";

      // ---- Strategy 3: AMC (Adaptive Momentum Confluence) ----
      // Compute MACD histogram for AMC
      const macdEma12 = computeEMA(closes, 12);
      const macdEma26 = computeEMA(closes, 26);
      const macdLineArr = closes.map((_, i) => (!isNaN(macdEma12[i]) && !isNaN(macdEma26[i])) ? macdEma12[i] - macdEma26[i] : NaN);
      const validMacdVals: number[] = []; const validMacdIdx: number[] = [];
      macdLineArr.forEach((v, i) => { if (!isNaN(v)) { validMacdVals.push(v); validMacdIdx.push(i); } });
      const macdSigEma = computeEMA(validMacdVals, 9);
      const macdSignalArr = new Array(closes.length).fill(NaN);
      validMacdIdx.forEach((idx, j) => { macdSignalArr[idx] = macdSigEma[j]; });
      const histogram = closes.map((_, i) => (!isNaN(macdLineArr[i]) && !isNaN(macdSignalArr[i])) ? macdLineArr[i] - macdSignalArr[i] : NaN);

      // VAMI computation
      const vamiArr: number[] = new Array(closes.length).fill(0);
      const avgVol20 = computeSMA(volumes.map(v => v || 0), 20);
      for (let i = 1; i < closes.length; i++) {
        if (closes[i-1] === 0 || isNaN(avgVol20[i]) || avgVol20[i] === 0) continue;
        const ret = (closes[i] - closes[i-1]) / closes[i-1] * 100;
        const vr = Math.min(2.5, Math.max(0.5, volumes[i] / avgVol20[i]));
        const wr = ret * vr;
        const k = 2 / (12 + 1);
        vamiArr[i] = wr * k + vamiArr[i-1] * (1 - k);
      }
      const vamiScaled = vamiArr.map(v => v * 8);

      // AMC scoring for current bar (Trade Analysis uses EMA9/EMA50 trend stack,
      // EMA9/EMA21 for trend-strength, and SMA200*0.95 as reversion floor.)
      const sma200ScaledTA = sma200Daily.map(v => isNaN(v) ? NaN : v * 0.95);
      const amcInput = {
        closes,
        histogram,
        rsi14,
        trendShortEma: ema9,
        trendLongEma: ema50,
        trendStrengthRefEma: ema21,
        vamiScaled,
        reversionRefLevel: sma200ScaledTA,
        reversionDirection: "above" as const,
      };
      const amcResult = computeAMC(amcInput);
      const li = lastIdx;
      const amcScore = amcResult.score;
      let amcSignal: "ENTER" | "HOLD" | "SELL" = amcResult.signal;
      const amcMode: "momentum" | "reversion" | "flat" = amcResult.mode;

      let amcDetail = `Score: ${amcScore}/5`;
      if (amcSignal === "ENTER") amcDetail += ` — ${amcMode} entry triggered`;
      else if (amcSignal === "SELL") amcDetail += " — exit conditions met";
      else amcDetail += " — waiting for 4+ conditions";

      // AMC recent signals (uses same scoring as current bar via scoreAMC)
      const amcRecent: {date: string; signal: string; price: number}[] = [];
      for (let i = lastIdx; i >= 60 && amcRecent.length < 10; i--) {
        const sc = scoreAMC(i, amcInput);
        const mEntry = sc >= 4 && closes[i] > closes[i-1];
        const rEntry = !isNaN(rsi14[i]) && rsi14[i] < 30 && closes[i] > closes[i-1];
        const exitSig = (!isNaN(rsi14[i]) && rsi14[i] > 75) || (!isNaN(histogram[i]) && histogram[i] < 0 && !isNaN(histogram[i-1]) && histogram[i-1] >= 0);
        if (mEntry || rEntry || exitSig) {
          amcRecent.unshift({
            date: new Date(timestamps[i] * 1000).toISOString().split("T")[0],
            signal: mEntry ? "BUY (M)" : rEntry ? "BUY (R)" : "SELL",
            price: Number(closes[i].toFixed(2)),
          });
        }
      }

      // Combined signal (now includes AMC)
      const amcIsBuy = amcSignal === "ENTER";
      const amcIsSell = amcSignal === "SELL";
      let buyVotes = (bbtcIsBuy ? 1 : 0) + (verIsBuy ? 1 : 0) + (amcIsBuy ? 1 : 0);
      let sellVotes = (bbtcIsSell ? 1 : 0) + (verIsSell ? 1 : 0) + (amcIsSell ? 1 : 0);

      let combinedSignal: "ENTER" | "HOLD" | "SELL" = "HOLD";
      let confidence: "Strong" | "Moderate" | "Weak" = "Moderate";
      let reasoning = "";

      if (buyVotes >= 3) {
        combinedSignal = "ENTER"; confidence = "Strong"; reasoning = "All three strategies agree on entry";
      } else if (sellVotes >= 3) {
        combinedSignal = "SELL"; confidence = "Strong"; reasoning = "All three strategies agree on exit";
      } else if (buyVotes === 2 && sellVotes === 0) {
        combinedSignal = "ENTER"; confidence = "Moderate"; reasoning = `${[bbtcIsBuy&&"BBTC",verIsBuy&&"VER",amcIsBuy&&"AMC"].filter(Boolean).join(" + ")} signal entry`;
      } else if (sellVotes === 2 && buyVotes === 0) {
        combinedSignal = "SELL"; confidence = "Moderate"; reasoning = `${[bbtcIsSell&&"BBTC",verIsSell&&"VER",amcIsSell&&"AMC"].filter(Boolean).join(" + ")} signal exit`;
      } else if (buyVotes === 1 && sellVotes === 0) {
        combinedSignal = "HOLD"; confidence = "Weak"; reasoning = `Only ${[bbtcIsBuy&&"BBTC",verIsBuy&&"VER",amcIsBuy&&"AMC"].filter(Boolean)[0]} is bullish — not enough confluence`;
      } else if (sellVotes === 1 && buyVotes === 0) {
        combinedSignal = "HOLD"; confidence = "Weak"; reasoning = `Only ${[bbtcIsSell&&"BBTC",verIsSell&&"VER",amcIsSell&&"AMC"].filter(Boolean)[0]} is bearish — not enough confluence`;
      } else if (buyVotes > 0 && sellVotes > 0) {
        combinedSignal = "HOLD"; confidence = "Weak"; reasoning = "Strategies conflict — wait for alignment";
      } else {
        combinedSignal = "HOLD"; confidence = "Moderate"; reasoning = "No active signals from any strategy";
      }

      // Chart data (subsample for frontend — every 3rd bar for ~80-90 points)
      const step = Math.max(1, Math.floor(closes.length / 120));
      const chartDataArr: any[] = [];
      for (let i = 0; i < closes.length; i += step) {
        chartDataArr.push({
          date: new Date(timestamps[i] * 1000).toISOString().split("T")[0],
          close: Number(closes[i].toFixed(2)),
          ema9: isNaN(ema9[i]) ? null : Number(ema9[i].toFixed(2)),
          ema21: isNaN(ema21[i]) ? null : Number(ema21[i].toFixed(2)),
          ema50: isNaN(ema50[i]) ? null : Number(ema50[i].toFixed(2)),
          sma200: isNaN(sma200Daily[i]) ? null : Number(sma200Daily[i].toFixed(2)),
          rsi: isNaN(rsi14[i]) ? null : Number(rsi14[i].toFixed(2)),
          bbtcSignal: bbtcSignals[i] || null,
          verSignal: verSignals[i] || null,
        });
      }
      // Always include the last bar
      if (chartDataArr.length === 0 || chartDataArr[chartDataArr.length - 1].date !== new Date(timestamps[lastIdx] * 1000).toISOString().split("T")[0]) {
        chartDataArr.push({
          date: new Date(timestamps[lastIdx] * 1000).toISOString().split("T")[0],
          close: Number(closes[lastIdx].toFixed(2)),
          ema9: isNaN(ema9[lastIdx]) ? null : Number(ema9[lastIdx].toFixed(2)),
          ema21: isNaN(ema21[lastIdx]) ? null : Number(ema21[lastIdx].toFixed(2)),
          ema50: isNaN(ema50[lastIdx]) ? null : Number(ema50[lastIdx].toFixed(2)),
          sma200: isNaN(sma200Daily[lastIdx]) ? null : Number(sma200Daily[lastIdx].toFixed(2)),
          rsi: isNaN(rsi14[lastIdx]) ? null : Number(rsi14[lastIdx].toFixed(2)),
          bbtcSignal: bbtcSignals[lastIdx] || null,
          verSignal: verSignals[lastIdx] || null,
        });
      }

      // ── Run 3-Gate Signal Engine ──
      let gateResult: GateSystemResult | null = null;
      try {
        // Try to get MME data for Gate 3 (best-effort, non-blocking)
        let mmeData = null;
        try {
          const optionsUrl = `https://query2.finance.yahoo.com/v7/finance/options/${ticker}`;
          const cacheKey = `mme_gate_${ticker}`;
          const cached = getCached(cacheKey);
          if (cached) {
            mmeData = cached;
          }
          // We skip live MME fetch in trade-analysis to avoid 429s.
          // Gate 3 will evaluate without MME data (EMA-only check)
        } catch {}

        gateResult = runGateSystem({
          ticker,
          closes,
          highs,
          lows,
          volumes,
          mmeData,
          precomputed: {
            verSignal: verTopSignal,
            verRsi: isNaN(rsi14[lastIdx]) ? null : Number(rsi14[lastIdx].toFixed(1)),
            verVolRatio: Number(volRatio.toFixed(2)),
            amcScore,
            amcSignal,
            bbtcSignal: bbtcTopSignal,
            bbtcBias,
            bbtcTrend,
            emaStackBull: !isNaN(ema9[lastIdx]) && !isNaN(ema21[lastIdx]) && !isNaN(ema50[lastIdx]) && ema9[lastIdx] > ema21[lastIdx] && ema21[lastIdx] > ema50[lastIdx],
            emaStackBear: !isNaN(ema9[lastIdx]) && !isNaN(ema21[lastIdx]) && !isNaN(ema50[lastIdx]) && ema9[lastIdx] < ema21[lastIdx] && ema21[lastIdx] < ema50[lastIdx],
            priceAboveEma9: !isNaN(ema9[lastIdx]) && closes[lastIdx] > ema9[lastIdx],
          },
        });
      } catch (err: any) {
        console.error(`[gate-system] Error for ${ticker}:`, err.message);
      }

      res.json({
        ticker,
        currentPrice: Number(currentPrice.toFixed(2)),
        // 3-Gate Signal System
        gates: gateResult,
        bbtc: {
          signal: bbtcTopSignal,
          signalDetail: bbtcSignalDetail,
          bias: bbtcBias,
          trend: bbtcTrend,
          ema9: isNaN(ema9[lastIdx]) ? null : Number(ema9[lastIdx].toFixed(2)),
          ema21: isNaN(ema21[lastIdx]) ? null : Number(ema21[lastIdx].toFixed(2)),
          ema50: isNaN(ema50[lastIdx]) ? null : Number(ema50[lastIdx].toFixed(2)),
          atr: lastAtr,
          stopPrice,
          targetPrice,
          trailStop,
          recentSignals: bbtcRecent,
        },
        ver: {
          signal: verTopSignal,
          signalDetail: verSignalDetail,
          rsi: isNaN(rsi14[lastIdx]) ? null : Number(rsi14[lastIdx].toFixed(2)),
          bbUpper: isNaN(bbUpper[lastIdx]) ? null : Number(bbUpper[lastIdx].toFixed(2)),
          bbLower: isNaN(bbLower[lastIdx]) ? null : Number(bbLower[lastIdx].toFixed(2)),
          bbMiddle: isNaN(bbSma[lastIdx]) ? null : Number(bbSma[lastIdx].toFixed(2)),
          volumeRatio: Number(volRatio.toFixed(2)),
          recentSignals: verRecent,
        },
        amc: {
          signal: amcSignal,
          signalDetail: amcDetail,
          mode: amcMode,
          score: amcScore,
          vami: Number(vamiScaled[lastIdx]?.toFixed(2) || 0),
          recentSignals: amcRecent,
        },
        combined: {
          signal: gateResult ? gateResult.signal : combinedSignal,
          confidence: gateResult ? gateResult.confidence : confidence,
          reasoning: gateResult ? gateResult.summary : reasoning,
          votes: { buy: buyVotes, sell: sellVotes },
        },
        chartData: chartDataArr,
      });
    } catch (error: any) {
      console.error(`Error in trade analysis for ${ticker}:`, error?.message || error);
      res.status(500).json({ error: `Failed to analyze trades for "${ticker}". ${error?.message || "Unknown error."}` });
    }
  });

  // ============================================================
  // Helper functions for Strategy 3 (Triple Confluence)
  // ============================================================

  function computeMACD(closes: number[]): { macdLine: number[]; signalLine: number[]; histogram: number[] } {
    const ema12 = computeEMA(closes, 12);
    const ema26 = computeEMA(closes, 26);
    const macdLine: number[] = new Array(closes.length).fill(NaN);
    for (let i = 0; i < closes.length; i++) {
      if (!isNaN(ema12[i]) && !isNaN(ema26[i])) {
        macdLine[i] = ema12[i] - ema26[i];
      }
    }
    // Signal line = EMA(9) of MACD line
    // Need to extract valid MACD values for EMA computation
    const validMacd: number[] = [];
    const validIndices: number[] = [];
    for (let i = 0; i < macdLine.length; i++) {
      if (!isNaN(macdLine[i])) {
        validMacd.push(macdLine[i]);
        validIndices.push(i);
      }
    }
    const signalOfValid = computeEMA(validMacd, 9);
    const signalLine: number[] = new Array(closes.length).fill(NaN);
    for (let j = 0; j < validIndices.length; j++) {
      signalLine[validIndices[j]] = signalOfValid[j];
    }
    const histogram: number[] = new Array(closes.length).fill(NaN);
    for (let i = 0; i < closes.length; i++) {
      if (!isNaN(macdLine[i]) && !isNaN(signalLine[i])) {
        histogram[i] = macdLine[i] - signalLine[i];
      }
    }
    return { macdLine, signalLine, histogram };
  }

  function computeBollingerBands(closes: number[], period = 20, mult = 2): { middle: number[]; upper: number[]; lower: number[] } {
    const middle = computeSMA(closes, period);
    const upper: number[] = new Array(closes.length).fill(NaN);
    const lower: number[] = new Array(closes.length).fill(NaN);
    for (let i = period - 1; i < closes.length; i++) {
      let sumSq = 0;
      for (let j = i - period + 1; j <= i; j++) {
        const diff = closes[j] - middle[i];
        sumSq += diff * diff;
      }
      const stddev = Math.sqrt(sumSq / period);
      upper[i] = middle[i] + mult * stddev;
      lower[i] = middle[i] - mult * stddev;
    }
    return { middle, upper, lower };
  }

  function computeADX(highs: number[], lows: number[], closes: number[], period = 14): number[] {
    const len = closes.length;
    const adx: number[] = new Array(len).fill(NaN);
    if (len < period * 2 + 1) return adx;

    // True Range
    const tr: number[] = new Array(len).fill(0);
    tr[0] = highs[0] - lows[0];
    for (let i = 1; i < len; i++) {
      tr[i] = Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      );
    }

    // +DM and -DM
    const plusDM: number[] = new Array(len).fill(0);
    const minusDM: number[] = new Array(len).fill(0);
    for (let i = 1; i < len; i++) {
      const upMove = highs[i] - highs[i - 1];
      const downMove = lows[i - 1] - lows[i];
      plusDM[i] = (upMove > downMove && upMove > 0) ? upMove : 0;
      minusDM[i] = (downMove > upMove && downMove > 0) ? downMove : 0;
    }

    // Wilder's smoothing (first period sum, then smooth)
    let smoothTR = 0, smoothPlusDM = 0, smoothMinusDM = 0;
    for (let i = 1; i <= period; i++) {
      smoothTR += tr[i];
      smoothPlusDM += plusDM[i];
      smoothMinusDM += minusDM[i];
    }

    const dx: number[] = new Array(len).fill(NaN);
    // First DI values at index=period
    let plusDI = (smoothTR !== 0) ? (smoothPlusDM / smoothTR) * 100 : 0;
    let minusDI = (smoothTR !== 0) ? (smoothMinusDM / smoothTR) * 100 : 0;
    let diSum = plusDI + minusDI;
    dx[period] = diSum !== 0 ? (Math.abs(plusDI - minusDI) / diSum) * 100 : 0;

    for (let i = period + 1; i < len; i++) {
      smoothTR = smoothTR - (smoothTR / period) + tr[i];
      smoothPlusDM = smoothPlusDM - (smoothPlusDM / period) + plusDM[i];
      smoothMinusDM = smoothMinusDM - (smoothMinusDM / period) + minusDM[i];
      plusDI = (smoothTR !== 0) ? (smoothPlusDM / smoothTR) * 100 : 0;
      minusDI = (smoothTR !== 0) ? (smoothMinusDM / smoothTR) * 100 : 0;
      diSum = plusDI + minusDI;
      dx[i] = diSum !== 0 ? (Math.abs(plusDI - minusDI) / diSum) * 100 : 0;
    }

    // ADX = Wilder's smoothing of DX over period
    let adxSum = 0;
    let adxCount = 0;
    for (let i = period; i < period * 2 && i < len; i++) {
      if (!isNaN(dx[i])) {
        adxSum += dx[i];
        adxCount++;
      }
    }
    if (adxCount === period && period * 2 - 1 < len) {
      adx[period * 2 - 1] = adxSum / period;
      for (let i = period * 2; i < len; i++) {
        adx[i] = (adx[i - 1] * (period - 1) + dx[i]) / period;
      }
    }

    return adx;
  }

  // ============================================================
  // Dynamic Stock Screener → fetch tickers from Yahoo screener API
  // ============================================================

  async function screenStocks(options: {
    minPrice?: number;
    maxPrice?: number;
    sector?: string;
    minMarketCap?: number;
    maxMarketCap?: number;
    minVolume?: number;
    count?: number;
    sortBy?: string;
  }): Promise<string[]> {
    const {
      minPrice = 5,
      maxPrice = 10000,
      sector,
      minMarketCap = 500_000_000,
      maxMarketCap,
      minVolume = 500_000,
      count = 100,
      sortBy = "dayvolume",
    } = options;

    // Primary: Polygon grouped-daily screener.
    // NOTE: Polygon doesn't support sector filtering server-side; if sector is specified,
    // the downstream per-ticker analysis will filter on sector from ticker details.
    try {
      const tickers = await polygonScreener({
        minPrice,
        maxPrice,
        sector,
        minMarketCap,
        maxMarketCap,
        count,
      });
      if (tickers.length) return tickers;
    } catch (err: any) {
      console.log(`[screener] Polygon failed, falling back to Yahoo:`, err.message);
    }

    // Fallback: Yahoo screener (legacy)
    const operands: any[] = [
      { operator: "or", operands: [{ operator: "EQ", operands: ["region", "us"] }] },
      { operator: "gt", operands: ["dayvolume", minVolume] },
      { operator: "gt", operands: ["intradaymarketcap", minMarketCap] },
      { operator: "btwn", operands: ["intradayprice", minPrice, maxPrice] },
    ];

    if (maxMarketCap) {
      operands.push({ operator: "lt", operands: ["intradaymarketcap", maxMarketCap] });
    }

    if (sector && sector !== "all") {
      operands.push({ operator: "EQ", operands: ["sector", sector] });
    }

    const body = JSON.stringify({
      offset: 0,
      size: Math.min(count, 250),
      sortField: sortBy,
      sortType: "DESC",
      quoteType: "EQUITY",
      query: { operator: "AND", operands },
    });

    const data = await enqueue(async () => {
      const { crumb, cookie } = await getYahooCrumb();
      const resp = await fetch(
        `https://query1.finance.yahoo.com/v1/finance/screener?crumb=${encodeURIComponent(crumb)}`,
        {
          method: "POST",
          headers: { ...YF_BASE_HEADERS, "Content-Type": "application/json", Cookie: cookie },
          body,
        }
      );
      if (resp.status === 429) throw new Error("Yahoo Finance rate limited (429)");
      if (!resp.ok) {
        console.log(`[screener] Error: ${resp.status}`);
        return null;
      }
      return resp.json();
    }, "screener");

    if (!data) return [];
    const quotes = data?.finance?.result?.[0]?.quotes || [];
    return quotes.map((q: any) => q.symbol as string).filter(Boolean);
  }

  // ============================================================
  // Scanner Route (dynamic)
  // ============================================================

  app.get("/api/scanner", checkFeatureAccess('scansPerDay'), async (req, res) => {
    if (checkScanRateLimit(req, res)) return;
    // Parse filter params from query string
    const minPrice = Number(req.query.minPrice) || 5;
    const maxPrice = Number(req.query.maxPrice) || 10000;
    const sector = (req.query.sector as string) || "all";
    const marketCapTier = (req.query.marketCap as string) || "all";
    const scanSize = Math.min(Number(req.query.count) || 100, 200);
    const showAll = req.query.showAll === "true";

    // Map market cap tier to min/max
    let minMarketCap = 500_000_000;
    let maxMarketCap: number | undefined;
    switch (marketCapTier) {
      case "mega": minMarketCap = 200_000_000_000; break;
      case "large": minMarketCap = 10_000_000_000; maxMarketCap = 200_000_000_000; break;
      case "mid": minMarketCap = 2_000_000_000; maxMarketCap = 10_000_000_000; break;
      case "small": minMarketCap = 300_000_000; maxMarketCap = 2_000_000_000; break;
      default: minMarketCap = 500_000_000; break;
    }

    // Route-level cache: same filter tuple → instant response.
    // User-scoped to keep rate-limit fairness but shared filters hit the same key anyway.
    const scanCacheKey = `scanner:main:${minPrice}:${maxPrice}:${sector}:${marketCapTier}:${scanSize}:${showAll ? 1 : 0}`;
    {
      const cached = getCached(scanCacheKey);
      if (cached) return res.json(cached);
    }

    try {
      await ensureReady();
      console.log(`[scanner] Screening: price $${minPrice}-$${maxPrice}, sector=${sector}, cap=${marketCapTier}, count=${scanSize}`);

      // Step 1: Get tickers from Yahoo screener
      const tickers = await screenStocks({
        minPrice,
        maxPrice,
        sector: sector === "all" ? undefined : sector,
        minMarketCap,
        maxMarketCap,
        count: scanSize,
      });

      if (tickers.length === 0) {
        return res.json({ scannedAt: new Date().toISOString(), totalScanned: 0, filters: { minPrice, maxPrice, sector, marketCapTier }, results: [] });
      }

      console.log(`[scanner] Found ${tickers.length} tickers, analyzing...`);

      const allResults: any[] = [];

      // Process in batches of 20 (Polygon Starter has no per-second cap; the
      // only real limit is network/CPU).  Scanner was previously batching 5
      // which made a 100-ticker scan take ~10–15s just on wall time.
      const BATCH = 20;
      for (let b = 0; b < tickers.length; b += BATCH) {
        const batch = tickers.slice(b, b + BATCH);
        const batchResults = await Promise.allSettled(
          batch.map(async (ticker) => {
            const chart = await getChart(ticker, "6mo", "1d");
            if (!chart || !chart.timestamp) return null;

            const quoteData = chart.indicators?.quote?.[0] || {};
            const closes: number[] = quoteData.close || [];
            const highs: number[] = quoteData.high || [];
            const lows: number[] = quoteData.low || [];
            const volumes: number[] = quoteData.volume || [];

            // Clean nulls
            for (let i = 0; i < closes.length; i++) {
              if (closes[i] == null && i > 0) closes[i] = closes[i - 1];
              if (highs[i] == null && i > 0) highs[i] = highs[i - 1];
              if (lows[i] == null && i > 0) lows[i] = lows[i - 1];
              if (volumes[i] == null) volumes[i] = 0;
            }

            if (closes.length < 50) return null;

            const lastIdx = closes.length - 1;
            const currentPrice = closes[lastIdx];

            // ---- Strategy 1: BBTC ----
            const ema9 = computeEMA(closes, 9);
            const ema21 = computeEMA(closes, 21);
            const ema50 = computeEMA(closes, 50);
            const atr14 = computeATR(highs, lows, closes, 14);

            const bbtcResult = computeBBTC({ closes, highs, lows, ema9, ema21, ema50, atr14 });
            const bbtcSignals = bbtcResult.signals;
            const bbtcTopSignal = bbtcResult.topSignal;
            const bbtcTrend = bbtcResult.trend;
            const bbtcBias = bbtcResult.bias;

            // ---- Strategy 2: VER (Volume Exhaustion Reversal) ----
            const rsi14 = computeRSI(closes, 14);

            const bbPeriodS = 20;
            const bbStdDevS = 2;
            const bbSmaS = computeSMA(closes, bbPeriodS);
            const bbUpperS: number[] = new Array(closes.length).fill(NaN);
            const bbLowerS: number[] = new Array(closes.length).fill(NaN);
            for (let i = bbPeriodS - 1; i < closes.length; i++) {
              let sum = 0;
              for (let j = i - bbPeriodS + 1; j <= i; j++) sum += (closes[j] - bbSmaS[i]) ** 2;
              const sd = Math.sqrt(sum / bbPeriodS);
              bbUpperS[i] = bbSmaS[i] + bbStdDevS * sd;
              bbLowerS[i] = bbSmaS[i] - bbStdDevS * sd;
            }
            const volAvg20S: number[] = new Array(closes.length).fill(NaN);
            for (let i = 19; i < closes.length; i++) {
              let sum = 0;
              for (let j = i - 19; j <= i; j++) sum += volumes[j] || 0;
              volAvg20S[i] = sum / 20;
            }

            const verResult = computeVER({
              closes, highs, lows, volumes,
              rsi14,
              bbUpper: bbUpperS,
              bbLower: bbLowerS,
              volAvg20: volAvg20S,
            });
            const verSignals = verResult.signals;
            const verTopSignal = verResult.topSignal;

            const lastRsi = isNaN(rsi14[lastIdx]) ? null : Number(rsi14[lastIdx].toFixed(1));

            // ---- Strategy 3: Triple Confluence ----
            const { macdLine, signalLine: macdSignal, histogram } = computeMACD(closes);
            const { upper: bbUpper, lower: bbLower } = computeBollingerBands(closes);
            const adxArr = computeADX(highs, lows, closes);

            // MACD assessment
            let macdStatus: "bullish" | "bearish" | "neutral" = "neutral";
            if (!isNaN(macdLine[lastIdx]) && !isNaN(macdSignal[lastIdx]) && !isNaN(histogram[lastIdx]) && lastIdx > 0 && !isNaN(histogram[lastIdx - 1])) {
              const macdAboveSignal = macdLine[lastIdx] > macdSignal[lastIdx];
              const histIncreasing = histogram[lastIdx] > histogram[lastIdx - 1];
              const histDecreasing = histogram[lastIdx] < histogram[lastIdx - 1];
              if (macdAboveSignal && histIncreasing) macdStatus = "bullish";
              else if (!macdAboveSignal && histDecreasing) macdStatus = "bearish";
            }

            // Bollinger Band position
            let bbPosition: "near_lower" | "near_upper" | "middle" = "middle";
            if (!isNaN(bbUpper[lastIdx]) && !isNaN(bbLower[lastIdx])) {
              const bbRange = bbUpper[lastIdx] - bbLower[lastIdx];
              if (bbRange > 0) {
                const pctPosition = (closes[lastIdx] - bbLower[lastIdx]) / bbRange;
                if (pctPosition <= 0.25) bbPosition = "near_lower";
                else if (pctPosition >= 0.75) bbPosition = "near_upper";
              }
            }

            // Volume confirmation
            const vol20 = computeSMA(volumes.map(v => v || 0), 20);
            const lastVol = volumes[lastIdx] || 0;
            const avgVol20 = isNaN(vol20[lastIdx]) ? 0 : vol20[lastIdx];
            const volumeSurge = avgVol20 > 0 && lastVol > avgVol20 * 1.5;

            // ADX
            const lastAdx = isNaN(adxArr[lastIdx]) ? null : Number(adxArr[lastIdx].toFixed(1));
            const adxTrending = lastAdx !== null && lastAdx > 25;
            const adxRanging = lastAdx !== null && lastAdx < 20;

            // Determine confirmation signal
            let bullishCount = 0;
            let bearishCount = 0;
            if (macdStatus === "bullish") bullishCount++; else if (macdStatus === "bearish") bearishCount++;
            if (bbPosition === "near_lower") bullishCount++; else if (bbPosition === "near_upper") bearishCount++;
            if (volumeSurge) { bullishCount++; bearishCount++; } // volume confirms either direction
            if (adxTrending) { bullishCount++; bearishCount++; } // trending confirms either direction

            let confirmationSignal: "CONFIRMED_BUY" | "CONFIRMED_SELL" | "LEAN_BUY" | "LEAN_SELL" | "NEUTRAL" = "NEUTRAL";

            // CONFIRMED_BUY: MACD bullish + price near/below lower BB + volume surge + ADX > 25
            if (macdStatus === "bullish" && bbPosition === "near_lower" && volumeSurge && adxTrending) {
              confirmationSignal = "CONFIRMED_BUY";
            } else if (macdStatus === "bearish" && bbPosition === "near_upper" && volumeSurge && adxTrending) {
              confirmationSignal = "CONFIRMED_SELL";
            } else {
              // Count bullish vs bearish indicators
              let bCount = 0;
              let sCount = 0;
              if (macdStatus === "bullish") bCount++; else if (macdStatus === "bearish") sCount++;
              if (bbPosition === "near_lower") bCount++; else if (bbPosition === "near_upper") sCount++;
              if (volumeSurge) { bCount++; sCount++; } // confirms either
              if (adxTrending) { bCount++; sCount++; } // confirms either

              // For lean signals, check directional indicators (macd + bb) plus confirmations
              let directionalBull = 0;
              let directionalBear = 0;
              if (macdStatus === "bullish") directionalBull++; else if (macdStatus === "bearish") directionalBear++;
              if (bbPosition === "near_lower") directionalBull++; else if (bbPosition === "near_upper") directionalBear++;
              if (volumeSurge) { directionalBull++; directionalBear++; }
              if (adxTrending) { directionalBull++; directionalBear++; }

              if (directionalBull >= 2 && directionalBull > directionalBear) confirmationSignal = "LEAN_BUY";
              else if (directionalBear >= 2 && directionalBear > directionalBull) confirmationSignal = "LEAN_SELL";
              else if (directionalBull >= 2) confirmationSignal = "LEAN_BUY";
              else if (directionalBear >= 2) confirmationSignal = "LEAN_SELL";
            }

            // ---- Scoring ----
            let score = 0;
            // BBTC: ENTER +2, HOLD 0, SELL -2
            if (bbtcTopSignal === "ENTER") score += 2;
            else if (bbtcTopSignal === "SELL") score -= 2;
            // VER: ENTER +2, HOLD 0, SELL -2
            if (verTopSignal === "ENTER") score += 2;
            else if (verTopSignal === "SELL") score -= 2;
            // Confirmation: CONFIRMED_BUY +3, LEAN_BUY +1, NEUTRAL 0, LEAN_SELL -1, CONFIRMED_SELL -3
            if (confirmationSignal === "CONFIRMED_BUY") score += 3;
            else if (confirmationSignal === "LEAN_BUY") score += 1;
            else if (confirmationSignal === "LEAN_SELL") score -= 1;
            else if (confirmationSignal === "CONFIRMED_SELL") score -= 3;

            const alignmentLabel = score >= 5 ? "Strong Buy" : score >= 3 ? "Buy" : score >= 2 ? "Lean Buy" : null;

            // Run 3-Gate System
            let gates = null;
            try {
              const cleanCloses = closes.map((v: any) => Number(v) || 0);
              const cleanHighs = highs.map((v: any) => Number(v) || 0);
              const cleanLows = lows.map((v: any) => Number(v) || 0);
              const cleanVols = volumes.map((v: any) => Number(v) || 0);
              // Use analyzeTicker (not runGateSystem directly) so the scanner
              // goes through the SAME precomputed VER/AMC/BBTC path as
              // Trade Analysis and Watchlist. This is what enables the
              // GATES CLOSED / PULLBACK exit signals to fire consistently.
              gates = analyzeTicker({ ticker, closes: cleanCloses, highs: cleanHighs, lows: cleanLows, volumes: cleanVols, mmeData: null });
            } catch {}

            return {
              ticker,
              price: Number(currentPrice.toFixed(2)),
              score,
              gates: gates ? {
                gatesCleared: gates.gatesCleared,
                confidence: gates.confidence,
                signal: gates.signal,
                direction: gates.direction,
                summary: gates.summary,
                fib: gates.fib ?? null,
                priorSetup: gates.priorSetup ?? null,
              } : null,
              bbtc: { signal: bbtcTopSignal, trend: bbtcTrend, bias: bbtcBias },
              ver: { signal: verTopSignal, rsi: lastRsi },
              confirmation: {
                signal: confirmationSignal,
                macd: macdStatus,
                bollingerPosition: bbPosition,
                volumeSurge,
                adx: lastAdx,
                adxTrending,
              },
              alignmentLabel,
            };
          })
        );

        for (const result of batchResults) {
          if (result.status === "fulfilled" && result.value) {
            allResults.push(result.value);
          }
        }

        // Delay between batches to avoid overwhelming Yahoo Finance
        if (b + 5 < tickers.length) {
          await new Promise(r => setTimeout(r, 500));
        }
      }

      // ── Gate-ready sorting and filtering ──
      // Priority: gates cleared > gate-approaching (high AMC + VER near trigger) > old score as last resort
      const sorted = allResults.sort((a, b) => {
        const aGates = a.gates?.gatesCleared ?? 0;
        const bGates = b.gates?.gatesCleared ?? 0;
        if (aGates !== bGates) return bGates - aGates;

        // Same gate count: sort by RSI extremes (closer to oversold/overbought = closer to Gate 1)
        const aRsi = a.ver?.rsi ?? 50;
        const bRsi = b.ver?.rsi ?? 50;
        const aExtreme = Math.abs(50 - aRsi); // Higher = more extreme
        const bExtreme = Math.abs(50 - bRsi);
        if (aExtreme !== bExtreme) return bExtreme - aExtreme;

        return b.score - a.score;
      });

      // Filter: only show stocks worth looking at
      // - At least 1 gate cleared, OR
      // - Old score >= 5 (Strong Buy by legacy system), OR
      // - showAll mode shows everything scored
      const results = showAll
        ? sorted.slice(0, 50)
        : sorted.filter(r => {
            const gates = r.gates?.gatesCleared ?? 0;
            if (gates >= 1) return true;          // Gate setup active
            if (r.score >= 5) return true;         // Strong signal from legacy
            return false;                          // Everything else is noise
          }).slice(0, 25);

      const payload = {
        scannedAt: new Date().toISOString(),
        totalScanned: tickers.length,
        filters: { minPrice, maxPrice, sector, marketCapTier },
        results,
      };
      setCache(scanCacheKey, payload, TTL.scanner);
      res.json(payload);
    } catch (error: any) {
      console.error("Scanner error:", error?.message || error);
      res.status(500).json({ error: `Scanner failed: ${error?.message || "Unknown error."}` });
    }
  });

  // ============================================================
  // AMC Scanner Route — scores stocks using AMC strategy only
  // ============================================================

  app.get("/api/scanner/amc", checkFeatureAccess('scansPerDay'), async (req, res) => {
    if (checkScanRateLimit(req, res)) return;
    const minPrice = Number(req.query.minPrice) || 5;
    const maxPrice = Number(req.query.maxPrice) || 10000;
    const sector = (req.query.sector as string) || "all";
    const marketCapTier = (req.query.marketCap as string) || "all";
    const scanSize = Math.min(Number(req.query.count) || 100, 200);
    const showAll = req.query.showAll === "true";

    let minMarketCap = 500_000_000;
    let maxMarketCap: number | undefined;
    switch (marketCapTier) {
      case "mega": minMarketCap = 200_000_000_000; break;
      case "large": minMarketCap = 10_000_000_000; maxMarketCap = 200_000_000_000; break;
      case "mid": minMarketCap = 2_000_000_000; maxMarketCap = 10_000_000_000; break;
      case "small": minMarketCap = 300_000_000; maxMarketCap = 2_000_000_000; break;
      default: minMarketCap = 500_000_000; break;
    }

    // Route-level cache: same filter tuple → instant response.
    const amcCacheKey = `scanner:amc:${minPrice}:${maxPrice}:${sector}:${marketCapTier}:${scanSize}:${showAll ? 1 : 0}`;
    {
      const cached = getCached(amcCacheKey);
      if (cached) return res.json(cached);
    }

    try {
      await ensureReady();
      console.log(`[amc-scanner] Screening: price $${minPrice}-$${maxPrice}, sector=${sector}, cap=${marketCapTier}`);

      const tickers = await screenStocks({
        minPrice, maxPrice,
        sector: sector === "all" ? undefined : sector,
        minMarketCap, maxMarketCap,
        count: scanSize,
      });

      if (tickers.length === 0) {
        return res.json({ scannedAt: new Date().toISOString(), totalScanned: 0, filters: { minPrice, maxPrice, sector, marketCapTier }, results: [] });
      }

      console.log(`[amc-scanner] Found ${tickers.length} tickers, running AMC analysis...`);

      const allResults: any[] = [];

      // Batch 20 (was 5) — Polygon Starter has no per-second cap.
      const BATCH = 20;
      for (let b = 0; b < tickers.length; b += BATCH) {
        const batch = tickers.slice(b, b + BATCH);
        const batchResults = await Promise.allSettled(
          batch.map(async (ticker) => {
            const chart = await getChart(ticker, "6mo", "1d");
            if (!chart || !chart.timestamp) return null;

            const quoteData = chart.indicators?.quote?.[0] || {};
            const closes: number[] = quoteData.close || [];
            const highs: number[] = quoteData.high || [];
            const lows: number[] = quoteData.low || [];
            const volumes: number[] = quoteData.volume || [];

            for (let i = 0; i < closes.length; i++) {
              if (closes[i] == null && i > 0) closes[i] = closes[i - 1];
              if (highs[i] == null && i > 0) highs[i] = highs[i - 1];
              if (lows[i] == null && i > 0) lows[i] = lows[i - 1];
              if (volumes[i] == null) volumes[i] = 0;
            }

            if (closes.length < 60) return null;
            const lastIdx = closes.length - 1;
            const currentPrice = closes[lastIdx];

            // Compute AMC indicators
            const { macdLine, signalLine: macdSig, histogram } = computeMACD(closes);
            const rsi14 = computeRSI(closes, 14);
            const ema20 = computeEMA(closes, 20);
            const ema50 = computeEMA(closes, 50);
            const { lower: bbLo, middle: bbMid } = computeBollingerBands(closes);

            // VAMI
            const vamiArr: number[] = new Array(closes.length).fill(0);
            const avgV = computeSMA(volumes.map(v => v || 0), 20);
            for (let i = 1; i < closes.length; i++) {
              if (closes[i-1] === 0 || isNaN(avgV[i]) || avgV[i] === 0) continue;
              const ret = (closes[i] - closes[i-1]) / closes[i-1] * 100;
              const vr = Math.min(2.5, Math.max(0.5, volumes[i] / avgV[i]));
              const k = 2 / (12 + 1);
              vamiArr[i] = ret * vr * k + vamiArr[i-1] * (1 - k);
            }
            const vami = vamiArr.map(v => v * 8);

            // AMC Score + signal (Scanner uses EMA20/EMA50 trend stack + trend-strength,
            // and lower Bollinger band * 1.01 as reversion ceiling.)
            const bbLoScaledS = bbLo.map(v => isNaN(v) ? NaN : v * 1.01);
            const amcRes = computeAMC({
              closes,
              histogram,
              rsi14,
              trendShortEma: ema20,
              trendLongEma: ema50,
              trendStrengthRefEma: ema50,
              vamiScaled: vami,
              reversionRefLevel: bbLoScaledS,
              reversionDirection: "below",
            });
            const li = lastIdx;
            const amcScore = amcRes.score;
            const greenClose = amcRes.greenClose;
            const signal: "ENTER" | "HOLD" | "SELL" = amcRes.signal;
            const mode: "momentum" | "reversion" | "flat" = amcRes.mode;

            const vamiVal = Number(vami[li]?.toFixed(2) || 0);
            const rsiVal = isNaN(rsi14[li]) ? null : Number(rsi14[li].toFixed(1));

            // Trend direction
            const trend: "UP" | "DOWN" | "SIDEWAYS" = 
              !isNaN(ema20[li]) && !isNaN(ema50[li])
                ? (closes[li] > ema20[li] && ema20[li] > ema50[li] ? "UP"
                   : closes[li] < ema20[li] && ema20[li] < ema50[li] ? "DOWN" : "SIDEWAYS")
                : "SIDEWAYS";

            const label = amcScore >= 5 ? "Strong Entry" : amcScore >= 4 ? "Entry" : amcScore >= 3 ? "Near Entry" : null;

            return {
              ticker,
              price: Number(currentPrice.toFixed(2)),
              amcScore,
              signal,
              mode,
              trend,
              vami: vamiVal,
              rsi: rsiVal,
              macd: !isNaN(histogram[li]) ? (histogram[li] > 0 ? "bullish" : "bearish") : "neutral",
              macdAccel: !isNaN(histogram[li]) && !isNaN(histogram[li-1]) && histogram[li] > histogram[li-1],
              greenClose,
              label,
            };
          })
        );

        for (const result of batchResults) {
          if (result.status === "fulfilled" && result.value) {
            allResults.push(result.value);
          }
        }

        if (b + 5 < tickers.length) {
          await new Promise(r => setTimeout(r, 500));
        }
      }

      // Sort by AMC score descending, then by VAMI
      const sorted = allResults.sort((a, b) => b.amcScore - a.amcScore || b.vami - a.vami);
      const results = showAll ? sorted.slice(0, 50) : sorted.filter(r => r.amcScore >= 3).slice(0, 20);

      const payload = {
        scannedAt: new Date().toISOString(),
        totalScanned: tickers.length,
        filters: { minPrice, maxPrice, sector, marketCapTier },
        results,
      };
      setCache(amcCacheKey, payload, TTL.scanner);
      res.json(payload);
    } catch (error: any) {
      console.error("AMC Scanner error:", error?.message || error);
      res.status(500).json({ error: `AMC Scanner failed: ${error?.message || "Unknown error."}` });
    }
  });

  // Refresh scores for all favorites in a list
  app.post("/api/favorites/:listType/refresh", async (req, res) => {
    try {
      await ensureReady();
      const listType = req.params.listType;
      const items = await storage.getFavorites(req.user!.id, listType);
      const force = String(req.query.force || "") === "1";
      const results: any[] = [];

      // Partition: cached vs needs-compute. Per-ticker gate cache with 15min TTL.
      // Force=1 (manual Refresh button) bypasses cache; normal page loads reuse.
      const toCompute: typeof items = [];
      for (const item of items) {
        const key = `watchlist:gate:${item.ticker.toUpperCase()}`;
        const cached = force ? null : getCached(key);
        if (cached) {
          results.push({ ...item, score: cached.score, verdict: cached.verdict });
        } else {
          toCompute.push(item);
        }
      }

      // Process in batches of 3 with delays to avoid rate limits
      for (let b = 0; b < toCompute.length; b += 3) {
        const batch = toCompute.slice(b, b + 3);
        const batchResults = await Promise.allSettled(
          batch.map(async (item) => {
            try {
              const chart6m = await getChart(item.ticker, "6mo", "1d");
              if (!chart6m || !chart6m.timestamp) {
                console.log(`[watchlist-refresh] ${item.ticker}: no chart data`);
                return { ...item };
              }
              const q = chart6m.indicators?.quote?.[0] || {};
              const closes = (q.close || []).map((v: any) => Number(v) || 0);
              const highs = (q.high || []).map((v: any) => Number(v) || 0);
              const lows = (q.low || []).map((v: any) => Number(v) || 0);
              const vols = (q.volume || []).map((v: any) => Number(v) || 0);
              if (closes.length < 60) {
                console.log(`[watchlist-refresh] ${item.ticker}: only ${closes.length} bars`);
                return { ...item };
              }
              // Use unified analyzer so watchlist signals match Trade Analysis exactly
              const gateResult = analyzeTicker({ ticker: item.ticker, closes, highs, lows, volumes: vols, mmeData: null });
              const score = gateResult.gatesCleared;
              const verdict = gateResult.signal;
              await storage.updateFavoriteScore(req.user!.id, item.ticker, listType, score, verdict);
              setCache(`watchlist:gate:${item.ticker.toUpperCase()}`, { score, verdict }, TTL.watchlist);
              console.log(`[watchlist-refresh] ${item.ticker}: ${verdict} (${score} gates)`);
              return { ...item, score, verdict };
            } catch (err: any) {
              console.error(`[watchlist-refresh] ${item.ticker} error:`, err?.message);
              return { ...item };
            }
          })
        );
        for (const r of batchResults) {
          results.push(r.status === "fulfilled" ? r.value : toCompute[b]);
        }
        if (b + 3 < toCompute.length) {
          await new Promise(r => setTimeout(r, 1000)); // 1s between batches
        }
      }

      res.json(results);
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Failed to refresh scores" });
    }
  });

  // ================================================================
  // UNIFIED VERDICT / RESEARCH REPORT
  // ================================================================

  // Define historical stress events with date ranges
  const STRESS_EVENTS = [
    { name: "Dot-Com Crash", start: "2000-03-10", end: "2002-10-09", desc: "Tech bubble burst" },
    { name: "9/11 Attacks", start: "2001-09-10", end: "2001-10-11", desc: "Terrorist attacks & market shutdown" },
    { name: "2008 Financial Crisis", start: "2007-10-09", end: "2009-03-09", desc: "Subprime mortgage collapse" },
    { name: "2011 Debt Crisis", start: "2011-05-02", end: "2011-10-03", desc: "US debt ceiling & EU sovereign debt" },
    { name: "COVID Crash", start: "2020-02-19", end: "2020-03-23", desc: "Global pandemic selloff" },
    { name: "2022 Rate Hikes", start: "2022-01-03", end: "2022-10-12", desc: "Fed aggressive rate increases" },
    { name: "2025 Tariff Crash", start: "2025-02-19", end: "2025-04-07", desc: "Trump tariffs & global retaliation" },
  ];

  // Stress test: compare ticker vs SPY vs Gold vs Silver during each event
  app.get("/api/verdict/:ticker", async (req, res) => {
    try {
      await ensureReady();
      const ticker = req.params.ticker.toUpperCase();

      // Route-level cache: 1h TTL per ticker. Verdict is long-term outlook;
      // recomputing it for every page load (7+ chart fetches) is pure waste.
      const verdictCacheKey = `verdict:${ticker}`;
      const verdictCached = getCached(verdictCacheKey);
      if (verdictCached) return res.json(verdictCached);

      const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

      // Batch 1: Core ticker data (analysis + institutional)
      const [analysisRes, instRes] = await Promise.allSettled([
        (async () => {
          const summary = await getQuote(ticker);
          if (!summary) return null;
          const { quote, financials } = extractQuoteData(summary);
          await delay(300);
          const chart1Y = await getChart(ticker, "1y", "1d").catch(() => null);
          const { computedReturn: ret1Y } = extractChartData(chart1Y);
          const historicalReturns = { oneYear: ret1Y, threeYear: null, fiveYear: null };
          const fullData = { quote, financials, historicalReturns };
          const scoring = computeScoring(fullData);
          const weightedScore = scoring.reduce((sum, cat) => sum + cat.score * cat.weight, 0);
          const { verdict, ruling } = computeVerdict(weightedScore);
          return { score: weightedScore, verdict, ruling, scoring, quote, financials };
        })(),
        (async () => {
          await delay(500);
          const raw = await getInstitutionalData(ticker);
          return parseInstitutionalData(raw, ticker);
        })(),
      ]);

      // Batch 2: Historical charts for stress test (sequentially with delays)
      await delay(500);
      const tickerChart = await getChart(ticker, "25y", "1mo").catch(() => null);
      await delay(400);
      const spyChart = await getChart("SPY", "25y", "1mo").catch(() => null);
      await delay(400);
      const goldChart = await getChart("GC=F", "25y", "1mo").catch(() => null);
      await delay(400);
      const silverChart = await getChart("SI=F", "25y", "1mo").catch(() => null);

      const stratRes = { status: "fulfilled" as const, value: null };

      const analysis = analysisRes.status === "fulfilled" ? analysisRes.value : null;
      const institutional = instRes.status === "fulfilled" ? instRes.value : null;
      const strategies = stratRes.value;

      // If the primary analysis failed (bad ticker), return 404 early
      if (!analysis && !institutional) {
        return res.status(404).json({ error: `Ticker "${ticker}" not found or no data available.` });
      }

      // Build stress test comparison
      function getReturnDuringPeriod(chart: any, startDate: string, endDate: string): number | null {
        if (!chart?.timestamp || !chart?.indicators?.quote?.[0]?.close) return null;
        const closes = chart.indicators.quote[0].close;
        const timestamps = chart.timestamp;
        const startTs = new Date(startDate).getTime() / 1000;
        const endTs = new Date(endDate).getTime() / 1000;

        let startPrice: number | null = null;
        let endPrice: number | null = null;
        for (let i = 0; i < timestamps.length; i++) {
          if (timestamps[i] >= startTs && startPrice === null && closes[i]) startPrice = closes[i];
          if (timestamps[i] <= endTs && closes[i]) endPrice = closes[i];
        }
        if (!startPrice || !endPrice) return null;
        return ((endPrice - startPrice) / startPrice) * 100;
      }

      const stressTests = STRESS_EVENTS.map(event => ({
        name: event.name,
        desc: event.desc,
        period: `${event.start.substring(0, 7)} to ${event.end.substring(0, 7)}`,
        ticker: getReturnDuringPeriod(tickerChart, event.start, event.end) ?? 0,
        spy: getReturnDuringPeriod(spyChart, event.start, event.end) ?? 0,
        gold: getReturnDuringPeriod(goldChart, event.start, event.end) ?? 0,
        silver: getReturnDuringPeriod(silverChart, event.start, event.end) ?? 0,
        hasData: getReturnDuringPeriod(tickerChart, event.start, event.end) !== null,
      }));

      // Current metals data
      // Metals quotes (sequential to avoid rate limits)
      await delay(400);
      const goldQuote = await getQuote("GC=F").catch(() => null);
      await delay(400);
      const silverQuote = await getQuote("SI=F").catch(() => null);
      await delay(400);
      const spyQuote = await getQuote("SPY").catch(() => null);

      const goldPrice = goldQuote?.price || null;
      const silverPrice = silverQuote?.price || null;
      const spyPrice = spyQuote?.price || null;

      // Compute unified verdict score (0-100)
      // Weighted combination of: analysis score, institutional flow, strategy alignment
      let unifiedScore = 50; // neutral baseline
      const factors: { name: string; score: number; weight: number; signal: string; color: string }[] = [];

      if (analysis) {
        const s = Math.round(analysis.score * 10); // 0-100
        // analysis.verdict is one of: STRONG CONVICTION, INVESTMENT GRADE,
        // SPECULATIVE, HIGH RISK (from computeVerdict). The previous code
        // compared against "YES"/"NO" which never matched, so the pill was
        // always yellow.
        const v = analysis.verdict;
        const color =
          v === "STRONG CONVICTION" || v === "INVESTMENT GRADE" ? "green" :
          v === "HIGH RISK" ? "red" :
          "yellow";
        factors.push({ name: "Fundamental Analysis", score: s, weight: 0.30, signal: v, color });
      }

      if (institutional) {
        const s = Math.round((institutional.flowScore + 100) / 2); // -100..100 → 0..100
        factors.push({ name: "Institutional Flow", score: s, weight: 0.25, signal: institutional.signal, color: institutional.flowScore >= 15 ? "green" : institutional.flowScore <= -15 ? "red" : "yellow" });
      }

      if (strategies) {
        // Count bullish vs bearish strategy signals
        let bullish = 0, bearish = 0;
        for (const strat of Object.values(strategies) as any[]) {
          if (strat?.signal?.includes("BUY") || strat?.signal?.includes("ENTER")) bullish++;
          if (strat?.signal?.includes("SELL")) bearish++;
        }
        const total = bullish + bearish;
        const s = total > 0 ? Math.round((bullish / total) * 100) : 50;
        const sig = bullish > bearish ? "BULLISH" : bearish > bullish ? "BEARISH" : "MIXED";
        factors.push({ name: "Strategy Signals", score: s, weight: 0.20, signal: sig, color: sig === "BULLISH" ? "green" : sig === "BEARISH" ? "red" : "yellow" });
      }

      // Stress resilience score based on historical performance
      const validStress = stressTests.filter(s => s.hasData);
      if (validStress.length > 0) {
        const beatCount = validStress.filter(s => (s.ticker || 0) > (s.spy || 0)).length;
        const s = Math.round((beatCount / validStress.length) * 100);
        factors.push({ name: "Stress Resilience", score: s, weight: 0.15, signal: s >= 60 ? "RESILIENT" : s <= 30 ? "FRAGILE" : "AVERAGE", color: s >= 60 ? "green" : s <= 30 ? "red" : "yellow" });
      }

      // Insider confidence
      if (institutional) {
        const netBuy = institutional.insiderBuyCount - institutional.insiderSellCount;
        const s = Math.max(0, Math.min(100, 50 + netBuy * 10));
        factors.push({ name: "Insider Confidence", score: s, weight: 0.10, signal: netBuy > 2 ? "BUYING" : netBuy < -2 ? "SELLING" : "NEUTRAL", color: netBuy > 2 ? "green" : netBuy < -2 ? "red" : "yellow" });
      }

      // Calculate unified score. NOTE: post-Polygon migration, some factors
      // (institutional, strategies, stress, insider) can silently drop out
      // when Yahoo endpoints are blocked or 25y history is unavailable.
      // Re-normalize across the factors that actually contributed so we
      // don't default to SPECULATIVE just because data is missing.
      const totalWeight = factors.reduce((s, f) => s + f.weight, 0);
      if (totalWeight > 0) {
        unifiedScore = Math.round(factors.reduce((s, f) => s + f.score * f.weight, 0) / totalWeight);
      }

      // If only one or two factors contributed (common when Yahoo data is
      // unavailable), nudge the buckets wider so the verdict is not
      // artificially pessimistic.
      const factorsContributed = factors.length;
      const narrowEvidence = factorsContributed <= 2;

      // Final verdict
      let finalVerdict = "SPECULATIVE";
      let verdictColor = "yellow";
      // Thresholds widen by 5 points in each direction when evidence is thin
      const strongCutoff = narrowEvidence ? 65 : 70;
      const investCutoff = narrowEvidence ? 50 : 55;
      const highRiskCutoff = narrowEvidence ? 25 : 30;
      const specCutoff = narrowEvidence ? 35 : 40;
      if (unifiedScore >= strongCutoff) { finalVerdict = "STRONG CONVICTION"; verdictColor = "green"; }
      else if (unifiedScore >= investCutoff) { finalVerdict = "INVESTMENT GRADE"; verdictColor = "green"; }
      else if (unifiedScore <= highRiskCutoff) { finalVerdict = "HIGH RISK"; verdictColor = "red"; }
      else if (unifiedScore <= specCutoff) { finalVerdict = "SPECULATIVE"; verdictColor = "yellow"; }

      const verdictPayload = {
        ticker,
        companyName: analysis?.quote?.companyName || institutional?.companyName || ticker,
        price: analysis?.quote?.price || institutional?.currentPrice || 0,
        marketCap: analysis?.quote?.marketCap || institutional?.marketCap || 0,

        // Unified verdict
        unifiedScore,
        finalVerdict,
        verdictColor,
        factors,

        // Component data
        analysis: analysis ? {
          score: analysis.score,
          verdict: analysis.verdict,
          scoring: analysis.scoring,
        } : null,
        institutional: institutional ? {
          flowScore: institutional.flowScore,
          signal: institutional.signal,
          institutionPct: institutional.institutionPct,
          insiderPct: institutional.insiderPct,
          instIncreased: institutional.instIncreased,
          instDecreased: institutional.instDecreased,
          insiderBuyCount: institutional.insiderBuyCount,
          insiderSellCount: institutional.insiderSellCount,
        } : null,
        strategies,

        // Stress tests
        stressTests,

        // Metals comparison
        metals: {
          gold: {
            price: goldPrice?.regularMarketPrice?.raw || 0,
            change: goldPrice?.regularMarketChangePercent?.raw || 0,
            name: "Gold",
          },
          silver: {
            price: silverPrice?.regularMarketPrice?.raw || 0,
            change: silverPrice?.regularMarketChangePercent?.raw || 0,
            name: "Silver",
          },
          spy: {
            price: spyPrice?.regularMarketPrice?.raw || 0,
            change: spyPrice?.regularMarketChangePercent?.raw || 0,
            name: "S&P 500",
          },
        },
      };
      setCache(verdictCacheKey, verdictPayload, TTL.verdict);
      res.json(verdictPayload);
    } catch (error: any) {
      console.error("Verdict error:", error?.message || error);
      res.status(500).json({ error: error?.message || "Failed to generate verdict" });
    }
  });

  // ================================================================
  // INSTITUTIONAL / MONEY FLOW API ROUTES
  // ================================================================

  // Get institutional data for a single ticker
  app.get("/api/institutional/:ticker", async (req, res) => {
    try {
      await ensureReady();
      const ticker = req.params.ticker.toUpperCase();
      const raw = await getInstitutionalData(ticker);
      const parsed = parseInstitutionalData(raw, ticker);
      if (!parsed) return res.status(404).json({ error: `No institutional data for ${ticker}` });
      res.json(parsed);
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Failed to fetch institutional data" });
    }
  });

  // Scan multiple tickers for institutional money flow (batch)
  app.get("/api/institutional-scan", checkFeatureAccess('scansPerDay'), async (req, res) => {
    if (checkScanRateLimit(req, res)) return;
    try {
      await ensureReady();

      const refresh = req.query.refresh === "1" || req.query.refresh === "true";
      const tickerParam = req.query.tickers as string | undefined;
      const customTickers = tickerParam
        ? tickerParam.split(",").map(t => t.trim().toUpperCase()).filter(Boolean)
        : null;

      // Resolve universe: custom tickers from query OR full Polygon universe (cached 24h)
      const UNIVERSE_TTL = 24 * 60 * 60 * 1000; // 24h
      const universeCacheKey = "polygon:universe:500m";
      let tickers: string[];
      if (customTickers && customTickers.length) {
        tickers = customTickers.slice(0, 500); // safety cap on custom lists
      } else {
        const cachedUniverse = getCached(universeCacheKey);
        if (cachedUniverse && !refresh) {
          tickers = cachedUniverse;
        } else {
          console.log("[institutional-scan] Fetching Polygon universe...");
          tickers = await getPolygonUniverse({ minMarketCap: 500_000_000 });
          setCache(universeCacheKey, tickers, UNIVERSE_TTL);
        }
      }

      // Aggregated result cache (6h) — keyed by universe signature
      const SCAN_CACHE_TTL = 6 * 60 * 60 * 1000; // 6h
      const scanCacheKey = customTickers
        ? `institutional-scan:custom:${customTickers.slice().sort().join(",")}`
        : `institutional-scan:universe:500m`;

      if (!refresh) {
        const cached = getCached(scanCacheKey);
        if (cached) {
          res.setHeader("X-Scanned-At", cached.scannedAt);
          res.setHeader("X-Total-Scanned", String(cached.totalScanned));
          res.setHeader("X-Dividend-Payers", String(cached.dividendPayers));
          res.setHeader("X-Matching-Filters", String(cached.matchingFilters));
          res.setHeader("X-Cached", "true");
          return res.json(cached.results);
        }
      }

      console.log(`[institutional-scan] Scanning ${tickers.length} tickers (refresh=${refresh})`);
      const scanStart = Date.now();
      const results: any[] = [];

      // Parallel batches of 5 — the enqueue() queue in yahooFetch will serialize
      // Yahoo calls at a safe rate, but running batches in parallel lets us
      // overlap retry-backoff windows.
      const BATCH_SIZE = 5;
      for (let b = 0; b < tickers.length; b += BATCH_SIZE) {
        const batch = tickers.slice(b, b + BATCH_SIZE);
        const batchResults = await Promise.allSettled(batch.map(async (ticker) => {
          try {
            const raw = await getInstitutionalData(ticker);
            return parseInstitutionalData(raw, ticker);
          } catch {
            return null;
          }
        }));
        for (const r of batchResults) {
          if (r.status === "fulfilled" && r.value) results.push(r.value);
        }
        // Log progress every 10 batches (~50 tickers)
        if ((b / BATCH_SIZE) % 10 === 0) {
          console.log(`[institutional-scan] Progress: ${b + batch.length}/${tickers.length} (${results.length} with data)`);
        }
      }

      // Sort by absolute flow score (strongest moves first)
      results.sort((a, b) => Math.abs(b.flowScore) - Math.abs(a.flowScore));

      const elapsed = Date.now() - scanStart;
      console.log(`[institutional-scan] Complete: ${results.length}/${tickers.length} with data in ${elapsed}ms`);

      const payload = {
        scannedAt: new Date().toISOString(),
        lastScannedAt: new Date().toISOString(),
        totalScanned: tickers.length,
        withData: results.length,
        elapsedMs: elapsed,
        cacheTtlMinutes: SCAN_CACHE_TTL / 60000,
        results,
      };
      setCache(scanCacheKey, payload, SCAN_CACHE_TTL);
      res.json({ ...payload, cached: false });
    } catch (error: any) {
      console.error("[institutional-scan] Error:", error);
      res.status(500).json({ error: error?.message || "Institutional scan failed" });
    }
  });

  // ================================================================
  // SECTOR ROTATION HEATMAP
  // ================================================================

  const SECTOR_ETFS = [
    { symbol: "XLK", name: "Technology" },
    { symbol: "XLF", name: "Financials" },
    { symbol: "XLV", name: "Healthcare" },
    { symbol: "XLE", name: "Energy" },
    { symbol: "XLY", name: "Consumer Discretionary" },
    { symbol: "XLP", name: "Consumer Staples" },
    { symbol: "XLI", name: "Industrials" },
    { symbol: "XLU", name: "Utilities" },
    { symbol: "XLB", name: "Materials" },
    { symbol: "XLRE", name: "Real Estate" },
    { symbol: "XLC", name: "Communication Services" },
  ];

  app.get("/api/sectors", async (_req, res) => {
    try {
      await ensureReady();
      const results: any[] = [];

      for (const etf of SECTOR_ETFS) {
        try {
          const chart = await getChart(etf.symbol, "3mo", "1d");
          if (!chart) continue;

          const closes: number[] = (chart.indicators?.quote?.[0]?.close || []).filter((c: any) => c != null);
          if (closes.length < 2) continue;

          const last = closes[closes.length - 1];
          const prev = closes[closes.length - 2];
          const week1Idx = Math.max(0, closes.length - 6);
          const month1Idx = Math.max(0, closes.length - 22);
          const first = closes[0];

          results.push({
            symbol: etf.symbol,
            name: etf.name,
            price: Math.round(last * 100) / 100,
            change: Math.round((last - prev) * 100) / 100,
            returns: {
              day1: prev > 0 ? Math.round((last - prev) / prev * 10000) / 100 : 0,
              week1: closes[week1Idx] > 0 ? Math.round((last - closes[week1Idx]) / closes[week1Idx] * 10000) / 100 : 0,
              month1: closes[month1Idx] > 0 ? Math.round((last - closes[month1Idx]) / closes[month1Idx] * 10000) / 100 : 0,
              month3: first > 0 ? Math.round((last - first) / first * 10000) / 100 : 0,
            },
          });

          await new Promise(r => setTimeout(r, 400));
        } catch (e: any) {
          console.log(`[sectors] ${etf.symbol} failed: ${e?.message}`);
        }
      }

      res.json(results);
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Sector data fetch failed" });
    }
  });

  // ================================================================
  // EARNINGS CALENDAR
  // ================================================================

  app.get("/api/earnings-calendar", async (req, res) => {
    try {
      await ensureReady();
      const watchlistItems = await storage.getFavorites(req.user!.id, "watchlist");
      if (!watchlistItems.length) {
        return res.json([]);
      }

      // Route-level cache: same user + same watchlist tickers → instant response.
      // Earnings dates don't move intraday, so 4h TTL is safe.
      const tickerKey = watchlistItems.map(i => i.ticker.toUpperCase()).sort().join(",");
      const cacheKey = `earnings:${req.user!.id}:${tickerKey}`;
      const cached = getCached(cacheKey);
      if (cached) {
        return res.json(cached);
      }

      // Polygon-backed earnings rows. Fetch in parallel (batches of 5 to stay
      // under the free-tier 5-rps limit) instead of the old sequential
      // Yahoo loop with 400ms sleeps.
      const BATCH = 5;
      const results: any[] = [];
      for (let i = 0; i < watchlistItems.length; i += BATCH) {
        const slice = watchlistItems.slice(i, i + BATCH);
        const rows = await Promise.all(
          slice.map((item) => getPolygonEarningsRow(item.ticker))
        );
        for (const row of rows) {
          if (row) results.push(row);
        }
      }

      setCache(cacheKey, results, TTL.earnings);
      res.json(results);
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Earnings calendar fetch failed" });
    }
  });

  // ================================================================
  // TRADE ANALYTICS (MFE/MAE)
  // ================================================================

  app.get("/api/trades/analytics", async (req, res) => {
    try {
      const allTrades = await storage.getAllTrades(req.user!.id);
      const closedTrades = allTrades.filter(t => t.closeDate);

      if (closedTrades.length === 0) {
        return res.json({
          totalTrades: 0, wins: 0, losses: 0, winRate: 0,
          avgWin: 0, avgLoss: 0, largestWin: 0, largestLoss: 0,
          profitFactor: 0, expectancy: 0,
          avgRWin: 0, avgRLoss: 0,
          currentStreak: 0, longestWinStreak: 0, longestLossStreak: 0,
          byType: {}, byDayOfWeek: {}, monthlyPL: {},
          trades: [], exitEfficiency: [],
          durationAnalysis: {
            dayTrades: { count: 0, wins: 0, winRate: 0, totalPL: 0, avgPL: 0, avgDays: 0 },
            shortTerm: { count: 0, wins: 0, winRate: 0, totalPL: 0, avgPL: 0, avgDays: 0 },
            swingTrades: { count: 0, wins: 0, winRate: 0, totalPL: 0, avgPL: 0, avgDays: 0 },
            longTerm: { count: 0, wins: 0, winRate: 0, totalPL: 0, avgPL: 0, avgDays: 0 },
          },
        });
      }

      // Compute P/L and R-multiples for each trade
      const tradeData = closedTrades.map(t => {
        const multiplier = t.tradeCategory === "Option" ? 100 : 1;
        const costToOpen = t.openPrice * t.contractsShares * multiplier;
        const costToClose = (t.closePrice || 0) * t.contractsShares * multiplier;
        const profit = costToOpen + costToClose - (t.commIn || 0) - (t.commOut || 0);
        const isWin = profit >= 0;

        // Initial risk calculation
        let initialRisk: number;
        const absOpen = Math.abs(t.openPrice);
        if (t.spreadWidth && t.spreadWidth > 0 && t.tradeCategory === "Option") {
          if (t.openPrice > 0) {
            // Credit spread
            initialRisk = (t.spreadWidth - absOpen) * t.contractsShares * 100;
          } else {
            // Debit spread
            initialRisk = absOpen * t.contractsShares * 100;
          }
        } else if (t.tradeCategory === "Option") {
          initialRisk = absOpen * t.contractsShares * 100;
        } else {
          initialRisk = absOpen * t.contractsShares;
        }

        const rMultiple = initialRisk > 0 ? profit / initialRisk : 0;

        // MFE / MAE estimation
        const mfe = t.maxProfit != null ? t.maxProfit : (t.spreadWidth ? t.spreadWidth * t.contractsShares * 100 - initialRisk : Math.abs(profit));
        const mae = initialRisk;
        const exitEfficiency = mfe > 0 ? profit / mfe : 0;

        return {
          id: t.id,
          symbol: t.symbol,
          tradeType: t.tradeType,
          tradeDate: t.tradeDate,
          closeDate: t.closeDate!,
          profit,
          isWin,
          initialRisk,
          rMultiple: Math.round(rMultiple * 100) / 100,
          mfe,
          mae,
          exitEfficiency: Math.round(exitEfficiency * 10000) / 100,
        };
      });

      const wins = tradeData.filter(t => t.isWin);
      const losses = tradeData.filter(t => !t.isWin);

      const grossProfits = wins.reduce((s, t) => s + t.profit, 0);
      const grossLosses = Math.abs(losses.reduce((s, t) => s + t.profit, 0));

      const avgWin = wins.length > 0 ? grossProfits / wins.length : 0;
      const avgLoss = losses.length > 0 ? grossLosses / losses.length : 0;
      const winRate = tradeData.length > 0 ? wins.length / tradeData.length : 0;
      const lossRate = 1 - winRate;

      // Streaks
      let currentStreak = 0;
      let longestWinStreak = 0;
      let longestLossStreak = 0;
      let ws = 0, ls = 0;
      const sorted = [...tradeData].sort((a, b) => a.closeDate.localeCompare(b.closeDate));
      for (const t of sorted) {
        if (t.isWin) { ws++; ls = 0; longestWinStreak = Math.max(longestWinStreak, ws); }
        else { ls++; ws = 0; longestLossStreak = Math.max(longestLossStreak, ls); }
      }
      if (sorted.length > 0) {
        const lastWin = sorted[sorted.length - 1].isWin;
        currentStreak = lastWin ? ws : -ls;
      }

      // Performance by trade type
      const byType: Record<string, { profit: number; count: number; wins: number; avgR: number }> = {};
      for (const t of tradeData) {
        if (!byType[t.tradeType]) byType[t.tradeType] = { profit: 0, count: 0, wins: 0, avgR: 0 };
        const entry = byType[t.tradeType];
        entry.profit += t.profit;
        entry.count++;
        if (t.isWin) entry.wins++;
        entry.avgR += t.rMultiple;
      }
      for (const key of Object.keys(byType)) {
        byType[key].avgR = byType[key].count > 0 ? Math.round(byType[key].avgR / byType[key].count * 100) / 100 : 0;
      }

      // Performance by day of week
      const byDayOfWeek: Record<string, { profit: number; count: number; wins: number }> = {};
      const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      for (const t of tradeData) {
        const day = dayNames[new Date(t.tradeDate).getDay()];
        if (!byDayOfWeek[day]) byDayOfWeek[day] = { profit: 0, count: 0, wins: 0 };
        byDayOfWeek[day].profit += t.profit;
        byDayOfWeek[day].count++;
        if (t.isWin) byDayOfWeek[day].wins++;
      }

      // Monthly P/L breakdown
      const monthlyPL: Record<string, number> = {};
      for (const t of tradeData) {
        const month = t.closeDate.substring(0, 7); // YYYY-MM
        monthlyPL[month] = (monthlyPL[month] || 0) + t.profit;
      }

      // Exit efficiency data
      const exitEfficiency = tradeData.map(t => ({
        symbol: t.symbol,
        tradeType: t.tradeType,
        profit: Math.round(t.profit * 100) / 100,
        mfe: Math.round(t.mfe * 100) / 100,
        efficiency: t.exitEfficiency,
      }));

      const allProfits = tradeData.map(t => t.profit);

      // Position Duration Analysis
      const closedWithDates = tradeData.filter(t => t.tradeDate && t.closeDate);

      const daysBetween = (d1: string, d2: string): number =>
        Math.round((new Date(d2).getTime() - new Date(d1).getTime()) / (1000 * 60 * 60 * 24));

      const dayTradesGroup = closedWithDates.filter(t => daysBetween(t.tradeDate, t.closeDate) === 0);
      const shortTermGroup = closedWithDates.filter(t => { const d = daysBetween(t.tradeDate, t.closeDate); return d >= 1 && d <= 7; });
      const swingTradesGroup = closedWithDates.filter(t => { const d = daysBetween(t.tradeDate, t.closeDate); return d > 7 && d <= 45; });
      const longTermGroup = closedWithDates.filter(t => daysBetween(t.tradeDate, t.closeDate) > 45);

      const analyzeGroup = (groupTrades: typeof tradeData) => {
        if (groupTrades.length === 0) return { count: 0, wins: 0, winRate: 0, totalPL: 0, avgPL: 0, avgDays: 0 };
        const gWins = groupTrades.filter(t => t.isWin).length;
        const totalPL = groupTrades.reduce((s, t) => s + t.profit, 0);
        const avgDays = groupTrades.reduce((s, t) => s + daysBetween(t.tradeDate, t.closeDate), 0) / groupTrades.length;
        return {
          count: groupTrades.length,
          wins: gWins,
          winRate: groupTrades.length > 0 ? Number((gWins / groupTrades.length).toFixed(4)) : 0,
          totalPL: Number(totalPL.toFixed(2)),
          avgPL: Number((totalPL / groupTrades.length).toFixed(2)),
          avgDays: Number(avgDays.toFixed(1)),
        };
      };

      const durationAnalysis = {
        dayTrades: analyzeGroup(dayTradesGroup),
        shortTerm: analyzeGroup(shortTermGroup),
        swingTrades: analyzeGroup(swingTradesGroup),
        longTerm: analyzeGroup(longTermGroup),
      };

      res.json({
        totalTrades: tradeData.length,
        wins: wins.length,
        losses: losses.length,
        winRate: Math.round(winRate * 10000) / 100,
        avgWin: Math.round(avgWin * 100) / 100,
        avgLoss: Math.round(avgLoss * 100) / 100,
        largestWin: Math.round(Math.max(...allProfits) * 100) / 100,
        largestLoss: Math.round(Math.min(...allProfits) * 100) / 100,
        profitFactor: grossLosses > 0 ? Math.round(grossProfits / grossLosses * 100) / 100 : grossProfits > 0 ? Infinity : 0,
        expectancy: Math.round((winRate * avgWin - lossRate * avgLoss) * 100) / 100,
        avgRWin: wins.length > 0 ? Math.round(wins.reduce((s, t) => s + t.rMultiple, 0) / wins.length * 100) / 100 : 0,
        avgRLoss: losses.length > 0 ? Math.round(losses.reduce((s, t) => s + t.rMultiple, 0) / losses.length * 100) / 100 : 0,
        currentStreak,
        longestWinStreak,
        longestLossStreak,
        byType,
        byDayOfWeek,
        monthlyPL,
        trades: tradeData,
        exitEfficiency,
        durationAnalysis,
      });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Failed to compute analytics" });
    }
  });

  // ================================================================
  // TRADE TRACKER API ROUTES
  // ================================================================

  // IMPORTANT: Static routes MUST come before parameterized /:id routes

  // MFE/MAE analysis route
  app.get("/api/trades/mfe-mae", async (req, res) => {
    try {
      const mfeData = await storage.getTradesMFEMAE(req.user!.id);
      const allHistory = await storage.getPriceHistoryForUser(req.user!.id);

      // Group history by tradeId
      const historyByTrade: Record<number, {date: string; pl: number}[]> = {};
      for (const h of allHistory) {
        if (!historyByTrade[h.tradeId]) historyByTrade[h.tradeId] = [];
        historyByTrade[h.tradeId].push({ date: h.date, pl: h.unrealizedPL || 0 });
      }

      // Get trade details for context
      const allTrades = await storage.getAllTrades(req.user!.id);
      const tradeMap = new Map(allTrades.map(t => [t.id, t]));

      const enriched = mfeData.map(m => {
        const trade = tradeMap.get(m.tradeId);
        return {
          ...m,
          symbol: trade?.symbol || "?",
          tradeType: trade?.tradeType || "?",
          openPrice: trade?.openPrice || 0,
          closePrice: trade?.closePrice || 0,
          history: historyByTrade[m.tradeId] || [],
        };
      });

      // Aggregate stats
      const avgMFE = mfeData.length > 0 ? mfeData.reduce((s, m) => s + m.mfe, 0) / mfeData.length : 0;
      const avgMAE = mfeData.length > 0 ? mfeData.reduce((s, m) => s + m.mae, 0) / mfeData.length : 0;
      const avgExitEff = mfeData.length > 0 ? mfeData.reduce((s, m) => s + m.exitEfficiency, 0) / mfeData.length : 0;

      res.json({
        trades: enriched,
        summary: {
          avgMFE: Number(avgMFE.toFixed(2)),
          avgMAE: Number(avgMAE.toFixed(2)),
          avgExitEfficiency: Number(avgExitEff.toFixed(1)),
          totalTracked: mfeData.length,
        },
      });
    } catch (error: any) {
      console.error("MFE/MAE error:", error?.message);
      res.status(500).json({ error: "Failed to calculate MFE/MAE" });
    }
  });

  // Get trade summary stats
  app.get("/api/trades/summary", async (req, res) => {
    try {
      const allTrades = await storage.getAllTrades(req.user!.id);
      const settings = await storage.getAccountSettings(req.user!.id);
      const transactions = await storage.getAccountTransactions(req.user!.id);

      const closedTrades = allTrades.filter(t => t.closeDate);
      const openTrades = allTrades.filter(t => !t.closeDate);

      // Compute P/L for each closed trade
      const tradeResults = closedTrades.map(t => {
        const multiplier = t.tradeCategory === 'Option' ? 100 : 1;
        const costToOpen = t.openPrice * t.contractsShares * multiplier;
        const costToClose = (t.closePrice || 0) * t.contractsShares * multiplier;
        const profit = costToOpen + costToClose - (t.commIn || 0) - (t.commOut || 0);
        return { ...t, profit };
      });

      // Summary by trade type
      const byType: Record<string, { profit: number; loss: number; count: number; wins: number; investment: number }> = {};
      for (const t of tradeResults) {
        if (!byType[t.tradeType]) byType[t.tradeType] = { profit: 0, loss: 0, count: 0, wins: 0, investment: 0 };
        const entry = byType[t.tradeType];
        entry.count++;
        entry.investment += Math.abs(t.allocation || 0);
        if (t.profit >= 0) {
          entry.profit += t.profit;
          entry.wins++;
        } else {
          entry.loss += t.profit;
        }
      }

      const totalProfit = tradeResults.reduce((s, t) => s + t.profit, 0);
      const totalWins = tradeResults.filter(t => t.profit >= 0).length;

      // Account value
      const txTotal = transactions.reduce((s, tx) => s + tx.amount, 0);
      const accountValue = settings.startingAccountValue + totalProfit + txTotal;

      // Open P/L (stocks only — we have stock price for both open and current)
      // Options are excluded: currentPrice is the STOCK price, not the option premium,
      // so we can't compare it to openPrice (which is the option premium). The client-side
      // computeOptionPL handles option P/L estimation using strike-based logic.
      const openPL = openTrades.reduce((s, t) => {
        if (!t.currentPrice) return s;
        // Only calculate for stock trades where currentPrice and openPrice are comparable
        if (t.tradeCategory !== 'Stock') return s;
        const isShort = t.creditDebit === 'CREDIT' || t.tradeType === 'SHORT';
        const pl = isShort
          ? (Math.abs(t.openPrice) - t.currentPrice) * t.contractsShares
          : (t.currentPrice - Math.abs(t.openPrice)) * t.contractsShares;
        return s + pl - (t.commIn || 0);
      }, 0);

      // Allocated $
      const allocated = openTrades.reduce((s, t) => s + (t.allocation || 0), 0);
      const allocatedPct = accountValue > 0 ? allocated / accountValue : 0;

      // Equity curve data points
      const equityCurve: { date: string; value: number }[] = [];
      const sortedTrades = [...closedTrades].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
      let runningValue = settings.startingAccountValue;
      for (const t of sortedTrades) {
        const multiplier = t.tradeCategory === 'Option' ? 100 : 1;
        const costToOpen = t.openPrice * t.contractsShares * multiplier;
        const costToClose = (t.closePrice || 0) * t.contractsShares * multiplier;
        const profit = costToOpen + costToClose - (t.commIn || 0) - (t.commOut || 0);
        runningValue += profit;
        equityCurve.push({ date: t.closeDate!, value: runningValue });
      }

      // Behavior tag counts
      const behaviorCounts: Record<string, number> = {};
      for (const t of closedTrades) {
        if (t.behaviorTag) {
          behaviorCounts[t.behaviorTag] = (behaviorCounts[t.behaviorTag] || 0) + 1;
        }
      }

      res.json({
        totalTrades: closedTrades.length,
        openTrades: openTrades.length,
        totalProfit,
        totalWins,
        winRate: closedTrades.length > 0 ? totalWins / closedTrades.length : 0,
        accountValue,
        openPL,
        allocated,
        allocatedPct,
        byType,
        equityCurve,
        behaviorCounts,
        settings,
      });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Failed to get summary" });
    }
  });

  // Get all trades
  app.get("/api/trades", async (req, res) => {
    try {
      const allTrades = await storage.getAllTrades(req.user!.id);
      res.json(allTrades);
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Failed to get trades" });
    }
  });

  // Refresh prices for all open trades (static route before :id)
  app.post("/api/trades/refresh-prices", async (req, res) => {
    try {
      await ensureReady();
      const allTrades = await storage.getAllTrades(req.user!.id);
      const openTrades = allTrades.filter(t => !t.closeDate);
      const uniqueSymbols = [...new Set(openTrades.map(t => t.symbol))];
      const priceMap: Record<string, number> = {};

      for (const sym of uniqueSymbols) {
        try {
          const data = await getQuote(sym);
          if (data) {
            // getQuote returns quoteSummary.result[0] directly
            const price = data?.price?.regularMarketPrice?.raw;
            if (price) {
              priceMap[sym] = price;
              console.log(`[refresh] ${sym}: $${price}`);
            }
          }
          // Small delay between symbols to avoid rate limits
          await new Promise(r => setTimeout(r, 300));
        } catch (e: any) {
          console.log(`[refresh] ${sym} failed: ${e?.message}`);
        }
      }

      for (const trade of openTrades) {
        if (priceMap[trade.symbol] !== undefined) {
          await storage.updateTradePrice(req.user!.id, trade.id, priceMap[trade.symbol]);
        }
      }

      // Record price snapshots for MFE/MAE tracking
      const today = new Date().toISOString().split("T")[0];
      const snapshots: { tradeId: number; userId: number; date: string; price: number; unrealizedPL: number }[] = [];
      for (const trade of openTrades) {
        const price = priceMap[trade.symbol];
        if (price != null) {
          // Calculate unrealized P/L
          const multiplier = trade.tradeCategory === 'Option' ? 100 : 1;
          const isCredit = trade.openPrice > 0;
          let unrealizedPL;
          if (isCredit) {
            // Credit trade: profit when price goes down
            unrealizedPL = (trade.openPrice - price) * trade.contractsShares * multiplier;
          } else {
            // Debit trade: profit when price goes up
            unrealizedPL = (price + trade.openPrice) * trade.contractsShares * multiplier;
          }
          unrealizedPL -= (trade.commIn || 0);

          snapshots.push({
            tradeId: trade.id,
            userId: req.user!.id,
            date: today,
            price,
            unrealizedPL,
          });
        }
      }
      // Avoid duplicate snapshots for same day
      if (snapshots.length > 0) {
        for (const snap of snapshots) {
          await db.delete(tradePriceHistory).where(
            and(
              eq(tradePriceHistory.tradeId, snap.tradeId),
              eq(tradePriceHistory.date, today)
            )
          );
        }
        await storage.recordPriceSnapshots(snapshots);
      }

      const updated = await storage.getAllTrades(req.user!.id);
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Failed to refresh prices" });
    }
  });

  // Create a trade
  app.post("/api/trades", checkFeatureAccess('tradeLimit'), async (req, res) => {
    try {
      const trade = await storage.createTrade({
        ...req.body,
        userId: req.user!.id,
        createdAt: new Date().toISOString(),
      });
      res.json(trade);
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Failed to create trade" });
    }
  });

  // Update a trade
  app.patch("/api/trades/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const trade = await storage.updateTrade(req.user!.id, id, req.body);
      if (!trade) return res.status(404).json({ error: "Trade not found" });
      res.json(trade);
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Failed to update trade" });
    }
  });

  // Close a trade
  app.post("/api/trades/:id/close", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { closeDate, closePrice, commOut } = req.body;
      const trade = await storage.updateTrade(req.user!.id, id, { closeDate, closePrice, commOut });
      if (!trade) return res.status(404).json({ error: "Trade not found" });
      res.json(trade);
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Failed to close trade" });
    }
  });

  // Delete a trade (blocked for demo account)
  app.delete("/api/trades/:id", async (req, res) => {
    try {
      if (isDemoUser(req)) {
        return res.status(403).json({ error: "Demo account trades cannot be deleted. You can close trades instead. The account resets after 60 minutes of inactivity." });
      }
      const id = parseInt(req.params.id);
      await storage.deleteTrade(req.user!.id, id);
      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Failed to delete trade" });
    }
  });

  // Account settings
  app.get("/api/account/settings", async (req, res) => {
    try {
      const settings = await storage.getAccountSettings(req.user!.id);
      res.json(settings);
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Failed to get settings" });
    }
  });

  app.patch("/api/account/settings", async (req, res) => {
    try {
      const settings = await storage.updateAccountSettings(req.user!.id, req.body);
      res.json(settings);
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Failed to update settings" });
    }
  });

  // Account transactions
  app.get("/api/account/transactions", async (req, res) => {
    try {
      const txs = await storage.getAccountTransactions(req.user!.id);
      res.json(txs);
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Failed to get transactions" });
    }
  });

  app.post("/api/account/transactions", async (req, res) => {
    try {
      const tx = await storage.createAccountTransaction({ ...req.body, userId: req.user!.id });
      res.json(tx);
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Failed to create transaction" });
    }
  });

  app.delete("/api/account/transactions/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteAccountTransaction(req.user!.id, id);
      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Failed to delete transaction" });
    }
  });

  // Initialize background price snapshot cron job
  const { initCron } = await import("./cron");
  initCron(getQuote, ensureReady);

  // ─── Track Record API ────────────────────────────────────────────────
  app.get("/api/track-record", async (_req, res) => {
    try {
      const { getTrackRecordStats } = await import("./track-record");
      const stats = await getTrackRecordStats();
      res.json(stats);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to get track record" });
    }
  });

  // Manual trigger for signal logging (admin only)
  app.post("/api/track-record/log-signals", async (req, res) => {
    if (!ADMIN_EMAILS_LIST.includes(req.user!.email)) return res.status(403).json({ error: "Admin only" });
    try {
      const { logSignals } = await import("./track-record");
      const count = await logSignals(getQuote, screenStocks, computeEMA, getChart, ensureReady);
      res.json({ logged: count });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Initialize track record cron (daily at 4:30 PM ET = market close + 30 min)
  const { logSignals, checkOutcomes } = await import("./track-record");
  // Run signal logger daily at 16:30 ET (20:30 UTC)
  setInterval(async () => {
    const now = new Date();
    const hour = now.getUTCHours();
    const min = now.getUTCMinutes();
    const day = now.getUTCDay();
    // Only weekdays at ~20:30 UTC (4:30 PM ET)
    if (day >= 1 && day <= 5 && hour === 20 && min >= 30 && min <= 35) {
      try {
        await logSignals(getQuote, screenStocks, computeEMA, getChart, ensureReady);
        await checkOutcomes(getQuote, ensureReady);
      } catch (err: any) {
        console.error("[track-record] Cron error:", err.message);
      }
    }
  }, 5 * 60 * 1000); // Check every 5 minutes

  // ─── Demo Account Idle Reset Timer ────────────────────────────────────────
  // Check every 5 minutes. If demo was active and is now idle for 60 min, reset.
  const demoPool = new pg.Pool({
    connectionString: process.env.DATABASE_URL || "postgresql://stockotter:St0ckOtter2026@localhost:5432/stockotter",
    max: 2,
  });

  setInterval(async () => {
    try {
      // Only reset if the demo user was active at some point
      if (demoLastActivity === 0) return;
      const elapsed = Date.now() - demoLastActivity;
      if (elapsed >= DEMO_IDLE_TIMEOUT_MS && !demoResetInProgress) {
        demoResetInProgress = true;
        console.log(`[demo] Idle for ${Math.round(elapsed / 60000)}m — resetting account...`);
        await seedDemoAccount(demoPool);
        demoLastActivity = 0; // reset tracker so it doesn't keep firing
        demoResetInProgress = false;
        console.log(`[demo] Account reset complete.`);
      }
    } catch (err: any) {
      demoResetInProgress = false;
      console.error(`[demo] Reset failed:`, err.message);
    }
  }, 5 * 60 * 1000); // check every 5 minutes

  return httpServer;
}
