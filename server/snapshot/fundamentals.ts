/**
 * Fundamentals adapter.
 *
 * Provider chain: derived from quote summary (Polygon-shaped) primary, FMP
 * /ratios-ttm + /income-statement fallback.
 *
 * The Polygon quote summary already includes a financialData block populated
 * from Polygon's /vX/reference/financials TTM call. We extract from there
 * first because it's already cached and aligns with the quote we just
 * fetched. Only on miss do we make a separate FMP call.
 */

import type { CompanyFundamentals, FieldHealth } from "./types";
import { tryProviders } from "./fallback";
import { fmpGet } from "../data/providers/fmp.client";
import { getPolygonQuoteSummary } from "../polygon";

const FUNDAMENTALS_TTL_MS = 6 * 60 * 60 * 1000; // 6h

function num(v: any): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "object" && v.raw !== undefined) v = v.raw;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fundamentalsFromQuoteSummary(summary: any): CompanyFundamentals | null {
  if (!summary) return null;
  const f = summary.financialData || {};
  const k = summary.defaultKeyStatistics || {};

  const out: CompanyFundamentals = {
    revenue: num(f.totalRevenue),
    revenueGrowth: num(f.revenueGrowth) !== null ? (num(f.revenueGrowth)! * 100) : null,
    grossMargin: num(f.grossMargins) !== null ? (num(f.grossMargins)! * 100) : null,
    operatingMargin: num(f.operatingMargins) !== null ? (num(f.operatingMargins)! * 100) : null,
    profitMargin: num(f.profitMargins) !== null ? (num(f.profitMargins)! * 100) : null,
    ebitdaMargin: num(f.ebitdaMargins) !== null ? (num(f.ebitdaMargins)! * 100) : null,
    netIncome: null,
    earningsGrowth: num(f.earningsGrowth) !== null ? (num(f.earningsGrowth)! * 100) : null,
    payoutRatio: num(k.payoutRatio) !== null ? (num(k.payoutRatio)! * 100) : null,
    debtToEquity: num(f.debtToEquity),
    currentRatio: num(f.currentRatio),
    returnOnEquity: num(f.returnOnEquity) !== null ? (num(f.returnOnEquity)! * 100) : null,
    totalDebt: num(f.totalDebt),
    totalCash: num(f.totalCash),
    freeCashFlow: num(f.freeCashflow),
    operatingCashFlow: num(f.operatingCashflow),
  };

  // Consider it useful only if we got *something* meaningful
  const hasAny = Object.values(out).some(v => v !== null);
  return hasAny ? out : null;
}

function fundamentalsFromFmp(ratios: any, income: any): CompanyFundamentals | null {
  if (!ratios && !income) return null;
  const r = ratios || {};
  const i = income || {};

  const out: CompanyFundamentals = {
    revenue: num(i.revenue),
    revenueGrowth: null,            // would need YoY comparison of two periods
    grossMargin: num(r.grossProfitMargin) !== null ? num(r.grossProfitMargin)! * 100 : null,
    operatingMargin: num(r.operatingProfitMargin) !== null ? num(r.operatingProfitMargin)! * 100 : null,
    profitMargin: num(r.netProfitMargin) !== null ? num(r.netProfitMargin)! * 100 : null,
    ebitdaMargin: null,
    netIncome: num(i.netIncome),
    earningsGrowth: null,
    payoutRatio: num(r.payoutRatio) !== null ? num(r.payoutRatio)! * 100 : null,
    debtToEquity: num(r.debtEquityRatio) !== null ? num(r.debtEquityRatio)! * 100 : null,
    currentRatio: num(r.currentRatio),
    returnOnEquity: num(r.returnOnEquity) !== null ? num(r.returnOnEquity)! * 100 : null,
    totalDebt: null,
    totalCash: null,
    freeCashFlow: num(i.freeCashFlow),
    operatingCashFlow: null,
  };
  const hasAny = Object.values(out).some(v => v !== null);
  return hasAny ? out : null;
}

export async function getFundamentalsSnapshot(ticker: string): Promise<FieldHealth<CompanyFundamentals>> {
  const T = ticker.toUpperCase();
  const result = await tryProviders<CompanyFundamentals>(
    [
      {
        source: "polygon",
        fetch: async () => {
          const summary = await getPolygonQuoteSummary(T);
          return fundamentalsFromQuoteSummary(summary);
        },
      },
      {
        source: "fmp",
        fetch: async () => {
          const [ratiosRows, incomeRows] = await Promise.all([
            fmpGet<any[]>(`/ratios-ttm`, { symbol: T }).catch(() => []),
            fmpGet<any[]>(`/income-statement`, { symbol: T, limit: 1 }).catch(() => []),
          ]);
          const ratios = Array.isArray(ratiosRows) && ratiosRows.length ? ratiosRows[0] : null;
          const income = Array.isArray(incomeRows) && incomeRows.length ? incomeRows[0] : null;
          return fundamentalsFromFmp(ratios, income);
        },
      },
    ],
    {
      ttlMs: FUNDAMENTALS_TTL_MS,
      isEmpty: (f) => Object.values(f).every(v => v === null),
    },
  );

  // Per-field FMP enrichment for fields Polygon's quoteSummary patchily
  // returns. Polygon answers with a populated fundamentals blob but leaves
  // some fields null on certain tickers — PLTR and KO observed missing
  // debtToEquity, AAPL observed missing it on some refreshes. Rather than
  // throwing the whole Polygon result away (it has lots of useful fields),
  // we patch the missing one from FMP /ratios-ttm. Same pattern as the
  // FMP beta fallback in quote.ts.
  //
  // Fields chosen because they have a clean 1:1 mapping AND meaningfully
  // affect scoring:
  //   - debtToEquity → Balance Sheet Quality (10% weight)
  //   - returnOnEquity → currently unused by scoring but useful elsewhere
  //
  // Payout ratio is intentionally NOT patched — null on Polygon often means
  // "no dividend" which the score treats correctly as a low income-quality
  // signal. Patching from FMP would force "0%" which scores slightly worse
  // and is semantically the same thing.
  if (result.value && (result.value.debtToEquity === null || result.value.returnOnEquity === null)) {
    try {
      // FMP's stable API returns fields with TTM suffix on /ratios-ttm
      // (e.g. `debtEquityRatioTTM`) but the v3 endpoint returns the
      // non-suffixed names. Try /ratios-ttm first, then /key-metrics-ttm
      // as a backup. Coalesce across all common field-name variants
      // so we don't silently miss the value because of one naming
      // inconsistency.
      const [ratiosRows, keyMetricsRows] = await Promise.all([
        fmpGet<any[]>(`/ratios-ttm`, { symbol: T }).catch(() => []),
        fmpGet<any[]>(`/key-metrics-ttm`, { symbol: T }).catch(() => []),
      ]);
      const r1 = Array.isArray(ratiosRows) && ratiosRows.length ? ratiosRows[0] : {};
      const r2 = Array.isArray(keyMetricsRows) && keyMetricsRows.length ? keyMetricsRows[0] : {};
      const merged: Record<string, any> = { ...r2, ...r1 }; // ratios wins on conflict

      const pickNum = (...keys: string[]): number | null => {
        for (const k of keys) {
          const v = num(merged[k]);
          if (v !== null) return v;
        }
        return null;
      };

      const patched = { ...result.value };

      if (patched.debtToEquity === null) {
        const der = pickNum(
          "debtEquityRatioTTM", "debtEquityRatio",
          "debtToEquityTTM", "debtToEquity",
        );
        // FMP returns these as fractions (0.777 = 77.7%) consistently
        // across /ratios-ttm and /key-metrics-ttm. Match the existing
        // fundamentalsFromFmp convention: multiply by 100.
        if (der !== null) patched.debtToEquity = der * 100;
      }
      if (patched.returnOnEquity === null) {
        const roe = pickNum(
          "returnOnEquityTTM", "returnOnEquity",
          "roeTTM", "roe",
        );
        if (roe !== null) patched.returnOnEquity = roe * 100;
      }

      result.value = patched;
    } catch {
      // Non-fatal. Fields stay null; scoring falls back to neutral.
    }
  }

  return result;
}
