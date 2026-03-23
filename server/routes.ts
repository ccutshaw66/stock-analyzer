import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";

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

async function getYahooCrumb(): Promise<{ crumb: string; cookie: string }> {
  // Cache crumb for 10 minutes (shorter = more reliable on cloud servers)
  if (_crumb && _cookie && Date.now() - _crumbTimestamp < 10 * 60 * 1000) {
    return { crumb: _crumb, cookie: _cookie };
  }

  console.log("[yahoo] Fetching new crumb...");

  // Try multiple cookie sources to maximize compatibility across Node versions
  let cookie = "";

  // Method 1: fc.yahoo.com (fastest)
  try {
    const r = await fetch("https://fc.yahoo.com/", { headers: YF_BASE_HEADERS, redirect: "manual" });
    const parts: string[] = [];
    if (typeof r.headers.getSetCookie === 'function') {
      for (const c of r.headers.getSetCookie()) parts.push(c.split(";")[0]);
    }
    if (parts.length === 0) {
      const raw = r.headers.get('set-cookie');
      if (raw) for (const c of raw.split(/,(?=[A-Z])/)) parts.push(c.trim().split(";")[0]);
    }
    cookie = parts.filter(Boolean).join("; ");
  } catch (e) {
    console.log("[yahoo] fc.yahoo.com failed:", (e as Error).message);
  }

  // Method 2: Fallback to finance.yahoo.com
  if (!cookie) {
    try {
      const r = await fetch("https://finance.yahoo.com/quote/AAPL", { headers: YF_BASE_HEADERS, redirect: "follow" });
      const parts: string[] = [];
      if (typeof r.headers.getSetCookie === 'function') {
        for (const c of r.headers.getSetCookie()) parts.push(c.split(";")[0]);
      }
      if (parts.length === 0) {
        const raw = r.headers.get('set-cookie');
        if (raw) for (const c of raw.split(/,(?=[A-Z])/)) parts.push(c.trim().split(";")[0]);
      }
      cookie = parts.filter(Boolean).join("; ");
    } catch (e) {
      console.log("[yahoo] finance.yahoo.com failed:", (e as Error).message);
    }
  }

  console.log("[yahoo] Cookie:", cookie ? "obtained" : "MISSING");

  if (!cookie) {
    throw new Error("Failed to obtain Yahoo Finance cookie");
  }

  // Get crumb - try query2 first, fall back to query1
  let crumbResp = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
    headers: { ...YF_BASE_HEADERS, Accept: "text/plain", Cookie: cookie },
  });
  if (crumbResp.status !== 200) {
    console.log(`[yahoo] query2 crumb failed (${crumbResp.status}), trying query1...`);
    crumbResp = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
      headers: { ...YF_BASE_HEADERS, Accept: "text/plain", Cookie: cookie },
    });
  }
  const crumb = await crumbResp.text();
  console.log("[yahoo] Crumb:", crumbResp.status, crumb ? crumb.substring(0, 15) + "..." : "EMPTY");

  // Validate crumb is actually a crumb (short alphanumeric string, not HTML or JSON)
  if (!crumb || crumb.length > 50 || crumb.includes("<") || crumb.includes("{") || crumbResp.status !== 200) {
    throw new Error(`Failed to obtain crumb (status ${crumbResp.status})`);
  }

  _crumb = crumb;
  _cookie = cookie;
  _crumbTimestamp = Date.now();

  return { crumb, cookie };
}

async function yahooFetch(url: string, retries = 3): Promise<any> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const { crumb, cookie } = await getYahooCrumb();
      const separator = url.includes("?") ? "&" : "?";
      const fullUrl = `${url}${separator}crumb=${encodeURIComponent(crumb)}`;
      console.log(`[yahoo] Fetching: ${fullUrl.substring(0, 120)}...`);

      const resp = await fetch(fullUrl, {
        headers: { ...YF_BASE_HEADERS, Cookie: cookie },
      });

      if (resp.status === 401 || resp.status === 403) {
        // Auth issue — clear crumb and retry
        console.log(`[yahoo] Auth error ${resp.status}, refreshing crumb...`);
        _crumb = null; _cookie = null; _crumbTimestamp = 0;
        if (attempt < retries) { await new Promise(r => setTimeout(r, 500)); continue; }
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

// Use query1 as primary (better compatibility with cloud server IPs)
const YF_QUERY_BASE = "https://query1.finance.yahoo.com";

async function getQuote(ticker: string): Promise<any> {
  const modules = [
    "price", "summaryDetail", "defaultKeyStatistics",
    "financialData", "summaryProfile", "recommendationTrend", "earningsTrend"
  ].join("%2C");
  const data = await yahooFetch(
    `${YF_QUERY_BASE}/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=${modules}`
  );
  return data?.quoteSummary?.result?.[0] || null;
}

async function getChart(ticker: string, range: string, interval: string): Promise<any> {
  const data = await yahooFetch(
    `${YF_QUERY_BASE}/v8/finance/chart/${encodeURIComponent(ticker)}?range=${range}&interval=${interval}&includePrePost=false`
  );
  return data?.chart?.result?.[0] || null;
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

function computeVerdict(weightedScore: number): { verdict: "YES" | "WATCH" | "NO"; ruling: string } {
  if (weightedScore >= 8.5) return { verdict: "YES", ruling: "Strong conviction buy — fundamentals, income, and performance all align." };
  if (weightedScore >= 7.0) return { verdict: "YES", ruling: "Buy with minor caveats — solid fundamentals with some areas to monitor." };
  if (weightedScore >= 5.5) return { verdict: "WATCH", ruling: "Hold or watchlist — mixed signals, needs improvement in key areas." };
  return { verdict: "NO", ruling: "Avoid for now — significant concerns across multiple categories." };
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

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Warm up Yahoo crumb on startup so first request doesn't fail
  getYahooCrumb().then(() => console.log("[yahoo] Crumb warmed up")).catch(e => console.log("[yahoo] Warmup failed:", e.message));

  app.get("/api/analyze/:ticker", async (req, res) => {
    const ticker = req.params.ticker.toUpperCase();

    try {
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

      const { chartData, computedReturn: ret1Y } = extractChartData(chart1Y);
      const { computedReturn: ret3Y } = extractChartData(chart3Y);
      const { computedReturn: ret5Y } = extractChartData(chart5Y);

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
      const items = await storage.getFavorites(listType);
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
      const existing = await storage.getFavorite(ticker.toUpperCase(), listType);
      if (existing) {
        return res.status(409).json({ error: "Already in list" });
      }
      const fav = await storage.addFavorite({
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
      await storage.removeFavorite(ticker.toUpperCase(), listType);
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

  function computeRSI(closes: number[], period: number): number[] {
    const rsi: number[] = new Array(closes.length).fill(NaN);
    if (closes.length < period + 1) return rsi;
    let avgGain = 0, avgLoss = 0;
    for (let i = 1; i <= period; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff > 0) avgGain += diff;
      else avgLoss += Math.abs(diff);
    }
    avgGain /= period;
    avgLoss /= period;
    rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    for (let i = period + 1; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      const gain = diff > 0 ? diff : 0;
      const loss = diff < 0 ? Math.abs(diff) : 0;
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
      rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
    return rsi;
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

      // Compute DTS indicators
      // Use 2-year weekly data for SMA200 if available, otherwise compute on daily
      let sma200Daily: number[] = new Array(closes.length).fill(NaN);
      if (chart2Y && chart2Y.timestamp) {
        const weeklyCloses: number[] = chart2Y.indicators?.quote?.[0]?.close || [];
        // Clean nulls
        for (let i = 0; i < weeklyCloses.length; i++) {
          if (weeklyCloses[i] == null && i > 0) weeklyCloses[i] = weeklyCloses[i - 1];
        }
        // Compute SMA200 on the combined weekly data as a proxy
        // But the spec says SMA(200) on close prices — this should be 200-period SMA
        // We have ~104 weekly bars for 2 years which isn't enough for 200-week SMA.
        // So compute SMA(200) on daily data. We need more daily data.
        // Actually, let's just compute it on the daily closes we have (252 trading days ~ 1 year)
        // If we don't have 200 bars, we'll have partial data.
        sma200Daily = computeSMA(closes, 200);

        // If daily doesn't have enough bars, approximate from weekly:
        // Use a 40-week SMA as a rough proxy for 200-day SMA
        if (isNaN(sma200Daily[closes.length - 1])) {
          const weeklySma40 = computeSMA(weeklyCloses, 40);
          const lastWeeklySma = weeklySma40[weeklyCloses.length - 1];
          if (!isNaN(lastWeeklySma)) {
            // Fill sma200Daily with the weekly proxy value for all bars
            for (let i = 0; i < closes.length; i++) {
              sma200Daily[i] = lastWeeklySma;
            }
          }
        }
      } else {
        sma200Daily = computeSMA(closes, 200);
      }

      const rsi14 = computeRSI(closes, 14);

      // ---- Strategy 1: BBTC EMA Pyramid Risk ----
      type BBTCSignal = "BUY" | "SELL" | "ADD_LONG" | "REDUCE" | "STOP_HIT" | null;
      const bbtcSignals: BBTCSignal[] = new Array(closes.length).fill(null);
      let inPosition = false;
      let positionSide: "LONG" | "SHORT" | null = null;
      let entryPrice = 0;
      let highestSinceEntry = 0;

      for (let i = 1; i < closes.length; i++) {
        if (isNaN(ema9[i]) || isNaN(ema21[i]) || isNaN(ema50[i]) || isNaN(atr14[i])) continue;

        const crossAbove = ema9[i] > ema21[i] && ema9[i - 1] <= ema21[i - 1];
        const crossBelow = ema9[i] < ema21[i] && ema9[i - 1] >= ema21[i - 1];

        if (!inPosition) {
          if (crossAbove && closes[i] > ema50[i]) {
            bbtcSignals[i] = "BUY";
            inPosition = true;
            positionSide = "LONG";
            entryPrice = closes[i];
            highestSinceEntry = highs[i];
          } else if (crossBelow && closes[i] < ema50[i]) {
            bbtcSignals[i] = "SELL";
            inPosition = true;
            positionSide = "SHORT";
            entryPrice = closes[i];
            highestSinceEntry = highs[i];
          }
        } else {
          highestSinceEntry = Math.max(highestSinceEntry, highs[i]);
          if (positionSide === "LONG") {
            const stopLoss = entryPrice - atr14[i] * 2.0;
            const trailStop = highestSinceEntry - atr14[i] * 1.5;
            const target = entryPrice + atr14[i] * 3.0;
            if (lows[i] <= stopLoss || lows[i] <= trailStop) {
              bbtcSignals[i] = "STOP_HIT";
              inPosition = false;
              positionSide = null;
            } else if (highs[i] >= target) {
              bbtcSignals[i] = "REDUCE";
            } else if (crossAbove && closes[i] > ema50[i]) {
              bbtcSignals[i] = "ADD_LONG";
            } else if (crossBelow && closes[i] < ema50[i]) {
              bbtcSignals[i] = "SELL";
              inPosition = false;
              positionSide = null;
            }
          } else if (positionSide === "SHORT") {
            if (crossAbove && closes[i] > ema50[i]) {
              bbtcSignals[i] = "BUY";
              inPosition = false;
              positionSide = null;
            } else if (crossBelow && closes[i] < ema50[i]) {
              bbtcSignals[i] = "ADD_LONG";
            }
          }
        }
      }

      // ---- Strategy 2: DTS Reversal Swing ----
      type DTSSignal = "BUY" | "SELL" | null;
      const dtsSignals: DTSSignal[] = new Array(closes.length).fill(null);

      for (let i = 15; i < closes.length; i++) {
        if (isNaN(rsi14[i]) || isNaN(sma200Daily[i])) continue;

        // Buy: RSI < 40 AND low > SMA200
        if (rsi14[i] < 40 && lows[i] > sma200Daily[i]) {
          dtsSignals[i] = "BUY";
        }

        // Sell: high > highest(high, 15 bars back) AND close > SMA200
        let highest15 = -Infinity;
        for (let j = i - 15; j < i; j++) {
          if (j >= 0) highest15 = Math.max(highest15, highs[j]);
        }
        if (highs[i] > highest15 && closes[i] > sma200Daily[i]) {
          dtsSignals[i] = "SELL";
        }
      }

      // ---- Build response ----
      const lastIdx = closes.length - 1;
      const currentPrice = closes[lastIdx];

      // BBTC current state
      const lastBbtcSignal = (() => {
        for (let i = lastIdx; i >= 0; i--) {
          if (bbtcSignals[i]) return bbtcSignals[i];
        }
        return null;
      })();

      let bbtcTopSignal: "HOLD" | "ENTER" | "SELL" = "HOLD";
      if (lastBbtcSignal === "BUY" || lastBbtcSignal === "ADD_LONG") bbtcTopSignal = "ENTER";
      else if (lastBbtcSignal === "SELL" || lastBbtcSignal === "STOP_HIT" || lastBbtcSignal === "REDUCE") bbtcTopSignal = "SELL";

      const bbtcBias: "LONG" | "SHORT" | "FLAT" =
        !isNaN(ema9[lastIdx]) && !isNaN(ema21[lastIdx]) && !isNaN(ema50[lastIdx])
          ? (ema9[lastIdx] > ema21[lastIdx] && closes[lastIdx] > ema50[lastIdx] ? "LONG"
             : ema9[lastIdx] < ema21[lastIdx] && closes[lastIdx] < ema50[lastIdx] ? "SHORT"
             : "FLAT")
          : "FLAT";

      const bbtcTrend: "UP" | "DOWN" | "SIDEWAYS" =
        !isNaN(ema9[lastIdx]) && !isNaN(ema21[lastIdx]) && !isNaN(ema50[lastIdx])
          ? (ema9[lastIdx] > ema21[lastIdx] && closes[lastIdx] > ema50[lastIdx] ? "UP"
             : ema9[lastIdx] < ema21[lastIdx] && closes[lastIdx] < ema50[lastIdx] ? "DOWN"
             : "SIDEWAYS")
          : "SIDEWAYS";

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

      // DTS current state
      const lastDtsSignal = (() => {
        for (let i = lastIdx; i >= 0; i--) {
          if (dtsSignals[i]) return dtsSignals[i];
        }
        return null;
      })();

      let dtsTopSignal: "HOLD" | "ENTER" | "SELL" = "HOLD";
      if (lastDtsSignal === "BUY") dtsTopSignal = "ENTER";
      else if (lastDtsSignal === "SELL") dtsTopSignal = "SELL";

      let highest15 = -Infinity;
      for (let j = lastIdx - 15; j < lastIdx; j++) {
        if (j >= 0) highest15 = Math.max(highest15, highs[j]);
      }

      let dtsSignalDetail = "";
      if (dtsTopSignal === "ENTER") dtsSignalDetail = `RSI at ${rsi14[lastIdx]?.toFixed(1)}, below 40 threshold with price above SMA200`;
      else if (dtsTopSignal === "SELL") dtsSignalDetail = `Price breaking above 15-bar high with close above SMA200`;
      else dtsSignalDetail = `RSI at ${rsi14[lastIdx]?.toFixed(1) ?? "N/A"}, no active signal`;

      const dtsRecent: {date: string; signal: string; price: number}[] = [];
      for (let i = lastIdx; i >= 0 && dtsRecent.length < 10; i--) {
        if (dtsSignals[i]) {
          dtsRecent.unshift({
            date: new Date(timestamps[i] * 1000).toISOString().split("T")[0],
            signal: dtsSignals[i]!,
            price: Number(closes[i].toFixed(2)),
          });
        }
      }

      // Combined signal
      const bbtcIsBuy = bbtcTopSignal === "ENTER";
      const bbtcIsSell = bbtcTopSignal === "SELL";
      const dtsIsBuy = dtsTopSignal === "ENTER";
      const dtsIsSell = dtsTopSignal === "SELL";

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

      // AMC scoring for current bar
      const li = lastIdx;
      let amcScore = 0;
      if (!isNaN(histogram[li]) && histogram[li] > 0 && histogram[li] > (histogram[li-1]||0)) amcScore++;
      if (!isNaN(rsi14[li]) && rsi14[li] >= 45 && rsi14[li] <= 65) amcScore++;
      if (!isNaN(ema9[li]) && !isNaN(ema50[li]) && closes[li] > ema9[li] && ema9[li] > ema50[li]) amcScore++;
      if (vamiScaled[li] > 0 && vamiScaled[li] > vamiScaled[li-1]) amcScore++;
      // ADX not available in daily chart easily, use trend proxy
      if (!isNaN(ema9[li]) && !isNaN(ema21[li]) && Math.abs(ema9[li] - ema21[li]) / closes[li] * 100 > 0.5) amcScore++;

      const amcMomentumEntry = amcScore >= 4 && closes[li] > closes[li-1];
      const amcReversionEntry = !isNaN(rsi14[li]) && rsi14[li] < 30 && !isNaN(sma200Daily[li]) && closes[li] > sma200Daily[li] * 0.95 && closes[li] > closes[li-1] && vamiScaled[li] > vamiScaled[li-1];

      let amcSignal: "ENTER" | "HOLD" | "SELL" = "HOLD";
      let amcMode: "momentum" | "reversion" | "flat" = "flat";
      if (amcMomentumEntry) { amcSignal = "ENTER"; amcMode = "momentum"; }
      else if (amcReversionEntry) { amcSignal = "ENTER"; amcMode = "reversion"; }
      // Exit signals for current bar
      if (!isNaN(rsi14[li]) && rsi14[li] > 75) { amcSignal = "SELL"; }
      if (!isNaN(histogram[li]) && histogram[li] < 0 && !isNaN(histogram[li-1]) && histogram[li-1] >= 0) { amcSignal = "SELL"; }

      let amcDetail = `Score: ${amcScore}/5`;
      if (amcSignal === "ENTER") amcDetail += ` — ${amcMode} entry triggered`;
      else if (amcSignal === "SELL") amcDetail += " — exit conditions met";
      else amcDetail += " — waiting for 4+ conditions";

      // AMC recent signals
      const amcRecent: {date: string; signal: string; price: number}[] = [];
      for (let i = lastIdx; i >= 60 && amcRecent.length < 10; i--) {
        let sc = 0;
        if (!isNaN(histogram[i]) && histogram[i] > 0 && histogram[i] > (histogram[i-1]||0)) sc++;
        if (!isNaN(rsi14[i]) && rsi14[i] >= 45 && rsi14[i] <= 65) sc++;
        if (!isNaN(ema9[i]) && !isNaN(ema50[i]) && closes[i] > ema9[i] && ema9[i] > ema50[i]) sc++;
        if (vamiScaled[i] > 0 && vamiScaled[i] > vamiScaled[i-1]) sc++;
        if (!isNaN(ema9[i]) && !isNaN(ema21[i]) && Math.abs(ema9[i] - ema21[i]) / closes[i] * 100 > 0.5) sc++;
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
      let buyVotes = (bbtcIsBuy ? 1 : 0) + (dtsIsBuy ? 1 : 0) + (amcIsBuy ? 1 : 0);
      let sellVotes = (bbtcIsSell ? 1 : 0) + (dtsIsSell ? 1 : 0) + (amcIsSell ? 1 : 0);

      let combinedSignal: "ENTER" | "HOLD" | "SELL" = "HOLD";
      let confidence: "Strong" | "Moderate" | "Weak" = "Moderate";
      let reasoning = "";

      if (buyVotes >= 3) {
        combinedSignal = "ENTER"; confidence = "Strong"; reasoning = "All three strategies agree on entry";
      } else if (sellVotes >= 3) {
        combinedSignal = "SELL"; confidence = "Strong"; reasoning = "All three strategies agree on exit";
      } else if (buyVotes === 2 && sellVotes === 0) {
        combinedSignal = "ENTER"; confidence = "Moderate"; reasoning = `${[bbtcIsBuy&&"BBTC",dtsIsBuy&&"DTS",amcIsBuy&&"AMC"].filter(Boolean).join(" + ")} signal entry`;
      } else if (sellVotes === 2 && buyVotes === 0) {
        combinedSignal = "SELL"; confidence = "Moderate"; reasoning = `${[bbtcIsSell&&"BBTC",dtsIsSell&&"DTS",amcIsSell&&"AMC"].filter(Boolean).join(" + ")} signal exit`;
      } else if (buyVotes === 1 && sellVotes === 0) {
        combinedSignal = "ENTER"; confidence = "Weak"; reasoning = `Only ${[bbtcIsBuy&&"BBTC",dtsIsBuy&&"DTS",amcIsBuy&&"AMC"].filter(Boolean)[0]} signals entry`;
      } else if (sellVotes === 1 && buyVotes === 0) {
        combinedSignal = "SELL"; confidence = "Weak"; reasoning = `Only ${[bbtcIsSell&&"BBTC",dtsIsSell&&"DTS",amcIsSell&&"AMC"].filter(Boolean)[0]} signals exit`;
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
          dtsSignal: dtsSignals[i] || null,
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
          dtsSignal: dtsSignals[lastIdx] || null,
        });
      }

      res.json({
        ticker,
        currentPrice: Number(currentPrice.toFixed(2)),
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
        dts: {
          signal: dtsTopSignal,
          signalDetail: dtsSignalDetail,
          rsi: isNaN(rsi14[lastIdx]) ? null : Number(rsi14[lastIdx].toFixed(2)),
          sma200: isNaN(sma200Daily[lastIdx]) ? null : Number(sma200Daily[lastIdx].toFixed(2)),
          highestHigh15: Number(highest15.toFixed(2)),
          recentSignals: dtsRecent,
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
          signal: combinedSignal,
          confidence,
          reasoning,
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

    const { crumb, cookie } = await getYahooCrumb();
    const resp = await fetch(
      `https://query1.finance.yahoo.com/v1/finance/screener?crumb=${encodeURIComponent(crumb)}`,
      {
        method: "POST",
        headers: { ...YF_BASE_HEADERS, "Content-Type": "application/json", Cookie: cookie },
        body,
      }
    );

    if (!resp.ok) {
      console.log(`[screener] Error: ${resp.status}`);
      return [];
    }

    const data = await resp.json();
    const quotes = data?.finance?.result?.[0]?.quotes || [];
    return quotes.map((q: any) => q.symbol as string).filter(Boolean);
  }

  // ============================================================
  // Scanner Route (dynamic)
  // ============================================================

  app.get("/api/scanner", async (req, res) => {
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

    try {
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

      // Process in batches of 5
      for (let b = 0; b < tickers.length; b += 5) {
        const batch = tickers.slice(b, b + 5);
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

            type BBTCSig = "BUY" | "SELL" | "ADD_LONG" | "REDUCE" | "STOP_HIT" | null;
            const bbtcSignals: BBTCSig[] = new Array(closes.length).fill(null);
            let inPos = false;
            let posSide: "LONG" | "SHORT" | null = null;
            let entryPx = 0;
            let highSince = 0;

            for (let i = 1; i < closes.length; i++) {
              if (isNaN(ema9[i]) || isNaN(ema21[i]) || isNaN(ema50[i]) || isNaN(atr14[i])) continue;
              const crossAbove = ema9[i] > ema21[i] && ema9[i - 1] <= ema21[i - 1];
              const crossBelow = ema9[i] < ema21[i] && ema9[i - 1] >= ema21[i - 1];

              if (!inPos) {
                if (crossAbove && closes[i] > ema50[i]) {
                  bbtcSignals[i] = "BUY"; inPos = true; posSide = "LONG";
                  entryPx = closes[i]; highSince = highs[i];
                } else if (crossBelow && closes[i] < ema50[i]) {
                  bbtcSignals[i] = "SELL"; inPos = true; posSide = "SHORT";
                  entryPx = closes[i]; highSince = highs[i];
                }
              } else {
                highSince = Math.max(highSince, highs[i]);
                if (posSide === "LONG") {
                  const stopLoss = entryPx - atr14[i] * 2.0;
                  const trailStp = highSince - atr14[i] * 1.5;
                  const target = entryPx + atr14[i] * 3.0;
                  if (lows[i] <= stopLoss || lows[i] <= trailStp) {
                    bbtcSignals[i] = "STOP_HIT"; inPos = false; posSide = null;
                  } else if (highs[i] >= target) {
                    bbtcSignals[i] = "REDUCE";
                  } else if (crossAbove && closes[i] > ema50[i]) {
                    bbtcSignals[i] = "ADD_LONG";
                  } else if (crossBelow && closes[i] < ema50[i]) {
                    bbtcSignals[i] = "SELL"; inPos = false; posSide = null;
                  }
                } else if (posSide === "SHORT") {
                  if (crossAbove && closes[i] > ema50[i]) {
                    bbtcSignals[i] = "BUY"; inPos = false; posSide = null;
                  } else if (crossBelow && closes[i] < ema50[i]) {
                    bbtcSignals[i] = "ADD_LONG";
                  }
                }
              }
            }

            // BBTC current state
            let lastBbtc: BBTCSig = null;
            for (let i = lastIdx; i >= 0; i--) {
              if (bbtcSignals[i]) { lastBbtc = bbtcSignals[i]; break; }
            }
            let bbtcTopSignal: "HOLD" | "ENTER" | "SELL" = "HOLD";
            if (lastBbtc === "BUY" || lastBbtc === "ADD_LONG") bbtcTopSignal = "ENTER";
            else if (lastBbtc === "SELL" || lastBbtc === "STOP_HIT" || lastBbtc === "REDUCE") bbtcTopSignal = "SELL";

            const bbtcTrend: "UP" | "DOWN" | "SIDEWAYS" =
              !isNaN(ema9[lastIdx]) && !isNaN(ema21[lastIdx]) && !isNaN(ema50[lastIdx])
                ? (ema9[lastIdx] > ema21[lastIdx] && closes[lastIdx] > ema50[lastIdx] ? "UP"
                   : ema9[lastIdx] < ema21[lastIdx] && closes[lastIdx] < ema50[lastIdx] ? "DOWN" : "SIDEWAYS")
                : "SIDEWAYS";

            const bbtcBias: "LONG" | "SHORT" | "FLAT" =
              !isNaN(ema9[lastIdx]) && !isNaN(ema21[lastIdx]) && !isNaN(ema50[lastIdx])
                ? (ema9[lastIdx] > ema21[lastIdx] && closes[lastIdx] > ema50[lastIdx] ? "LONG"
                   : ema9[lastIdx] < ema21[lastIdx] && closes[lastIdx] < ema50[lastIdx] ? "SHORT" : "FLAT")
                : "FLAT";

            // ---- Strategy 2: DTS ----
            const sma200 = computeSMA(closes, 200);
            const rsi14 = computeRSI(closes, 14);

            type DTSSig = "BUY" | "SELL" | null;
            const dtsSignals: DTSSig[] = new Array(closes.length).fill(null);
            for (let i = 15; i < closes.length; i++) {
              if (isNaN(rsi14[i]) || isNaN(sma200[i])) continue;
              if (rsi14[i] < 40 && lows[i] > sma200[i]) dtsSignals[i] = "BUY";
              let highest15 = -Infinity;
              for (let j = i - 15; j < i; j++) {
                if (j >= 0) highest15 = Math.max(highest15, highs[j]);
              }
              if (highs[i] > highest15 && closes[i] > sma200[i]) dtsSignals[i] = "SELL";
            }

            let lastDts: DTSSig = null;
            for (let i = lastIdx; i >= 0; i--) {
              if (dtsSignals[i]) { lastDts = dtsSignals[i]; break; }
            }
            let dtsTopSignal: "HOLD" | "ENTER" | "SELL" = "HOLD";
            if (lastDts === "BUY") dtsTopSignal = "ENTER";
            else if (lastDts === "SELL") dtsTopSignal = "SELL";

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
            // DTS: ENTER +2, HOLD 0, SELL -2
            if (dtsTopSignal === "ENTER") score += 2;
            else if (dtsTopSignal === "SELL") score -= 2;
            // Confirmation: CONFIRMED_BUY +3, LEAN_BUY +1, NEUTRAL 0, LEAN_SELL -1, CONFIRMED_SELL -3
            if (confirmationSignal === "CONFIRMED_BUY") score += 3;
            else if (confirmationSignal === "LEAN_BUY") score += 1;
            else if (confirmationSignal === "LEAN_SELL") score -= 1;
            else if (confirmationSignal === "CONFIRMED_SELL") score -= 3;

            const alignmentLabel = score >= 5 ? "Strong Buy" : score >= 3 ? "Buy" : score >= 2 ? "Lean Buy" : null;

            return {
              ticker,
              price: Number(currentPrice.toFixed(2)),
              score,
              bbtc: { signal: bbtcTopSignal, trend: bbtcTrend, bias: bbtcBias },
              dts: { signal: dtsTopSignal, rsi: lastRsi },
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

      // Sort by score descending
      const sorted = allResults.sort((a, b) => b.score - a.score);
      const results = showAll ? sorted.slice(0, 50) : sorted.filter(r => r.score >= 2).slice(0, 20);

      res.json({
        scannedAt: new Date().toISOString(),
        totalScanned: tickers.length,
        filters: { minPrice, maxPrice, sector, marketCapTier },
        results,
      });
    } catch (error: any) {
      console.error("Scanner error:", error?.message || error);
      res.status(500).json({ error: `Scanner failed: ${error?.message || "Unknown error."}` });
    }
  });

  // Refresh scores for all favorites in a list
  app.post("/api/favorites/:listType/refresh", async (req, res) => {
    try {
      const listType = req.params.listType;
      const items = await storage.getFavorites(listType);
      const results = [];

      for (const item of items) {
        try {
          const summary = await getQuote(item.ticker);
          if (summary) {
            const { quote, financials } = extractQuoteData(summary);
            const chart1Y = await getChart(item.ticker, "1y", "1d").catch(() => null);
            const { computedReturn: ret1Y } = extractChartData(chart1Y);
            const chart3Y = await getChart(item.ticker, "3y", "1wk").catch(() => null);
            const { computedReturn: ret3Y } = extractChartData(chart3Y);
            const historicalReturns = { oneYear: ret1Y, threeYear: ret3Y, fiveYear: null };
            const fullData = { quote, financials, historicalReturns };
            const scoring = computeScoring(fullData);
            const weightedScore = scoring.reduce((sum, cat) => sum + cat.score * cat.weight, 0);
            const { verdict } = computeVerdict(weightedScore);
            const score = Number(weightedScore.toFixed(2));
            await storage.updateFavoriteScore(item.ticker, listType, score, verdict);
            results.push({ ...item, score, verdict });
          } else {
            results.push(item);
          }
        } catch {
          results.push(item);
        }
      }

      res.json(results);
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Failed to refresh scores" });
    }
  });

  return httpServer;
}
