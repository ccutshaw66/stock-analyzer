/**
 * FMP adapter — normalizes Financial Modeling Prep responses into our
 * domain types. Uses server/data/providers/fmp.client.ts for the HTTP layer
 * (retry, cache, logging).
 *
 * Tier assumed: Premium ($59/mo). Rate limit: 750/min.
 *
 * API STYLE: Uses FMP's STABLE API (post-August 31, 2025 migration).
 * Legacy /v3 and /v4 endpoints are no longer available.
 *
 * Capabilities implemented:
 *   - analyst_ratings       (price-target-consensus + grades-consensus + ratings-snapshot)
 *   - earnings              (earnings per symbol)
 *   - insider_transactions  (insider-trading/search)
 *   - institutional_holdings (institutional-ownership/extract-analytics/holder)
 *   - financials            (income-statement + ratios-ttm)
 */
import type {
  DataProvider,
  AnalystRating,
  EarningsEvent,
  InsiderTransaction,
  InstitutionalHolding,
  FinancialSnapshot,
  Symbol,
} from "../types";
import { fmpGet } from "./fmp.client";

// ─── Helpers ────────────────────────────────────────────────────────────────
function toDate(s: string | number | Date | undefined): Date {
  if (!s) return new Date(NaN);
  if (s instanceof Date) return s;
  return new Date(s);
}

function num(x: any): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function normalizeConsensus(raw: any): AnalystRating["consensus"] {
  const s = String(raw || "").toLowerCase().trim();
  if (s.includes("strong") && s.includes("buy")) return "strong_buy";
  if (s === "buy" || s.includes("outperform") || s.includes("overweight")) return "buy";
  if (s === "hold" || s.includes("neutral") || s.includes("equal")) return "hold";
  if (s.includes("strong") && s.includes("sell")) return "strong_sell";
  if (s === "sell" || s.includes("underperform") || s.includes("underweight")) return "sell";
  return "hold";
}

function normalizeInsiderType(raw: any): InsiderTransaction["transactionType"] {
  const s = String(raw || "").toLowerCase();
  if (s.includes("p-purchase") || s.includes("buy") || s === "p") return "buy";
  if (s.includes("s-sale") || s.includes("sell") || s === "s") return "sell";
  if (s.includes("award") || s.includes("grant")) return "award";
  if (s.includes("exercise") || s.includes("m-")) return "exercise";
  return "sell"; // conservative default
}

/**
 * Return the most recently completed 13F filing quarter. 13F filings are due
 * 45 days after quarter end, so we step back one full quarter from "now" to be
 * safe. If the latest quarter has no data yet, the caller can retry with a
 * fallback (handled below in getInstitutionalHoldings).
 */
function latestFiledQuarter(now = new Date()): { year: number; quarter: number } {
  // Step back ~90 days to ensure the quarter has been filed
  const d = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const m = d.getUTCMonth(); // 0-11
  const quarter = Math.floor(m / 3) + 1; // 1-4
  const year = d.getUTCFullYear();
  return { year, quarter };
}

function prevQuarter(year: number, quarter: number): { year: number; quarter: number } {
  if (quarter === 1) return { year: year - 1, quarter: 4 };
  return { year, quarter: quarter - 1 };
}

// ─── Adapter ────────────────────────────────────────────────────────────────
export const fmpAdapter: DataProvider = {
  name: "fmp",
  capabilities: [
    "analyst_ratings",
    "earnings",
    "insider_transactions",
    "institutional_holdings",
    "financials",
  ],

  async getAnalystRatings(symbol: Symbol): Promise<AnalystRating> {
    // Compose: price-target-consensus (targets) + grades-consensus (buy/hold/sell counts).
    const [targets, grades] = await Promise.all([
      fmpGet<any[]>(`/price-target-consensus`, { symbol }),
      fmpGet<any[]>(`/grades-consensus`, { symbol }),
    ]);

    const t = Array.isArray(targets) && targets.length ? targets[0] : {};
    const g = Array.isArray(grades) && grades.length ? grades[0] : {};

    // Analyst count = sum of strongBuy + buy + hold + sell + strongSell
    const analystCount =
      num(g.strongBuy) + num(g.buy) + num(g.hold) + num(g.sell) + num(g.strongSell);

    return {
      symbol,
      asOf: new Date(),
      consensus: normalizeConsensus(g.consensus),
      priceTargetLow: num(t.targetLow),
      priceTargetAvg: num(t.targetConsensus ?? t.targetMedian),
      priceTargetHigh: num(t.targetHigh),
      analystCount,
      source: "fmp",
    };
  },

  async getEarnings(symbol: Symbol, limit = 8): Promise<EarningsEvent[]> {
    // Per-symbol historical+upcoming earnings.
    const rows = await fmpGet<any[]>(`/earnings`, { symbol, limit });
    if (!Array.isArray(rows)) return [];

    return rows.map((r) => {
      const epsEst = r.epsEstimated != null ? num(r.epsEstimated) : undefined;
      const epsAct = r.epsActual != null ? num(r.epsActual) : undefined;
      const revEst = r.revenueEstimated != null ? num(r.revenueEstimated) : undefined;
      const revAct = r.revenueActual != null ? num(r.revenueActual) : undefined;
      let surprisePct: number | undefined = undefined;
      if (epsEst != null && epsAct != null && epsEst !== 0) {
        surprisePct = ((epsAct - epsEst) / Math.abs(epsEst)) * 100;
      }
      return {
        symbol,
        reportDate: toDate(r.date),
        fiscalPeriod: r.fiscalDateEnding ? String(r.fiscalDateEnding) : "",
        epsEstimate: epsEst,
        epsActual: epsAct,
        revenueEstimate: revEst,
        revenueActual: revAct,
        surprisePct,
        source: "fmp",
      };
    });
  },

  async getInsiderTransactions(symbol: Symbol, limit = 50): Promise<InsiderTransaction[]> {
    // Stable search endpoint. `page` defaults to 0.
    const rows = await fmpGet<any[]>(`/insider-trading/search`, { symbol, page: 0, limit });
    if (!Array.isArray(rows)) return [];
    return rows.map((r) => {
      const shares = num(r.securitiesTransacted);
      const price = num(r.price);
      return {
        symbol,
        insiderName: String(r.reportingName || r.name || ""),
        role: String(r.typeOfOwner || r.relationship || ""),
        transactionDate: toDate(r.transactionDate || r.filingDate),
        transactionType: normalizeInsiderType(r.transactionType),
        shares,
        pricePerShare: price,
        totalValue: shares * price,
        source: "fmp",
      };
    });
  },

  async getInstitutionalHoldings(symbol: Symbol): Promise<InstitutionalHolding[]> {
    // 13F extract by holder. Requires year + quarter. Walk back up to 4 quarters
    // in case the most-recent quarter hasn't been filed yet.
    let { year, quarter } = latestFiledQuarter();
    let rows: any[] = [];
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fmpGet<any[]>(
        `/institutional-ownership/extract-analytics/holder`,
        { symbol, year: String(year), quarter: String(quarter), page: 0, limit: 50 },
      );
      if (Array.isArray(res) && res.length > 0) {
        rows = res;
        break;
      }
      const prev = prevQuarter(year, quarter);
      year = prev.year;
      quarter = prev.quarter;
    }
    if (!Array.isArray(rows)) return [];
    return rows.map((r) => ({
      symbol,
      reportDate: toDate(r.date),
      institutionName: String(r.investorName || r.holder || ""),
      sharesHeld: num(r.sharesNumber),
      sharesChange: num(r.changeInSharesNumber),
      // `ownership` in the stable response is already a percentage of total shares.
      percentOfFloat: num(r.ownership ?? r.portfolioPercentage ?? 0),
      source: "fmp",
    }));
  },

  async getFinancials(symbol: Symbol, limit = 8): Promise<FinancialSnapshot[]> {
    // Stable paths: /income-statement?symbol=AAPL, /ratios-ttm?symbol=AAPL
    const [income, ratiosTtm] = await Promise.all([
      fmpGet<any[]>(`/income-statement`, { symbol, limit }),
      fmpGet<any[]>(`/ratios-ttm`, { symbol }),
    ]);
    if (!Array.isArray(income)) return [];
    const ratios = Array.isArray(ratiosTtm) && ratiosTtm.length ? ratiosTtm[0] : {};
    return income.map((r, idx) => ({
      symbol,
      asOf: toDate(r.date),
      revenue: num(r.revenue),
      netIncome: num(r.netIncome),
      eps: num(r.eps ?? r.epsdiluted),
      // TTM ratios are a single snapshot — attach to the most recent period only
      peRatio: idx === 0
        ? num(ratios.priceToEarningsRatioTTM ?? ratios.peRatioTTM) || undefined
        : undefined,
      pbRatio: idx === 0
        ? num(ratios.priceToBookRatioTTM) || undefined
        : undefined,
      debtToEquity: idx === 0
        ? num(ratios.debtToEquityTTM ?? ratios.debtEquityRatioTTM) || undefined
        : undefined,
      roe: idx === 0
        ? num(ratios.returnOnEquityTTM) || undefined
        : undefined,
      source: "fmp",
    }));
  },
};
