/**
 * Vendor-agnostic cache facade.
 *
 * TTLs defined per capability, not per vendor. When we swap Polygon -> FMP for
 * a capability, the cache behavior doesn't change.
 *
 * Back with Redis in prod; Map() is fine in dev.
 */
import type { Capability } from "./types";

const TTL_MS: Record<Capability, number> = {
  quotes:                  15 * 60 * 1000,        // 15 min
  aggregates:              30 * 60 * 1000,        // 30 min
  options:                 15 * 60 * 1000,        // 15 min
  financials:              12 * 60 * 60 * 1000,   // 12 hr
  analyst_ratings:          6 * 60 * 60 * 1000,   // 6 hr
  earnings:                12 * 60 * 60 * 1000,   // 12 hr
  insider_transactions:    24 * 60 * 60 * 1000,   // 24 hr
  institutional_holdings:  24 * 60 * 60 * 1000,   // 24 hr (updates quarterly anyway)
  beta:                    24 * 60 * 60 * 1000,   // 24 hr
  search:                   1 * 60 * 60 * 1000,   // 1 hr
  dividends:                2 * 60 * 60 * 1000,   // 2 hr
  splits:                  12 * 60 * 60 * 1000,   // 12 hr
};

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

// TODO: replace with Redis-backed impl in platform/config.ts
const store = new Map<string, CacheEntry<unknown>>();

export function cacheKey(cap: Capability, ...parts: Array<string | number>): string {
  return [cap, ...parts].join(":");
}

export function getCached<T>(key: string): T | undefined {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) {
    store.delete(key);
    return undefined;
  }
  return entry.value as T;
}

export function setCached<T>(key: string, value: T, cap: Capability): void {
  store.set(key, { value, expiresAt: Date.now() + TTL_MS[cap] });
}

export function invalidate(prefix: string): void {
  const keys = Array.from(store.keys());
  for (const k of keys) {
    if (k.startsWith(prefix)) store.delete(k);
  }
}
