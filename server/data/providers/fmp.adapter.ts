/**
 * FMP adapter — normalizes Financial Modeling Prep responses into our
 * domain types. Uses server/data/providers/fmp.client.ts for the HTTP layer
 * (retry, cache, logging).
 *
 * Tier assumed: Premium ($59/mo). Rate limit: 750/min.
 *
 * Capabilities implemented:
 *   - analyst_ratings       (price-target-consensus + upgrades-downgrades-consensus)
 *   - earnings              (historical/earning_calendar + earnings-surprises)
 *   - insider_transactions  (insider-trading)
 *   - institutional_holdings (institutional-holder)
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
  // FMP date format is "YYYY-MM-DD" or full ISO; both parseable
  return new Date(s);
}

function num(x: any): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function normalizeConsensus(raw: any): AnalystRating["consensus"] {
  // FMP returns variations like "Buy", "Strong Buy", "Outperform", etc.
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
    // Two calls composed: price-target-consensus (targets) + ratings (consensus label).
    const [targets, ratings] = await Promise.all([
      fmpGet<any[]>(`/v4/price-target-consensus`, { symbol }),
      // /v3/rating/{symbol} returns an overall rating letter + recommendations
      fmpGet<any[]>(`/v3/rating/${encodeURIComponent(symbol)}`),
    ]);

    const t = Array.isArray(targets) && targets.length ? targets[0] : {};
    const r = Array.isArray(ratings) && ratings.length ? ratings[0] : {};

    return {
      symbol,
      asOf: toDate(r.date || new Date()),
      consensus: normalizeConsensus(r.ratingRecommendation),
      priceTargetLow: num(t.targetLow),
      priceTargetAvg: num(t.targetConsensus ?? t.targetMedian),
      priceTargetHigh: num(t.targetHigh),
      analystCount: num(t.numberOfAnalysts ?? t.numberOfAnalyst),
      source: "fmp",
    };
  },

  async getEarnings(symbol: Symbol, limit = 8): Promise<EarningsEvent[]> {
    // Historical earning_calendar gives us report date + surprise; earnings-surprises
    // gives the clean surprise pct. Prefer the calendar when both present.
    const rows = await fmpGet<any[]>(
      `/v3/historical/earning_calendar/${encodeURIComponent(symbol)}`,
      { limit },
    );
    if (!Array.isArray(rows)) return [];

    return rows.map((r) => {
      const epsEst = r.epsEstimated != null ? num(r.epsEstimated) : undefined;
      const epsAct = r.eps != null ? num(r.eps) : undefined;
      const revEst = r.revenueEstimated != null ? num(r.revenueEstimated) : undefined;
      const revAct = r.revenue != null ? num(r.revenue) : undefined;
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
    const rows = await fmpGet<any[]>(`/v4/insider-trading`, { symbol, limit });
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
    // /v3/institutional-holder/{symbol} returns the Top N institutional holders.
    const rows = await fmpGet<any[]>(
      `/v3/institutional-holder/${encodeURIComponent(symbol)}`,
    );
    if (!Array.isArray(rows)) return [];
    return rows.map((r) => ({
      symbol,
      reportDate: toDate(r.dateReported),
      institutionName: String(r.holder || ""),
      sharesHeld: num(r.shares),
      sharesChange: num(r.change),
      // FMP returns ownership as a percentage — we just pass it through.
      // May be 0 if not provided; downstream code can infer from float.
      percentOfFloat: num(r.weightPercentage ?? r.ownership ?? 0),
      source: "fmp",
    }));
  },

  async getFinancials(symbol: Symbol, limit = 8): Promise<FinancialSnapshot[]> {
    // Annual income statement for the core fields + TTM ratios for P/E etc.
    const [income, ratiosTtm] = await Promise.all([
      fmpGet<any[]>(`/v3/income-statement/${encodeURIComponent(symbol)}`, { limit }),
      fmpGet<any[]>(`/v3/ratios-ttm/${encodeURIComponent(symbol)}`),
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
      peRatio: idx === 0 ? num(ratios.peRatioTTM) || undefined : undefined,
      pbRatio: idx === 0 ? num(ratios.priceToBookRatioTTM) || undefined : undefined,
      debtToEquity: idx === 0 ? num(ratios.debtEquityRatioTTM) || undefined : undefined,
      roe: idx === 0 ? num(ratios.returnOnEquityTTM) || undefined : undefined,
      source: "fmp",
    }));
  },
};
