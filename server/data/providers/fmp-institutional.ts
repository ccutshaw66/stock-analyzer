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
  institutionPct: number;       // percentage 0..100 (matches EDGAR shape)
  institutionCount: number;
  sharesOutstanding: number | null;
  asOf: string | null;
  source: "fmp-ultimate";
}

const TTL_MS = 24 * 60 * 60 * 1000; // 24h — 13Fs are quarterly anyway
const TTL_MS_EMPTY = 5 * 60 * 1000; // 5m on empty/error so we retry soon

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
    // Fetch both in parallel — they're independent calls.
    const [summary, holders] = await Promise.all([
      fmpGet<any[] | any>("/institutional-ownership/symbol-ownership", {
        symbol: T,
        includeCurrentQuarter: "true",
      }).catch((e: any) => {
        log.debug({ ticker: T, err: String(e?.message || e) }, "summary fetch failed");
        return null;
      }),
      fmpGet<any[]>("/institutional-holder", { symbol: T }).catch((e: any) => {
        log.debug({ ticker: T, err: String(e?.message || e) }, "holders fetch failed");
        return null;
      }),
    ]);

    // Latest-quarter summary row. Endpoint returns an array, newest first.
    const latest = Array.isArray(summary) && summary.length ? summary[0] : null;

    // Top holders — sort by shares desc and slice top 25 to mirror EDGAR's cap.
    let topHolders: FmpInstitutionalSummary["topHolders"] = [];
    if (Array.isArray(holders)) {
      topHolders = holders
        .map((h: any) => ({
          name: String(h.holder || h.name || "Unknown"),
          shares: Number(h.shares || h.position || 0),
          // FMP's institutional-holder endpoint sometimes lacks `value` —
          // compute from shares × current price if missing? Skip: leave 0.
          value: Number(h.value || 0),
          pctHeld: Number(h.weightPercent || h.pctHeld || 0) / 100, // FMP returns percent, EDGAR shape is fraction
          reportDate: (h.dateReported || h.date || null) as string | null,
          accession: null, // FMP doesn't expose the accession number on this endpoint
          cik: null,       // CIK is on the symbol-ownership endpoint, not per-holder
        }))
        .sort((a, b) => b.shares - a.shares)
        .slice(0, 25);
    }

    // If neither call returned anything useful, treat as a miss and cache
    // briefly so we retry. Don't poison the 24h cache.
    if (!latest && topHolders.length === 0) {
      setCache(cacheKey, null, TTL_MS_EMPTY);
      return null;
    }

    const institutionCount = Number(
      latest?.investorsHolding ?? latest?.institutionsHolding ?? 0,
    );
    const sharesOutstanding =
      Number(latest?.sharesOutstanding ?? latest?.numberOf13FsharesOutstanding ?? 0) || null;
    const totalInst13fShares = Number(latest?.numberOf13Fshares ?? 0);
    // institutionPct = total 13F shares / total shares outstanding × 100.
    // Falls back to summing the topHolders shares if the summary endpoint
    // is missing the rollup.
    const institutionPct =
      sharesOutstanding && totalInst13fShares
        ? (totalInst13fShares / sharesOutstanding) * 100
        : 0;

    const result: FmpInstitutionalSummary = {
      topHolders,
      institutionPct,
      institutionCount,
      sharesOutstanding,
      asOf: latest?.date || (topHolders[0]?.reportDate ?? null),
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
