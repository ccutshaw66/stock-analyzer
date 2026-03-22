import type { Express } from "express";
import { createServer, type Server } from "http";
import YahooFinanceModule from "yahoo-finance2";
// Handle both ESM and CJS default export patterns
const YF = (YahooFinanceModule as any).default || YahooFinanceModule;
const yahooFinance = typeof YF === 'function' ? new YF() : YF;

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
  return Number(val);
}

function pctChange(current: number, previous: number): number | null {
  if (!previous || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
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

function trendDirection(values: (number | null)[]): "up" | "down" | "flat" {
  const valid = values.filter((v): v is number => v !== null);
  if (valid.length < 2) return "flat";
  const recent = valid.slice(-Math.min(3, valid.length));
  const first = recent[0];
  const last = recent[recent.length - 1];
  const change = pctChange(last, first);
  if (change === null) return "flat";
  if (change > 5) return "up";
  if (change < -5) return "down";
  return "flat";
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

  // Positives
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

  // Risks
  if (pe !== null && pe > 40) risks.push(`Elevated valuation at ${pe.toFixed(1)}x earnings`);
  if (pe !== null && pe < 0) risks.push(`Negative earnings — currently unprofitable`);
  if (debtToEquity !== null && debtToEquity > 100) risks.push(`High leverage with D/E of ${debtToEquity.toFixed(1)}%`);
  if (revenueGrowth !== null && revenueGrowth < 0) risks.push(`Revenue declining at ${revenueGrowth.toFixed(1)}%`);
  if (divYield === null || divYield === 0) risks.push(`No dividend income`);
  if (ret1y !== null && ret1y !== undefined && ret1y < -10) risks.push(`Poor 1-year return of ${ret1y.toFixed(1)}%`);
  const beta = safeNum(quote?.beta);
  if (beta !== null && beta > 1.5) risks.push(`High volatility with beta of ${beta.toFixed(2)}`);
  if (marketCap !== null && marketCap < 2e9) risks.push(`Small-cap risk (${formatLargeNumber(marketCap)} market cap)`);

  // Ensure at least 3 of each
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
  while (positives.length < 3 && pIdx < fallbackPositives.length) {
    positives.push(fallbackPositives[pIdx++]);
  }
  let rIdx = 0;
  while (risks.length < 3 && rIdx < fallbackRisks.length) {
    risks.push(fallbackRisks[rIdx++]);
  }

  return { positives: positives.slice(0, 3), risks: risks.slice(0, 3) };
}

function generateRedFlags(data: any): RedFlag[] {
  const { quote, financials } = data;
  const pe = safeNum(quote?.trailingPE);
  const divYield = safeNum(quote?.dividendYield);
  const debtToEquity = safeNum(financials?.debtToEquity);
  const payoutRatio = safeNum(financials?.payoutRatio);
  const revenueGrowth = safeNum(financials?.revenueGrowth);
  const currentRatio = safeNum(financials?.currentRatio);
  const marketCap = safeNum(quote?.marketCap);
  const avgVolume = safeNum(quote?.averageDailyVolume3Month);
  const grossMargin = safeNum(financials?.grossMargin);
  const fcf = safeNum(financials?.freeCashFlow);

  return [
    {
      label: "Negative Earnings",
      flagged: pe !== null && pe < 0,
      detail: pe !== null && pe < 0 ? `P/E is negative (${pe.toFixed(1)})` : "Company is profitable",
    },
    {
      label: "Excessive Debt",
      flagged: debtToEquity !== null && debtToEquity > 150,
      detail: debtToEquity !== null ? `D/E ratio: ${debtToEquity.toFixed(1)}%` : "No debt data",
    },
    {
      label: "Dividend Cut Risk",
      flagged: payoutRatio !== null && payoutRatio > 100,
      detail: payoutRatio !== null ? `Payout ratio: ${payoutRatio.toFixed(1)}%` : "No payout data",
    },
    {
      label: "Revenue Decline",
      flagged: revenueGrowth !== null && revenueGrowth < -5,
      detail: revenueGrowth !== null ? `Revenue growth: ${revenueGrowth.toFixed(1)}%` : "No growth data",
    },
    {
      label: "Low Liquidity",
      flagged: avgVolume !== null && avgVolume < 100000,
      detail: avgVolume !== null ? `Avg volume: ${formatLargeNumber(avgVolume)}` : "No volume data",
    },
    {
      label: "Micro-Cap Risk",
      flagged: marketCap !== null && marketCap < 300e6,
      detail: marketCap !== null ? `Market cap: ${formatLargeNumber(marketCap)}` : "No market cap data",
    },
    {
      label: "Poor Liquidity Ratio",
      flagged: currentRatio !== null && currentRatio < 1,
      detail: currentRatio !== null ? `Current ratio: ${currentRatio.toFixed(2)}` : "No data",
    },
    {
      label: "Extremely High Valuation",
      flagged: pe !== null && pe > 60,
      detail: pe !== null ? `P/E: ${pe.toFixed(1)}` : "No P/E data",
    },
    {
      label: "Negative Free Cash Flow",
      flagged: fcf !== null && fcf < 0,
      detail: fcf !== null ? `FCF: ${formatLargeNumber(fcf)}` : "No FCF data",
    },
    {
      label: "Eroding Margins",
      flagged: grossMargin !== null && grossMargin < 15,
      detail: grossMargin !== null ? `Gross margin: ${grossMargin.toFixed(1)}%` : "No margin data",
    },
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

  const questions: DecisionQuestion[] = [
    {
      question: "Is the company profitable?",
      answer: pe !== null && pe > 0 ? "Yes" : "No",
      color: pe !== null && pe > 0 ? "green" : "red",
    },
    {
      question: "Is revenue growing?",
      answer: revenueGrowth !== null && revenueGrowth > 0 ? "Yes" : revenueGrowth === null ? "N/A" : "No",
      color: revenueGrowth !== null && revenueGrowth > 0 ? "green" : revenueGrowth === null ? "yellow" : "red",
    },
    {
      question: "Is debt manageable (D/E < 100%)?",
      answer: debtToEquity !== null && debtToEquity < 100 ? "Yes" : debtToEquity === null ? "N/A" : "No",
      color: debtToEquity !== null && debtToEquity < 100 ? "green" : debtToEquity === null ? "yellow" : "red",
    },
    {
      question: "Does it pay or grow dividends?",
      answer: divYield !== null && divYield > 0 ? "Yes" : "No",
      color: divYield !== null && divYield > 0 ? "green" : "red",
    },
    {
      question: "Has it outperformed over 1 year?",
      answer: ret1y !== null && ret1y !== undefined && ret1y > 0 ? "Yes" : ret1y === null || ret1y === undefined ? "N/A" : "No",
      color: ret1y !== null && ret1y !== undefined && ret1y > 0 ? "green" : (ret1y === null || ret1y === undefined) ? "yellow" : "red",
    },
    {
      question: "Is it large-cap (>$10B)?",
      answer: marketCap !== null && marketCap > 10e9 ? "Yes" : "No",
      color: marketCap !== null && marketCap > 10e9 ? "green" : "red",
    },
    {
      question: "Is free cash flow positive?",
      answer: fcf !== null && fcf > 0 ? "Yes" : fcf === null ? "N/A" : "No",
      color: fcf !== null && fcf > 0 ? "green" : fcf === null ? "yellow" : "red",
    },
  ];

  return questions;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.get("/api/analyze/:ticker", async (req, res) => {
    const ticker = req.params.ticker.toUpperCase();

    try {
      // Fetch all data in parallel
      const [quoteData, summaryDetail, historicalData1Y, historicalData3Y, historicalData5Y] = await Promise.allSettled([
        yahooFinance.quote(ticker),
        yahooFinance.quoteSummary(ticker, {
          modules: [
            "summaryProfile",
            "financialData",
            "defaultKeyStatistics",
            "incomeStatementHistory",
            "balanceSheetHistory",
            "cashflowStatementHistory",
            "recommendationTrend",
            "upgradeDowngradeHistory",
            "earningsTrend",
          ],
        }),
        yahooFinance.chart(ticker, { period1: getDateYearsAgo(1), period2: new Date().toISOString().split("T")[0], interval: "1d" }),
        yahooFinance.chart(ticker, { period1: getDateYearsAgo(3), period2: new Date().toISOString().split("T")[0], interval: "1wk" }),
        yahooFinance.chart(ticker, { period1: getDateYearsAgo(5), period2: new Date().toISOString().split("T")[0], interval: "1wk" }),
      ]);

      const quote = quoteData.status === "fulfilled" ? quoteData.value : null;
      const summary = summaryDetail.status === "fulfilled" ? summaryDetail.value : null;
      const chart1Y = historicalData1Y.status === "fulfilled" ? historicalData1Y.value : null;
      const chart3Y = historicalData3Y.status === "fulfilled" ? historicalData3Y.value : null;
      const chart5Y = historicalData5Y.status === "fulfilled" ? historicalData5Y.value : null;

      if (!quote) {
        return res.status(404).json({ error: `Ticker "${ticker}" not found or no data available.` });
      }

      // Extract financials
      const financialData = summary?.financialData;
      const keyStats = summary?.defaultKeyStatistics;
      const profile = summary?.summaryProfile;
      const recommendations = summary?.recommendationTrend;

      // Compute historical returns
      const compute1YReturn = computeReturn(chart1Y);
      const compute3YReturn = computeReturn(chart3Y);
      const compute5YReturn = computeReturn(chart5Y);

      // Build chart data (1Y daily prices)
      const chartData = chart1Y?.quotes?.map((q: any) => ({
        date: q.date instanceof Date ? q.date.toISOString().split("T")[0] : String(q.date).split("T")[0],
        close: q.close ? Number(q.close.toFixed(2)) : null,
      })).filter((d: any) => d.close !== null) ?? [];

      // Build financials object
      const financials = {
        revenueGrowth: safeNum(financialData?.revenueGrowth) !== null ? safeNum(financialData?.revenueGrowth)! * 100 : null,
        grossMargin: safeNum(financialData?.grossMargins) !== null ? safeNum(financialData?.grossMargins)! * 100 : null,
        ebitdaMargin: safeNum(financialData?.ebitdaMargins) !== null ? safeNum(financialData?.ebitdaMargins)! * 100 : null,
        operatingMargin: safeNum(financialData?.operatingMargins) !== null ? safeNum(financialData?.operatingMargins)! * 100 : null,
        profitMargin: safeNum(financialData?.profitMargins) !== null ? safeNum(financialData?.profitMargins)! * 100 : null,
        debtToEquity: safeNum(financialData?.debtToEquity),
        currentRatio: safeNum(financialData?.currentRatio),
        returnOnEquity: safeNum(financialData?.returnOnEquity) !== null ? safeNum(financialData?.returnOnEquity)! * 100 : null,
        freeCashFlow: safeNum(financialData?.freeCashflow),
        operatingCashFlow: safeNum(financialData?.operatingCashflow),
        totalRevenue: safeNum(financialData?.totalRevenue),
        totalDebt: safeNum(financialData?.totalDebt),
        totalCash: safeNum(financialData?.totalCash),
        payoutRatio: safeNum(keyStats?.payoutRatio) !== null ? safeNum(keyStats?.payoutRatio)! * 100 : null,
        earningsGrowth: safeNum(financialData?.earningsGrowth) !== null ? safeNum(financialData?.earningsGrowth)! * 100 : null,
      };

      const historicalReturns = {
        oneYear: compute1YReturn,
        threeYear: compute3YReturn,
        fiveYear: compute5YReturn,
      };

      // Analyst data
      const recTrend = recommendations?.trend?.[0];
      const analystData = {
        buy: (safeNum(recTrend?.strongBuy) ?? 0) + (safeNum(recTrend?.buy) ?? 0),
        hold: safeNum(recTrend?.hold) ?? 0,
        sell: (safeNum(recTrend?.sell) ?? 0) + (safeNum(recTrend?.strongSell) ?? 0),
        targetMean: safeNum(financialData?.targetMeanPrice),
        targetHigh: safeNum(financialData?.targetHighPrice),
        targetLow: safeNum(financialData?.targetLowPrice),
        recommendation: financialData?.recommendationKey ?? null,
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
      const quoteType = (quote as any).quoteType || "EQUITY";
      let assetType = "Stock";
      if (quoteType === "ETF") assetType = "ETF";
      else if (quoteType === "MUTUALFUND") assetType = "Mutual Fund";
      else if (quoteType === "CRYPTOCURRENCY") assetType = "Cryptocurrency";

      // Determine mission fit and best use
      const divYield = safeNum(quote?.dividendYield);
      let missionFit = "Growth";
      let bestUse = "Capital Appreciation";
      if (divYield !== null && divYield > 3) {
        missionFit = "Income";
        bestUse = "Dividend Income";
      } else if (divYield !== null && divYield > 1) {
        missionFit = "Balanced";
        bestUse = "Growth + Income";
      }

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

      // Business quality details
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

      // Price change data
      const regularPrice = safeNum(quote?.regularMarketPrice);
      const regularChange = safeNum(quote?.regularMarketChange);
      const regularChangePct = safeNum(quote?.regularMarketChangePercent);

      const responseData = {
        ticker,
        companyName: quote?.longName || quote?.shortName || ticker,
        assetType,
        sector: profile?.sector || (quote as any)?.sector || "N/A",
        industry: profile?.industry || (quote as any)?.industry || "N/A",
        description: profile?.longBusinessSummary || null,
        employees: safeNum(profile?.fullTimeEmployees),

        // Verdict
        verdict,
        score: Number(weightedScore.toFixed(2)),
        ruling,
        missionFit,
        bestUse,
        positives,
        risks,

        // Price
        price: regularPrice,
        change: regularChange,
        changePercent: regularChangePct,
        currency: quote?.currency || "USD",

        // Snapshot
        marketCap: safeNum(quote?.marketCap),
        pe: safeNum(quote?.trailingPE),
        forwardPe: safeNum(quote?.forwardPE),
        eps: safeNum(quote?.epsTrailingTwelveMonths),
        dividendYield: divYield,
        volume: safeNum(quote?.regularMarketVolume),
        avgVolume: safeNum(quote?.averageDailyVolume3Month),
        beta: safeNum(quote?.beta),
        fiftyTwoWeekHigh: safeNum(quote?.fiftyTwoWeekHigh),
        fiftyTwoWeekLow: safeNum(quote?.fiftyTwoWeekLow),

        // Quick trade
        sentiment,
        analystData,

        // Business quality
        businessQuality,

        // Financials
        financials,

        // Performance
        historicalReturns,
        chartData,

        // Income analysis
        incomeAnalysis,

        // Scoring
        scoring,

        // Red flags
        redFlags,

        // Decision shortcut
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

function getDateYearsAgo(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().split("T")[0];
}

function computeReturn(chartData: any): number | null {
  if (!chartData?.quotes || chartData.quotes.length < 2) return null;
  const quotes = chartData.quotes.filter((q: any) => q.close != null);
  if (quotes.length < 2) return null;
  const first = quotes[0].close;
  const last = quotes[quotes.length - 1].close;
  if (!first || first === 0) return null;
  return ((last - first) / first) * 100;
}
