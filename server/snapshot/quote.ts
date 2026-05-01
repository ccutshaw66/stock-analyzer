/**
 * Quote adapter for the snapshot pipeline.
 *
 * Provider chain: Polygon → FMP → Yahoo.
 *
 * Polygon's getPolygonQuoteSummary already returns a Yahoo-shaped blob, so
 * Polygon and Yahoo share the same translator. FMP /quote is a flat row.
 */

import type { CompanyQuote, FieldHealth } from "./types";
import { tryProviders } from "./fallback";
import { getPolygonQuoteSummary } from "../polygon";
import { fmpGet } from "../data/providers/fmp.client";

const QUOTE_TTL_MS = 5 * 60 * 1000;

function num(v: any): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "object" && v.raw !== undefined) v = v.raw;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function quoteFromYahooShape(summary: any): CompanyQuote | null {
  if (!summary) return null;
  const price = summary.price || {};
  const detail = summary.summaryDetail || {};
  const keyStats = summary.defaultKeyStatistics || {};

  const regPrice = num(price.regularMarketPrice);
  const marketCap = num(price.marketCap);
  if (regPrice === null && marketCap === null) return null;

  // Yahoo's regularMarketChangePercent is a decimal fraction (0.0123 = 1.23%).
  // Polygon's adapter normalizes to the same shape. Output as percent.
  const pctRaw = num(price.regularMarketChangePercent);
  const changePct = pctRaw === null
    ? null
    : (Math.abs(pctRaw) < 1 ? pctRaw * 100 : pctRaw);

  // Yahoo dividendYield is a decimal fraction; we want percent.
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

const YF_QUERY_BASE = "https://query1.finance.yahoo.com";

async function yahooQuote(ticker: string, yahooFetch: (url: string, retries?: number) => Promise<any>): Promise<CompanyQuote | null> {
  const url =
    `${YF_QUERY_BASE}/v10/finance/quoteSummary/${encodeURIComponent(ticker)}` +
    `?modules=price,summaryDetail,defaultKeyStatistics`;
  const json = await yahooFetch(url, 2);
  const summary = json?.quoteSummary?.result?.[0];
  return quoteFromYahooShape(summary);
}

export async function getQuoteSnapshot(
  ticker: string,
  yahooFetch: (url: string, retries?: number) => Promise<any>,
): Promise<FieldHealth<CompanyQuote>> {
  const T = ticker.toUpperCase();
  return tryProviders<CompanyQuote>(
    [
      {
        source: "polygon",
        fetch: async () => {
          const summary = await getPolygonQuoteSummary(T);
          return quoteFromYahooShape(summary);
        },
      },
      {
        source: "fmp",
        fetch: async () => {
          const rows = await fmpGet<any[]>(`/quote`, { symbol: T });
          const row = Array.isArray(rows) ? rows[0] : rows;
          return quoteFromFmp(row);
        },
      },
      {
        source: "yahoo",
        fetch: () => yahooQuote(T, yahooFetch),
      },
    ],
    {
      ttlMs: QUOTE_TTL_MS,
      isEmpty: (q) => q.price === null && q.marketCap === null,
    },
  );
}
