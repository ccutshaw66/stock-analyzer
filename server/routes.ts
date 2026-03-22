import type { Express } from "express";
import { createServer, type Server } from "http";

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
  // Cache crumb for 30 minutes
  if (_crumb && _cookie && Date.now() - _crumbTimestamp < 30 * 60 * 1000) {
    return { crumb: _crumb, cookie: _cookie };
  }

  console.log("[yahoo] Fetching new crumb...");

  // Step 1: Get cookies from Yahoo Finance
  const consentResp = await fetch("https://fc.yahoo.com/", {
    headers: YF_BASE_HEADERS,
    redirect: "manual",
  });
  
  // Try getSetCookie first, fall back to get('set-cookie')
  let cookieParts: string[] = [];
  if (typeof consentResp.headers.getSetCookie === 'function') {
    cookieParts = consentResp.headers.getSetCookie();
  }
  if (cookieParts.length === 0) {
    const raw = consentResp.headers.get('set-cookie');
    if (raw) cookieParts = [raw];
  }
  let cookie = cookieParts.map(c => c.split(";")[0]).join("; ");
  console.log("[yahoo] Cookie obtained:", cookie ? "yes" : "no");

  if (!cookie) {
    // Fallback: try the main page
    const mainResp = await fetch("https://finance.yahoo.com/", {
      headers: YF_BASE_HEADERS,
      redirect: "follow",
    });
    let mainParts: string[] = [];
    if (typeof mainResp.headers.getSetCookie === 'function') {
      mainParts = mainResp.headers.getSetCookie();
    }
    if (mainParts.length === 0) {
      const raw = mainResp.headers.get('set-cookie');
      if (raw) mainParts = [raw];
    }
    cookie = mainParts.map(c => c.split(";")[0]).join("; ");
    console.log("[yahoo] Fallback cookie obtained:", cookie ? "yes" : "no");
  }

  // Step 2: Get crumb (must accept text/plain)
  const crumbResp = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
    headers: { ...YF_BASE_HEADERS, Accept: "text/plain", Cookie: cookie },
  });
  const crumb = await crumbResp.text();
  console.log("[yahoo] Crumb obtained:", crumb ? crumb.substring(0, 20) : "EMPTY", "status:", crumbResp.status);

  if (!crumb || crumb.includes("<!DOCTYPE") || crumb.includes("{")) {
    throw new Error("Failed to obtain Yahoo Finance crumb. The service may be temporarily unavailable.");
  }

  _crumb = crumb;
  _cookie = cookie;
  _crumbTimestamp = Date.now();

  return { crumb, cookie };
}

async function yahooFetch(url: string, retries = 2): Promise<any> {
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
        // Crumb expired, clear and retry
        _crumb = null;
        _cookie = null;
        _crumbTimestamp = 0;
        if (attempt < retries) continue;
        throw new Error(`Yahoo Finance returned ${resp.status}`);
      }

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        console.log(`[yahoo] Error response: ${resp.status} ${errText.substring(0, 200)}`);
        throw new Error(`Yahoo Finance API error: ${resp.status} ${resp.statusText}`);
      }

      const json = await resp.json();
      console.log(`[yahoo] Response status: ${resp.status}, has data: ${!!json}`);
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

async function getQuote(ticker: string): Promise<any> {
  const modules = [
    "price", "summaryDetail", "defaultKeyStatistics",
    "financialData", "summaryProfile", "recommendationTrend", "earningsTrend"
  ].join("%2C");
  const data = await yahooFetch(
    `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=${modules}`
  );
  return data?.quoteSummary?.result?.[0] || null;
}

async function getChart(ticker: string, range: string, interval: string): Promise<any> {
  const data = await yahooFetch(
    `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=${range}&interval=${interval}&includePrePost=false`
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
        return res.status(404).json({ error: `Ticker "${ticker}" not found or no data available.` });
      }

      const { quote, financials, analystData, profile } = extractQuoteData(summary);

      if (!quote.regularMarketPrice && !quote.marketCap) {
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

  return httpServer;
}
