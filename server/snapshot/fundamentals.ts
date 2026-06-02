/**
 * Fundamentals adapter.
 *
 * Provider: FMP only (Polygon fallback dropped 2026-05-31 — Polygon kill).
 *   FMP — /ratios-ttm + /income-statement merged (using the correct
 *   stable-API TTM field names — see CHANGES.md 2026-05-06 for the
 *   systemic-bug fix that made this path actually work).
 *
 * Field-level FMP enrichment still runs after `tryProviders` for D/E and
 * ROE specifically — fields where FMP's primary TTM endpoint occasionally
 * returns null and /key-metrics-ttm fills the gap.
 */

import type { CompanyFundamentals, FieldHealth } from "./types";
import { tryProviders } from "./fallback";
import { fmpGet } from "../data/providers/fmp.client";

const FUNDAMENTALS_TTL_MS = 6 * 60 * 60 * 1000; // 6h

function num(v: any): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "object" && v.raw !== undefined) v = v.raw;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fundamentalsFromFmp(ratios: any, income: any, incomePrior: any = null): CompanyFundamentals | null {
  if (!ratios && !income) return null;
  const r = ratios || {};
  const i = income || {};
  const ip = incomePrior || {};

  // Compute YoY growth ourselves — FMP /ratios-ttm doesn't expose
  // revenueGrowth or earningsGrowth (those need two periods). With
  // /income-statement?limit=2 we have current + prior periods to diff.
  const revCurrent = num(i.revenue);
  const revPrior   = num(ip.revenue);
  const niCurrent  = num(i.netIncome);
  const niPrior    = num(ip.netIncome);

  // YoY % growth, returned as a PERCENT (5 = +5%). Returns null when the figure
  // isn't meaningful, so downstream never narrates garbage like "-17059%":
  //   - prior base ≤ 0 (can't compute growth off zero/negative)
  //   - current swung negative (a turnaround/loss isn't a growth rate)
  //   - implausible magnitude (>500%), which is a near-zero-base artifact
  const yoyPct = (cur: number | null, prior: number | null): number | null => {
    if (cur === null || prior === null) return null;
    if (prior <= 0) return null;
    if (cur < 0) return null;
    const g = ((cur - prior) / prior) * 100;
    if (!Number.isFinite(g) || Math.abs(g) > 500) return null;
    return g;
  };
  const revenueGrowthCalc = yoyPct(revCurrent, revPrior);
  const earningsGrowthCalc = yoyPct(niCurrent, niPrior);

  // Helper: try TTM-suffixed field name first (FMP stable API), fall back to
  // non-suffixed (FMP v3 legacy). The stable migration in Aug 2025 changed
  // most ratio/key-metric fields to add TTM. The non-suffixed names are
  // kept as fallback in case a different endpoint returns them.
  const pick = (...keys: string[]): number | null => {
    for (const k of keys) {
      const v = num(r[k]);
      if (v !== null) return v;
    }
    return null;
  };

  const grossMargin     = pick("grossProfitMarginTTM", "grossProfitMargin");
  const operatingMargin = pick("operatingProfitMarginTTM", "operatingProfitMargin");
  const profitMargin    = pick("netProfitMarginTTM", "netProfitMargin");
  const payout          = pick("dividendPayoutRatioTTM", "payoutRatioTTM", "payoutRatio");
  const debtToEquity    = pick("debtToEquityRatioTTM", "debtEquityRatioTTM", "debtToEquity", "debtEquityRatio");
  const currentRatio    = pick("currentRatioTTM", "currentRatio");
  const returnOnEquity  = pick("returnOnEquityTTM", "returnOnEquity", "roeTTM", "roe");

  const out: CompanyFundamentals = {
    revenue: num(i.revenue),
    revenueGrowth: revenueGrowthCalc,
    grossMargin: grossMargin !== null ? grossMargin * 100 : null,
    operatingMargin: operatingMargin !== null ? operatingMargin * 100 : null,
    profitMargin: profitMargin !== null ? profitMargin * 100 : null,
    ebitdaMargin: null,
    netIncome: num(i.netIncome),
    earningsGrowth: earningsGrowthCalc,
    payoutRatio: payout !== null ? payout * 100 : null,
    debtToEquity: debtToEquity !== null ? debtToEquity * 100 : null,
    currentRatio,
    returnOnEquity: returnOnEquity !== null ? returnOnEquity * 100 : null,
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
        source: "fmp",
        fetch: async () => {
          // limit=2 so we can diff current vs prior period for YoY
          // revenueGrowth + earningsGrowth (FMP /ratios-ttm doesn't
          // expose growth metrics).
          const [ratiosRows, incomeRows] = await Promise.all([
            fmpGet<any[]>(`/ratios-ttm`, { symbol: T }).catch(() => []),
            fmpGet<any[]>(`/income-statement`, { symbol: T, limit: 2 }).catch(() => []),
          ]);
          const ratios = Array.isArray(ratiosRows) && ratiosRows.length ? ratiosRows[0] : null;
          const income = Array.isArray(incomeRows) && incomeRows.length >= 1 ? incomeRows[0] : null;
          const incomePrior = Array.isArray(incomeRows) && incomeRows.length >= 2 ? incomeRows[1] : null;
          return fundamentalsFromFmp(ratios, income, incomePrior);
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
  // Payout ratio is intentionally NOT patched — a null payout usually means
  // "no dividend" which the score treats correctly as a low income-quality
  // signal. Forcing "0%" would score slightly worse and is semantically the
  // same thing.
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
        // The actual stable-API field is `debtToEquityRatioTTM` (with "To"
        // and Ratio suffix). Other variants kept as defensive fallbacks.
        const der = pickNum(
          "debtToEquityRatioTTM", "debtEquityRatioTTM",
          "debtToEquity", "debtEquityRatio",
        );
        // FMP returns these as fractions (0.025 = 2.5%) consistently
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
