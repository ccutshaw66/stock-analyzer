/**
 * HTF universe — tradeable US stocks suitable for the $7K account's HTF scan.
 *
 * Filter (matches README "Universe filter" section):
 *   - Price $5 – $75
 *   - Avg daily volume ≥ 750,000 shares
 *   - Market cap ≥ $200M
 *   - Exchange in {NYSE, NASDAQ, AMEX}
 *   - Country = US
 *   - Exclude ETFs, ETNs, funds
 *   - Exclude IPOs less than 6 months old (filtered post-fetch using ipoDate
 *     from /profile when available; missing ipoDate means we keep the row —
 *     the screener already excludes pre-IPO names).
 *
 * The screener call is cached 24h via fmp.client.ts. A second pass narrows
 * the result by IPO recency only when ipoDate is present in the screener
 * response.
 */

import { fmpGet } from "../../data/providers/fmp.client";

export interface HtfUniverseRow {
  symbol: string;
  companyName: string;
  marketCap: number;
  price: number;
  beta: number | null;
  lastAnnualDividend: number | null;
  volume: number;          // avg daily volume from the screener
  exchange: string;        // "NYSE" | "NASDAQ" | "AMEX" | …
  exchangeShortName: string;
  sector: string;
  industry: string;
  country: string;
  isEtf: boolean;
  isFund: boolean;
  isActivelyTrading: boolean;
}

export interface HtfUniverseFilters {
  priceMin: number;
  priceMax: number;
  avgVolumeMin: number;
  marketCapMin: number;
  exchanges: string[];          // ["NYSE", "NASDAQ", "AMEX"]
  excludeIpoWithinDays: number; // 180 = 6 months
  country: string;              // "US"
}

export const DEFAULT_HTF_FILTERS: HtfUniverseFilters = {
  priceMin: 5,
  priceMax: 75,
  avgVolumeMin: 750_000,
  marketCapMin: 200_000_000,
  exchanges: ["NYSE", "NASDAQ", "AMEX"],
  excludeIpoWithinDays: 180,
  country: "US",
};

interface ScannerStageCounts {
  raw: number;
  afterExchange: number;
  afterIsEtfFund: number;
  afterActivelyTrading: number;
  afterIpoRecency: number;
}

export interface HtfUniverseResult {
  tickers: HtfUniverseRow[];
  counts: ScannerStageCounts;
  filters: HtfUniverseFilters;
  fetchedAt: Date;
}

/**
 * Fetch the HTF-eligible universe.
 *
 * @param filters  Override the default thresholds (defaults match README).
 * @returns  Filtered ticker list plus per-stage counts for logging.
 */
export async function getHtfUniverse(
  filters: Partial<HtfUniverseFilters> = {},
): Promise<HtfUniverseResult> {
  const f: HtfUniverseFilters = { ...DEFAULT_HTF_FILTERS, ...filters };

  // FMP /company-screener server-side filters: do as much as possible upstream.
  // Note: `limit` defaults small on FMP — request a generous cap so we get the
  // full population. 10k is well above the ~3k US active equities.
  const raw = await fmpGet<HtfUniverseRow[]>("/company-screener", {
    priceMoreThan: f.priceMin,
    priceLowerThan: f.priceMax,
    marketCapMoreThan: f.marketCapMin,
    volumeMoreThan: f.avgVolumeMin,
    country: f.country,
    isActivelyTrading: "true",
    limit: 10000,
  });
  const rows = Array.isArray(raw) ? raw : [];

  const counts: ScannerStageCounts = {
    raw: rows.length,
    afterExchange: 0,
    afterIsEtfFund: 0,
    afterActivelyTrading: 0,
    afterIpoRecency: 0,
  };

  // Stage 1: exchange (screener accepts a single exchange or comma list; we
  // re-verify client-side because FMP sometimes returns mis-tagged rows).
  const exchangeSet = new Set(f.exchanges.map(e => e.toUpperCase()));
  let filtered = rows.filter(r => {
    const ex = (r.exchangeShortName || r.exchange || "").toUpperCase();
    return exchangeSet.has(ex);
  });
  counts.afterExchange = filtered.length;

  // Stage 2: drop ETFs / funds
  filtered = filtered.filter(r => !r.isEtf && !r.isFund);
  counts.afterIsEtfFund = filtered.length;

  // Stage 3: re-confirm active trading
  filtered = filtered.filter(r => r.isActivelyTrading !== false);
  counts.afterActivelyTrading = filtered.length;

  // Stage 4: drop recent IPOs (best-effort — only when ipoDate is on the row)
  if (f.excludeIpoWithinDays > 0) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - f.excludeIpoWithinDays);
    filtered = filtered.filter(r => {
      const ipoStr = (r as any).ipoDate;
      if (!ipoStr) return true;
      const ipo = new Date(ipoStr);
      if (isNaN(ipo.getTime())) return true;
      return ipo < cutoff;
    });
  }
  counts.afterIpoRecency = filtered.length;

  return { tickers: filtered, counts, filters: f, fetchedAt: new Date() };
}

/** Compact one-line log for the orchestrator. */
export function formatUniverseCounts(r: HtfUniverseResult): string {
  const c = r.counts;
  return (
    `universe: ${c.raw} raw → ${c.afterExchange} exch → ${c.afterIsEtfFund} non-fund ` +
    `→ ${c.afterActivelyTrading} active → ${c.afterIpoRecency} post-IPO-filter`
  );
}
