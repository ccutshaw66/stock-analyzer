/**
 * Quote adapter for the snapshot pipeline.
 *
 * Provider chain (FMP-primary as of 2026-05-06):
 *   1. FMP — /quote + /profile + /ratios-ttm in parallel, merged into one
 *      CompanyQuote. Covers price, marketCap, trailingPE, beta, dividendYield,
 *      52w high/low, etc. Forward PE not exposed on FMP's basic stable
 *      endpoints — left null. Three-call latency (~600ms vs Polygon's
 *      single call ~250ms) is the cost of dropping Polygon Stocks.
 *   2. Polygon — kept as fallback for resilience. Returns a quoteSummary-shaped
 *      blob via getPolygonQuoteSummary.
 *
 * The chain reorder is part of the broader migration off Polygon Stocks
 * Starter — the goal is for FMP to answer 100% of the time on the happy
 * path so we can cancel the Polygon Stocks sub once /api/verdict and
 * legacy `getChart` are also flipped.
 */

import type { CompanyQuote, FieldHealth } from "./types";
import { tryProviders } from "./fallback";
import { getPolygonQuoteSummary } from "../polygon";
import { fmpGet } from "../data/providers/fmp.client";
import { getFmpProfileBeta } from "../data/providers/fmp.adapter";

const QUOTE_TTL_MS = 5 * 60 * 1000;

function num(v: any): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "object" && v.raw !== undefined) v = v.raw;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function quoteFromSummaryShape(summary: any): CompanyQuote | null {
  if (!summary) return null;
  const price = summary.price || {};
  const detail = summary.summaryDetail || {};
  const keyStats = summary.defaultKeyStatistics || {};

  const regPrice = num(price.regularMarketPrice);
  const marketCap = num(price.marketCap);
  if (regPrice === null && marketCap === null) return null;

  // regularMarketChangePercent is a decimal fraction (0.0123 = 1.23%).
  // Polygon's adapter normalizes to this shape. Output as percent.
  const pctRaw = num(price.regularMarketChangePercent);
  const changePct = pctRaw === null
    ? null
    : (Math.abs(pctRaw) < 1 ? pctRaw * 100 : pctRaw);

  // dividendYield is a decimal fraction; we want percent.
  const dyRaw = num(detail.dividendYield) ?? num(detail.trailingAnnualDividendYield);
  const dividendYield = dyRaw === null ? null : dyRaw * 100;

  return {
    shortName: price.shortName || null,
    longName: price.longName || price.shortName || null,
    currency: price.currency || "USD",
    price: regPrice,
    change: num(price.regularMarketChange),
    changePct,
    volume: num(price.regularMarketVolume),
    averageVolume: num(price.averageDailyVolume3Month) ?? num(detail.averageVolume),
    marketCap,
    trailingPE: num(detail.trailingPE) ?? num(keyStats.trailingPE),
    forwardPE: num(detail.forwardPE) ?? num(keyStats.forwardPE),
    eps: num(keyStats.trailingEps),
    dividendYield,
    beta: num(keyStats.beta),
    fiftyTwoWeekHigh: num(detail.fiftyTwoWeekHigh),
    fiftyTwoWeekLow: num(detail.fiftyTwoWeekLow),
  };
}

function quoteFromFmp(row: any): CompanyQuote | null {
  if (!row || typeof row !== "object") return null;
  const price = num(row.price);
  if (price === null) return null;

  return {
    shortName: row.symbol || null,
    longName: row.name || null,
    currency: "USD",
    price,
    change: num(row.change),
    changePct: num(row.changePercentage) ?? num(row.changesPercentage),
    volume: num(row.volume),
    averageVolume: num(row.avgVolume),
    marketCap: num(row.marketCap),
    trailingPE: num(row.pe),
    forwardPE: null,
    eps: num(row.eps),
    dividendYield: null,
    beta: null,
    fiftyTwoWeekHigh: num(row.yearHigh),
    fiftyTwoWeekLow: num(row.yearLow),
  };
}

/**
 * Full FMP quote: /quote (price/volume/PE) + /profile (beta, dividend) +
 * /ratios-ttm (dividend yield TTM, P/E TTM as backup) merged into a single
 * CompanyQuote. This is the new FMP-primary path — replaces the basic
 * quoteFromFmp(/quote-only) when Polygon was primary and FMP was the
 * fallback.
 */
async function fmpQuoteFull(ticker: string): Promise<CompanyQuote | null> {
  const T = ticker.toUpperCase();
  const [quoteRows, profileRows, ratiosRows] = await Promise.all([
    fmpGet<any[]>(`/quote`, { symbol: T }).catch(() => []),
    fmpGet<any[]>(`/profile`, { symbol: T }).catch(() => []),
    fmpGet<any[]>(`/ratios-ttm`, { symbol: T }).catch(() => []),
  ]);
  const q = Array.isArray(quoteRows) && quoteRows.length ? quoteRows[0] : null;
  if (!q || num(q.price) === null) return null; // no usable price → fall through
  const p = Array.isArray(profileRows) && profileRows.length ? profileRows[0] : {};
  const r = Array.isArray(ratiosRows) && ratiosRows.length ? ratiosRows[0] : {};

  // Dividend yield from /ratios-ttm.dividendYieldTTM (FMP returns a fraction
  // — 0.0046 for 0.46%). Falls back to /profile.lastDividend ÷ price × 4
  // (assumes quarterly cadence) only if TTM missing — most paying tickers
  // have it.
  let dividendYield: number | null = null;
  const dyTtm = num(r.dividendYieldTTM);
  if (dyTtm !== null) {
    dividendYield = dyTtm * 100;
  } else {
    const lastDiv = num(p.lastDividend);
    const priceNow = num(q.price);
    if (lastDiv !== null && priceNow !== null && priceNow > 0 && lastDiv > 0) {
      dividendYield = (lastDiv * 4 / priceNow) * 100; // approximate
    }
  }

  return {
    shortName: q.symbol || null,
    longName: q.name || p.companyName || null,
    currency: p.currency || "USD",
    price: num(q.price),
    change: num(q.change),
    changePct: num(q.changePercentage) ?? num(q.changesPercentage),
    volume: num(q.volume),
    averageVolume: num(q.avgVolume) ?? num(q.averageVolume),
    marketCap: num(q.marketCap) ?? num(p.marketCap),
    trailingPE: num(q.pe) ?? num(r.priceToEarningsRatioTTM),
    forwardPE: null, // FMP basic stable endpoints don't expose forward P/E
    eps: num(q.eps) ?? num(r.netIncomePerShareTTM),
    dividendYield,
    beta: num(p.beta),
    fiftyTwoWeekHigh: num(q.yearHigh),
    fiftyTwoWeekLow: num(q.yearLow),
  };
}

export async function getQuoteSnapshot(
  ticker: string,
): Promise<FieldHealth<CompanyQuote>> {
  const T = ticker.toUpperCase();
  const result = await tryProviders<CompanyQuote>(
    [
      {
        source: "fmp",
        fetch: () => fmpQuoteFull(T),
      },
      {
        source: "polygon",
        fetch: async () => {
          const summary = await getPolygonQuoteSummary(T);
          return quoteFromSummaryShape(summary);
        },
      },
    ],
    {
      ttlMs: QUOTE_TTL_MS,
      isEmpty: (q) => q.price === null && q.marketCap === null,
    },
  );

  // Beta + dividend yield enrichment when the answer came from a non-FMP
  // source (Polygon hardcodes beta: null).
  // FMP-primary path gets beta + dividendYield directly via fmpQuoteFull,
  // so this block only fires when we fell through to a backup provider.
  if (result.value && (result.value.beta === null || result.value.dividendYield === null)) {
    try {
      const fmpBeta = await getFmpProfileBeta(T);
      if (fmpBeta !== null && result.value.beta === null) {
        result.value = { ...result.value, beta: fmpBeta };
      }
    } catch {
      // Non-fatal. The quote stays beta-less; thesis scoring falls back to neutral.
    }
  }

  return result;
}
