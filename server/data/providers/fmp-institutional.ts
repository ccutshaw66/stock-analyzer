/**
 * FMP Ultimate-tier institutional ownership fetcher.
 *
 * Returns institutional 13F data from FMP's stable API instead of SEC EDGAR.
 * Used as the primary institutional source when FMP_TIER=ultimate is set in
 * the environment (i.e. when the user has upgraded their FMP plan from
 * Premium to Ultimate). EDGAR + Yahoo become disabled-but-present fallbacks
 * — kept in code for emergency manual override but not invoked.
 *
 * The point of this module is to remove the dependency on SEC's IP-blocked
 * EDGAR endpoint and Yahoo's rate-limited unofficial scrape. FMP Ultimate
 * delivers the same underlying SEC 13F data through a paid, contracted API,
 * so we get the headline "institutional flow" feature working reliably.
 *
 * Activation: set FMP_TIER=ultimate in .env, restart the server. Falls back
 * to EDGAR/Yahoo automatically if FMP returns 402 (e.g. plan downgrade) or
 * any other error — the consumer in routes.ts treats null as "try the next
 * provider in the chain."
 *
 * Cache: returned shape is in-memory cached for 24h via the shared `cache.ts`
 * keyed as `fmp-inst:{TICKER}`. 13F filings update quarterly so 24h is the
 * right TTL — same cadence as the EDGAR cache and the Yahoo ownership cache.
 */
import { fmpGet, FmpApiError } from "./fmp.client";
import { getCached, setCache } from "../../cache";
import { recordCacheHit } from "../../request-queue";
import { logger as rootLogger } from "../../lib/logger";

const log = rootLogger.child({ module: "fmp-institutional" });

/**
 * Standardised institutional summary shape, intentionally matching the shape
 * returned by `getInstitutionalSummary` (the EDGAR-backed function in
 * institutional-cache.ts) so callers can treat the two interchangeably.
 */
export interface FmpInstitutionalSummary {
  topHolders: Array<{
    name: string;
    shares: number;
    value: number;
    pctHeld: number;       // 0..1 fraction (matches EDGAR shape)
    reportDate: string | null;
    accession: string | null;
    cik: string | null;
  }>;
  // Same row shape as topHolders, but filtered to mutual fund / ETF / index
  // fund / SMA filers — populates the "Fund Holders" tab on the institutional
  // page now that the Yahoo-sourced fundOwnership is dead.
  topFunds: Array<{
    name: string;
    shares: number;
    value: number;
    pctHeld: number;
    changeQoQ: number;     // 0 — FMP holders endpoint doesn't expose pctChange
    reportDate: string | null;
  }>;
  institutionPct: number;       // percentage 0..100 (matches EDGAR shape)
  institutionCount: number;
  sharesOutstanding: number | null;
  asOf: string | null;
  source: "fmp-ultimate";
}

/**
 * Heuristic fund-name detector. 13F filers are a mix of banks, asset
 * managers, pension funds, mutual funds, ETFs, hedge funds, etc. The
 * "Fund Holders" tab specifically wants mutual-fund / ETF / index-fund
 * filers. Match on common naming conventions — not perfect but covers
 * the vast majority of the names users care about (Vanguard funds,
 * iShares ETFs, Fidelity funds, SPDR ETFs, etc.).
 */
function looksLikeFund(name: string): boolean {
  const n = (name || "").toUpperCase();
  return (
    n.includes(" FUND") ||
    n.endsWith(" FUND") ||
    n.includes(" ETF") ||
    n.includes(" INDEX FUND") ||
    n.includes(" INDEX TRUST") ||
    n.startsWith("VANGUARD ") ||
    n.startsWith("ISHARES ") ||
    n.startsWith("SPDR ") ||
    n.startsWith("INVESCO ") ||
    n.includes("FIDELITY ") ||
    n.includes("SCHWAB ") ||
    n.includes("AMERICAN FUNDS") ||
    n.includes("T ROWE PRICE") ||
    n.includes("TROWE PRICE") ||
    n.includes("DIMENSIONAL FUND") ||
    n.includes("VOYA ") ||
    n.includes(" TRUST")
  );
}

const TTL_MS = 24 * 60 * 60 * 1000; // 24h — 13Fs are quarterly anyway
const TTL_MS_EMPTY = 5 * 60 * 1000; // 5m on empty/error so we retry soon

/**
 * Returns the most recent 13F quarters that should have publicly-filed data,
 * newest first. 13Fs are due 45 days after the quarter ends, but we add a
 * 60-day buffer to be safe — smaller filers tend to file near the deadline,
 * so the data isn't fully aggregated until ~60 days after quarter-end.
 *
 * Example (today = May 5, 2026):
 *   - Q1 2026 ended Mar 31, deadline May 15 → not yet aggregated
 *   - Q4 2025 ended Dec 31, deadline Feb 14 → fully filed, returned
 *   - Q3 2025 ended Sep 30 → also returned as fallback
 */
function latestAvailableQuarters(count: number): Array<{ year: number; quarter: number }> {
  const result: Array<{ year: number; quarter: number }> = [];
  const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000); // 60 days ago
  let year = cutoff.getUTCFullYear();
  let quarter = Math.floor(cutoff.getUTCMonth() / 3) + 1;
  for (let i = 0; i < count; i++) {
    result.push({ year, quarter });
    quarter -= 1;
    if (quarter < 1) {
      quarter = 4;
      year -= 1;
    }
  }
  return result;
}

function quarterEndDate(year: number, quarter: number): string {
  const month = quarter * 3; // Q1=3, Q2=6, Q3=9, Q4=12
  const day = month === 6 || month === 9 ? 30 : 31; // Jun=30, Sep=30, Mar/Dec=31
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Returns true when FMP Ultimate-tier institutional endpoints should be
 * used as the primary source. Reads `FMP_TIER` env var. Default off.
 */
export function isFmpUltimateEnabled(): boolean {
  return (process.env.FMP_TIER || "").toLowerCase() === "ultimate";
}

/**
 * Fetch the institutional ownership summary + top holders for a ticker
 * from FMP Ultimate. Returns null on any error (HTTP 402 plan-restricted,
 * 5xx, network) so the caller can fall back to EDGAR or Yahoo cleanly.
 *
 * Uses two FMP stable endpoints:
 *   1. /institutional-ownership/symbol-ownership — summary stats
 *      (institutionsHolding count, totalInvested, sharesOutstanding, etc.)
 *   2. /institutional-holder — list of top holders with shares + value
 *
 * Both calls go through the FMP client's built-in retry + cache, so this
 * module only adds one more cache layer for the merged result.
 */
export async function getFmpInstitutional(
  ticker: string,
): Promise<FmpInstitutionalSummary | null> {
  const T = ticker.toUpperCase();
  const cacheKey = `fmp-inst:${T}`;
  const cached = getCached(cacheKey);
  if (cached !== undefined && cached !== null) {
    recordCacheHit();
    return cached as FmpInstitutionalSummary | null;
  }

  // Short-circuit if the flag isn't on. Returning null lets the caller
  // skip without paying the import cost or the cache write.
  if (!isFmpUltimateEnabled()) return null;

  try {
    // FMP Form 13F endpoints require year + quarter params. Latest available
    // quarter is the most recent one whose 45-day filing window has passed.
    // We try the latest 2 quarters in case some symbols haven't been filed
    // yet for the most recent (smaller filers file closer to deadline).
    const quarters = latestAvailableQuarters(2);

    let latest: any = null;
    let holders: any[] | null = null;
    let usedQuarter: { year: number; quarter: number } | null = null;

    for (const q of quarters) {
      const [summaryArr, holdersArr] = await Promise.all([
        fmpGet<any[]>("/institutional-ownership/symbol-positions-summary", {
          symbol: T,
          year: q.year,
          quarter: q.quarter,
        }).catch((e: any) => {
          log.debug({ ticker: T, q, err: String(e?.message || e) }, "summary fetch failed");
          return null;
        }),
        fmpGet<any[]>("/institutional-ownership/extract-analytics/holder", {
          symbol: T,
          year: q.year,
          quarter: q.quarter,
          page: 0,
          limit: 25,
        }).catch((e: any) => {
          log.debug({ ticker: T, q, err: String(e?.message || e) }, "holders fetch failed");
          return null;
        }),
      ]);

      const summaryRow = Array.isArray(summaryArr) && summaryArr.length ? summaryArr[0] : null;
      const holdersList = Array.isArray(holdersArr) ? holdersArr : null;

      if (summaryRow || (holdersList && holdersList.length > 0)) {
        latest = summaryRow;
        holders = holdersList;
        usedQuarter = q;
        break;
      }
    }

    // Top holders mapped to the EDGAR-compatible shape.
    let topHolders: FmpInstitutionalSummary["topHolders"] = [];
    if (Array.isArray(holders)) {
      topHolders = holders.map((h: any) => ({
        name: String(h.investorName || h.holder || h.name || "Unknown"),
        shares: Number(h.sharesNumber || h.shares || h.position || 0),
        value: Number(h.marketValue || h.value || 0),
        // FMP returns weight as a percentage (e.g. 9.65). EDGAR shape uses a
        // fraction (0.0965). Convert.
        pctHeld: Number(h.weight || h.weightPercent || h.ownership || 0) / 100,
        reportDate: (h.date || h.dateReported || null) as string | null,
        accession: null,
        cik: h.cik ? String(h.cik) : null,
      }));
      // Sort by shares descending to mirror EDGAR's ordering.
      topHolders.sort((a, b) => b.shares - a.shares);
    }

    // If neither call returned anything useful for any quarter we tried,
    // cache briefly and return null so the caller falls through to EDGAR.
    if (!latest && topHolders.length === 0) {
      setCache(cacheKey, null, TTL_MS_EMPTY);
      return null;
    }

    const institutionCount = Number(
      latest?.investorsHolding ?? latest?.investorsHoldingNumber ?? 0,
    );
    const ownershipPct = Number(
      latest?.ownershipPercent ?? latest?.ownership ?? 0,
    );
    const sharesOutstanding =
      Number(latest?.sharesOutstanding ?? latest?.numberOf13FsharesOutstanding ?? 0) || null;

    // Build the fund-only subset for the Fund Holders tab. Same source as
    // topHolders, just filtered. Limit to top 15 to mirror what Yahoo's
    // fundOwnership previously returned.
    const topFunds = topHolders
      .filter((h) => looksLikeFund(h.name))
      .slice(0, 15)
      .map((h) => ({
        name: h.name,
        shares: h.shares,
        value: h.value,
        pctHeld: h.pctHeld,
        changeQoQ: 0,
        reportDate: h.reportDate,
      }));

    const result: FmpInstitutionalSummary = {
      topHolders,
      topFunds,
      institutionPct: ownershipPct,
      institutionCount,
      sharesOutstanding,
      asOf:
        usedQuarter
          ? quarterEndDate(usedQuarter.year, usedQuarter.quarter)
          : latest?.date || topHolders[0]?.reportDate || null,
      source: "fmp-ultimate",
    };

    setCache(cacheKey, result, TTL_MS);
    return result;
  } catch (e: any) {
    // 402 = "Restricted Endpoint" — the user is on Premium, not Ultimate.
    // Log loudly so they know to upgrade or unset FMP_TIER.
    if (e instanceof FmpApiError && e.status === 402) {
      log.warn(
        { ticker: T },
        "FMP returned 402 — institutional endpoints require Ultimate tier. " +
          "Either upgrade the FMP plan or unset FMP_TIER env var.",
      );
    } else {
      log.warn({ ticker: T, err: String(e?.message || e) }, "fmp institutional fetch failed");
    }
    setCache(cacheKey, null, TTL_MS_EMPTY);
    return null;
  }
}
