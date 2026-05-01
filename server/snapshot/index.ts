/**
 * getCompanySnapshot — single source of truth for everything a page needs
 * about a ticker.
 *
 * Calls every adapter in parallel via Promise.allSettled so one slow or
 * failing provider never holds up the rest. Wraps each result in
 * FieldHealth<T> so the diagnostic route can show exactly which source
 * answered, how long it took, and which fallbacks were attempted.
 *
 * The snapshot itself is cached for SNAPSHOT_TTL_MS so back-to-back page
 * loads don't re-fetch eight providers. Individual fields inside the
 * snapshot have their own TTLs (set by each adapter); on a cache hit we
 * still return the cached snapshot — the orchestrator-level cache is the
 * fast path for repeat requests.
 *
 * Dependencies that live in routes.ts (yahooFetch, getYahooOwnership) are
 * injected to avoid a circular import.
 */

import type { CompanySnapshot, FieldHealth } from "./types";
import { SNAPSHOT_SCHEMA_VERSION } from "./types";
import { getQuoteSnapshot } from "./quote";
import { getChartSnapshot, computeReturns } from "./chart";
import { getOwnershipSnapshot, type GetYahooOwnership } from "./institutional";
import { getInsiderActivitySnapshot } from "./insiders";
import { getAnalystSnapshot } from "./analyst";
import { getEarningsSnapshot } from "./earnings";
import { getFundamentalsSnapshot } from "./fundamentals";
import { getProfileSnapshot } from "./profile";

const SNAPSHOT_TTL_MS = 5 * 60 * 1000; // 5 min — same as quote TTL

// In-process cache. Restart-safe disk caching is per-adapter (EDGAR has its
// own, Polygon/FMP/Yahoo cache via the route-level setCache calls).
const snapshotCache = new Map<string, { value: CompanySnapshot; expiresAt: number }>();

export interface GetCompanySnapshotOpts {
  yahooFetch: (url: string, retries?: number) => Promise<any>;
  getYahooOwnership: GetYahooOwnership;
  forceRefresh?: boolean;
}

export async function getCompanySnapshot(
  ticker: string,
  opts: GetCompanySnapshotOpts,
): Promise<CompanySnapshot> {
  const T = ticker.toUpperCase();
  const cacheKey = T;

  if (!opts.forceRefresh) {
    const cached = snapshotCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return markCached(cached.value);
    }
  }

  const [
    quote,
    fundamentals,
    profile,
    chart5y,
    ownership,
    insiderActivity,
    analyst,
    earnings,
  ] = await Promise.all([
    getQuoteSnapshot(T, opts.yahooFetch),
    getFundamentalsSnapshot(T),
    getProfileSnapshot(T),
    getChartSnapshot(T, "5y", "1wk", opts.yahooFetch),
    getOwnershipSnapshot(T, opts.getYahooOwnership),
    getInsiderActivitySnapshot(T),
    getAnalystSnapshot(T),
    getEarningsSnapshot(T),
  ]);

  const returnsValue = computeReturns(chart5y.value);
  const returns: FieldHealth<typeof returnsValue> = {
    value: returnsValue,
    source: chart5y.source,
    attempts: chart5y.attempts,
    fetchedAt: chart5y.fetchedAt,
    ttlMs: chart5y.ttlMs,
    cached: chart5y.cached,
  };

  const snapshot: CompanySnapshot = {
    ticker: T,
    asOf: Date.now(),
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    quote,
    fundamentals,
    profile,
    returns,
    ownership,
    insiderActivity,
    analyst,
    earnings,
  };

  snapshotCache.set(cacheKey, {
    value: snapshot,
    expiresAt: Date.now() + SNAPSHOT_TTL_MS,
  });

  return snapshot;
}

function markCached(snap: CompanySnapshot): CompanySnapshot {
  return {
    ...snap,
    quote: { ...snap.quote, cached: true },
    fundamentals: { ...snap.fundamentals, cached: true },
    profile: { ...snap.profile, cached: true },
    returns: { ...snap.returns, cached: true },
    ownership: { ...snap.ownership, cached: true },
    insiderActivity: { ...snap.insiderActivity, cached: true },
    analyst: { ...snap.analyst, cached: true },
    earnings: { ...snap.earnings, cached: true },
  };
}

/**
 * Compact health summary — drops the heavy `value` payloads and keeps just
 * the per-field provenance. Used by the /api/diag/snapshot route.
 */
export function snapshotHealth(snap: CompanySnapshot) {
  const fields = ["quote", "fundamentals", "profile", "returns", "ownership", "insiderActivity", "analyst", "earnings"] as const;
  const out: Record<string, { source: string | null; attempts: any[]; fetchedAt: number; ttlMs: number; cached: boolean; populated: boolean }> = {};
  for (const k of fields) {
    const f = (snap as any)[k] as FieldHealth<unknown>;
    out[k] = {
      source: f.source,
      attempts: f.attempts,
      fetchedAt: f.fetchedAt,
      ttlMs: f.ttlMs,
      cached: f.cached,
      populated: f.value !== null,
    };
  }
  return {
    ticker: snap.ticker,
    asOf: snap.asOf,
    schemaVersion: snap.schemaVersion,
    fields: out,
  };
}

export type { CompanySnapshot } from "./types";
