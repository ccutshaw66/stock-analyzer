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
    changeQoQ: number;     // Percent change vs prior quarter (e.g. +5.2). 0 when no prior baseline.
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
    changeQoQ: number;     // Percent change vs prior quarter; computed from a second FMP fetch.
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
 * "Fund Holders" tab wants the asset-manager / fund-family / ETF-issuer
 * subset — i.e., the names you'd think of as "funds in this stock."
 *
 * Strategy: three matching layers.
 *   1) Known asset-manager prefixes/contains — covers the names that
 *      DON'T contain "FUND/TRUST/ETF" in their legal entity name
 *      (e.g. "BLACKROCK INC.", "STATE STREET CORP", "GEODE CAPITAL").
 *   2) Generic fund/etf/trust keywords.
 *   3) Asset-manager suffixes (" ASSET MANAGEMENT", " ADVISORS",
 *      " INVESTMENT MGMT", etc.).
 *
 * Anything matching ANY layer is treated as a fund. Tuned for false-
 * positives (slightly broader is OK — Top Institutions tab still shows
 * everything). Goal is that the major holders users expect to see for
 * any megacap (Vanguard, BlackRock, State Street, Geode, T. Rowe,
 * Fidelity, Wellington, Northern Trust, BNY Mellon, etc.) all surface.
 */
const KNOWN_FUND_FAMILIES = [
  // Index / ETF issuers
  "VANGUARD",
  "BLACKROCK",
  "ISHARES",
  "STATE STREET",
  "SPDR",
  "INVESCO",
  "GEODE",
  "DIMENSIONAL",
  "CHARLES SCHWAB",
  "SCHWAB ",
  "WISDOMTREE",
  "FIRST TRUST",
  "VANECK",
  "PROSHARES",
  "DIREXION",
  // Mutual fund families
  "FIDELITY",
  "T ROWE PRICE",
  "TROWE PRICE",
  "AMERICAN FUNDS",
  "CAPITAL RESEARCH",
  "CAPITAL GROUP",
  "JANUS HENDERSON",
  "FRANKLIN ",
  "FRANKLIN RESOURCES",
  "FRANKLIN TEMPLETON",
  "ALLIANCEBERNSTEIN",
  "ALLIANZ ",
  "NUVEEN",
  "EATON VANCE",
  "DODGE & COX",
  "DODGE AND COX",
  "PRIMECAP",
  "MFS ",
  "MFS INVESTMENT",
  "HARRIS ASSOCIATES",
  "OAKMARK",
  "VICTORY CAPITAL",
  "TIAA",
  "VOYA",
  "JOHN HANCOCK",
  "PACER ",
  "PACIFIC INVESTMENT",
  "PIMCO",
  "DWS ",
  "COLUMBIA THREADNEEDLE",
  "NORTHERN TRUST",
  "BANK OF NEW YORK MELLON",
  "BNY MELLON",
  "WELLINGTON MANAGEMENT",
  "WELLINGTON ",
  "PARAMETRIC PORTFOLIO",
  "LEGG MASON",
  "ARK INVEST",
  // Big-bank asset-management arms
  "GOLDMAN SACHS ASSET",
  "MORGAN STANLEY INVESTMENT",
  "MORGAN STANLEY ASSET",
  "JPMORGAN ASSET",
  "JP MORGAN ASSET",
  "JPMORGAN INVESTMENT",
  "WELLS FARGO ADVISORS",
  "BANK OF AMERICA SECURITIES",
  "UBS ASSET",
  "BNP PARIBAS ASSET",
  "AMUNDI",
  // Major pension funds (these are large 13F filers)
  "CALIFORNIA PUBLIC EMPLOYEES",
  "CALPERS",
  "TEACHER RETIREMENT",
  "NEW YORK STATE COMMON",
  "FLORIDA RETIREMENT",
  "STATE BOARD OF ADMIN",
];

const FUND_SUFFIX_PATTERNS = [
  " ASSET MANAGEMENT",
  " ASSET MGMT",
  " INVESTMENT MANAGEMENT",
  " INVESTMENT MGMT",
  " INVESTMENT ADVISORS",
  " INVESTMENT ADVISERS",
  " CAPITAL MANAGEMENT",
  " CAPITAL MGMT",
  " WEALTH MANAGEMENT",
  " WEALTH MGMT",
  " FUND MANAGEMENT",
  " FUND ADVISORS",
];

function looksLikeFund(name: string): boolean {
  const n = (name || "").toUpperCase().trim();
  if (!n) return false;
  // Layer 1: known asset-manager prefixes / contains.
  for (const fam of KNOWN_FUND_FAMILIES) {
    if (n.startsWith(fam) || n.includes(fam)) return true;
  }
  // Layer 2: generic fund / etf / trust keywords.
  if (
    n.includes(" FUND") ||
    n.endsWith(" FUND") ||
    n.includes(" ETF") ||
    n.includes(" INDEX FUND") ||
    n.includes(" INDEX TRUST") ||
    n.includes(" PENSION FUND") ||
    n.includes(" RETIREMENT FUND") ||
    n.includes(" TRUST CO") ||
    n.includes(" TRUST COMPANY") ||
    n.includes(" MUTUAL FUND")
  ) return true;
  // Layer 3: asset-manager suffixes.
  for (const suffix of FUND_SUFFIX_PATTERNS) {
    if (n.includes(suffix)) return true;
  }
  return false;
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

function previousQuarter(q: { year: number; quarter: number }): { year: number; quarter: number } {
  let { year, quarter } = q;
  quarter -= 1;
  if (quarter < 1) { quarter = 4; year -= 1; }
  return { year, quarter };
}

/** Match the org-name normalizer used by other QoQ-merging code paths. */
function normalizeOrgName(s: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/[.,&'/]/g, " ")
    .replace(/\b(inc|incorporated|corp|corporation|ltd|limited|llc|lp|llp|plc|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
  const cacheKey = `fmp-inst:v8:${T}`; // v8 — sharesOutstanding derived from marketCap/price
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
          // Was 25 — too narrow. With limit=100 we get the top 100 holders by
          // shares, then the Fund Holders filter catches all the major asset
          // managers (Vanguard, BlackRock, State Street, Geode, Wellington,
          // T. Rowe, Fidelity, etc.) instead of just the few that fit in 25.
          limit: 100,
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

    // Prior-quarter holders for QoQ computation.
    //
    // Two indexes:
    //   - priorByCik: primary match. CIK uniquely identifies the filer entity,
    //     so this disambiguates "UBS GROUP AG" rows that come from multiple
    //     UBS subsidiaries (UBS AG vs UBS Asset Mgmt vs UBS Securities) — each
    //     has its own CIK and gets compared against its own prior baseline.
    //   - priorByName: fallback for rows missing CIK. Sums multiple filings
    //     under the same normalized name; less precise but covers the gap.
    //
    // Limit bumped to 1000 (vs current quarter's 100) so a current top-100
    // holder who ranked #101+ last quarter still has a baseline to compare
    // against. Long-tail mid-cap filers shuffle in and out of the top 100
    // each quarter — without the deeper baseline they'd all show 0.0%.
    // Cost: one larger FMP response, still 24h-cached.
    const priorByCik = new Map<string, number>();
    const priorByName = new Map<string, number>();
    if (usedQuarter) {
      const prevQ = previousQuarter(usedQuarter);
      const priorRows = await fmpGet<any[]>("/institutional-ownership/extract-analytics/holder", {
        symbol: T,
        year: prevQ.year,
        quarter: prevQ.quarter,
        page: 0,
        limit: 1000,
      }).catch((e: any) => {
        log.debug({ ticker: T, prevQ, err: String(e?.message || e) }, "prior-quarter holders fetch failed");
        return null;
      });
      if (Array.isArray(priorRows)) {
        for (const ph of priorRows) {
          const prevShares = Number(ph.sharesNumber || ph.shares || ph.position || 0);
          if (!prevShares) continue;
          const cik = ph.cik ? String(ph.cik) : "";
          if (cik) {
            priorByCik.set(cik, (priorByCik.get(cik) ?? 0) + prevShares);
          }
          const k = normalizeOrgName(String(ph.investorName || ph.holder || ph.name || ""));
          if (k) priorByName.set(k, (priorByName.get(k) ?? 0) + prevShares);
        }
      }
    }

    const qoqPct = (name: string, cik: string | null, currentShares: number): number => {
      if (!Number.isFinite(currentShares) || currentShares <= 0) return 0;
      // CIK-first: precise per-filer baseline. Falls back to name only when
      // either side lacks a CIK.
      let prev = 0;
      if (cik && priorByCik.has(cik)) {
        prev = priorByCik.get(cik) ?? 0;
      } else {
        prev = priorByName.get(normalizeOrgName(name)) ?? 0;
      }
      if (prev <= 0) return 0; // unknown prior baseline — report 0 rather than +∞
      return ((currentShares - prev) / prev) * 100;
    };

    // Top holders mapped to the EDGAR-compatible shape.
    let topHolders: FmpInstitutionalSummary["topHolders"] = [];
    if (Array.isArray(holders)) {
      topHolders = holders.map((h: any) => {
        const name = String(h.investorName || h.holder || h.name || "Unknown");
        const shares = Number(h.sharesNumber || h.shares || h.position || 0);
        const cik = h.cik ? String(h.cik) : null;
        return {
          name,
          shares,
          value: Number(h.marketValue || h.value || 0),
          // FMP returns weight as a percentage (e.g. 9.65). EDGAR shape uses a
          // fraction (0.0965). Convert.
          pctHeld: Number(h.weight || h.weightPercent || h.ownership || 0) / 100,
          changeQoQ: qoqPct(name, cik, shares),
          reportDate: (h.date || h.dateReported || null) as string | null,
          accession: null,
          cik,
        };
      });
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

    // Institutional ownership %: compute as numberOf13Fshares / sharesOutstanding * 100.
    //
    // FMP `/profile` does NOT return sharesOutstanding as a top-level field
    // (verified via diag for MSFT). Derive it from marketCap / price, which
    // both /profile and /quote return reliably. This is the standard
    // textbook definition of institutional ownership %.
    const profile = await fmpGet<any[]>("/profile", { symbol: T }).catch(() => null);
    const profileRow = Array.isArray(profile) && profile.length ? profile[0] : null;
    const profileMarketCap = Number(profileRow?.marketCap ?? 0);
    const profilePrice = Number(profileRow?.price ?? 0);
    const sharesOutstanding =
      profileMarketCap > 0 && profilePrice > 0
        ? profileMarketCap / profilePrice
        : Number(latest?.sharesOutstanding ?? 0) || null;
    const numberOf13Fshares = Number(latest?.numberOf13Fshares ?? 0);
    let ownershipPct = 0;
    if (numberOf13Fshares > 0 && sharesOutstanding && sharesOutstanding > 0) {
      ownershipPct = (numberOf13Fshares / sharesOutstanding) * 100;
    } else {
      ownershipPct = Number(latest?.ownershipPercent ?? latest?.ownership ?? 0);
    }

    // Build the fund-only subset for the Fund Holders tab. Same source as
    // topHolders, just filtered. With limit=100 upstream we have plenty of
    // candidates to choose from; cap at 25 funds so the table doesn't bloat.
    const topFunds = topHolders
      .filter((h) => looksLikeFund(h.name))
      .slice(0, 25)
      .map((h) => ({
        name: h.name,
        shares: h.shares,
        value: h.value,
        pctHeld: h.pctHeld,
        changeQoQ: h.changeQoQ,
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
