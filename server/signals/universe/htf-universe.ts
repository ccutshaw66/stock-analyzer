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
  /** Min price. `null` = no lower bound (uncapped). */
  priceMin: number | null;
  /** Max price. `null` = no upper bound (uncapped) — e.g. the metals watch. */
  priceMax: number | null;
  avgVolumeMin: number;
  marketCapMin: number;
  exchanges: string[];          // ["NYSE", "NASDAQ", "AMEX"]
  excludeIpoWithinDays: number; // 180 = 6 months
  country: string;              // "US"
  /**
   * Optional FMP screener `sector` passthrough (single value, e.g.
   * "Basic Materials"). When null the screener isn't sector-constrained.
   */
  sector?: string | null;
  /**
   * Optional client-side industry narrowing: keep a row only when its
   * `industry` contains (case-insensitive) one of these substrings. Lets us
   * pin a sector down to specific industries without guessing FMP's exact
   * industry enum strings (e.g. ["gold","silver","mining","steel"]).
   */
  industryMatch?: string[] | null;
  /** Keep ETFs/funds in the result (default false — equity-only). */
  includeEtfs?: boolean;
}

export const DEFAULT_HTF_FILTERS: HtfUniverseFilters = {
  priceMin: 5,
  priceMax: 75,
  avgVolumeMin: 750_000,
  marketCapMin: 200_000_000,
  exchanges: ["NYSE", "NASDAQ", "AMEX"],
  excludeIpoWithinDays: 180,
  country: "US",
  sector: null,
  industryMatch: null,
  includeEtfs: false,
};

/**
 * Metals & mining HTF watch — the full mining complex at ANY price.
 *
 * Differs from the default $5–$75 equity scan deliberately: the price band on
 * `DEFAULT_HTF_FILTERS` is a *backtest-realism* constraint (keep validation off
 * mega-caps for a small account), NOT a tradeability rule — so this watch
 * uncaps price entirely. Liquidity/cap floors stay (untradeable thin names help
 * no one). Sector-screened to Basic Materials, then narrowed to the metals/
 * mining industries so chemicals/paper/agri/building-materials drop out.
 */
// Substrings matched against FMP's `industry` within the Basic Materials sector.
// "industrial materials" (full phrase) catches rare-earth / critical-minerals
// miners (MP, USAR, antimony, niobium) WITHOUT pulling in "construction
// materials" (cement/aggregates). "metal" catches "Other Precious Metals".
// Known gap: uranium miners are sector=Energy in FMP, so they're not covered
// here — add an Energy/uranium pass later if wanted.
export const METALS_MINING_INDUSTRY_MATCH = [
  "gold", "silver", "copper", "metal", "mining", "steel", "aluminum",
  "platinum", "palladium", "lithium", "precious", "industrial materials",
];

export const METALS_MINING_WATCH_FILTERS: Partial<HtfUniverseFilters> = {
  priceMin: null,
  priceMax: null,
  sector: "Basic Materials",
  industryMatch: METALS_MINING_INDUSTRY_MATCH,
};

interface ScannerStageCounts {
  raw: number;
  afterExchange: number;
  afterIsEtfFund: number;
  afterActivelyTrading: number;
  afterIndustry: number;
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
  // Price bounds are omitted entirely when null (uncapped) so the screener
  // doesn't silently floor/ceiling the metals watch.
  const screenerParams: Record<string, string | number | undefined> = {
    marketCapMoreThan: f.marketCapMin,
    volumeMoreThan: f.avgVolumeMin,
    country: f.country,
    isActivelyTrading: "true",
    limit: 10000,
  };
  if (f.priceMin != null) screenerParams.priceMoreThan = f.priceMin;
  if (f.priceMax != null) screenerParams.priceLowerThan = f.priceMax;
  if (f.sector) screenerParams.sector = f.sector;

  const raw = await fmpGet<HtfUniverseRow[]>("/company-screener", screenerParams);
  const rows = Array.isArray(raw) ? raw : [];

  const counts: ScannerStageCounts = {
    raw: rows.length,
    afterExchange: 0,
    afterIsEtfFund: 0,
    afterActivelyTrading: 0,
    afterIndustry: 0,
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

  // Stage 2: drop ETFs / funds (unless the caller opts to keep them)
  if (!f.includeEtfs) {
    filtered = filtered.filter(r => !r.isEtf && !r.isFund);
  }
  counts.afterIsEtfFund = filtered.length;

  // Stage 3: re-confirm active trading
  filtered = filtered.filter(r => r.isActivelyTrading !== false);
  counts.afterActivelyTrading = filtered.length;

  // Stage 3.5: narrow to specific industries within the sector (case-insensitive
  // substring match). Robust to FMP's exact industry enum strings.
  if (f.industryMatch && f.industryMatch.length > 0) {
    const needles = f.industryMatch.map(s => s.toLowerCase());
    filtered = filtered.filter(r => {
      const ind = (r.industry || "").toLowerCase();
      return needles.some(n => ind.includes(n));
    });
  }
  counts.afterIndustry = filtered.length;

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
    `→ ${c.afterActivelyTrading} active → ${c.afterIndustry} industry → ${c.afterIpoRecency} post-IPO-filter`
  );
}
