/**
 * tryProviders — walk a list of source-tagged async fetchers in order,
 * return the first successful non-empty result with a full provenance trail.
 *
 * "Empty" is caller-defined: pass an isEmpty predicate. If a provider
 * returns a value but isEmpty(value) is true, we record the attempt as
 * empty:true and continue to the next provider. This is the bug we just
 * lived through — a provider returned `null` modules and we treated that as
 * "success", showing a blank page instead of falling through to a backup.
 */

import type { ProviderAttempt, ProviderSource, FieldHealth } from "./types";

export interface ProviderTry<T> {
  source: ProviderSource;
  fetch: () => Promise<T | null>;
}

export interface TryProvidersOpts<T> {
  isEmpty?: (value: T) => boolean;
  ttlMs?: number;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes — orchestrator caches over this

export async function tryProviders<T>(
  candidates: ProviderTry<T>[],
  opts: TryProvidersOpts<T> = {},
): Promise<FieldHealth<T>> {
  const isEmpty = opts.isEmpty ?? (() => false);
  const attempts: ProviderAttempt[] = [];

  for (const candidate of candidates) {
    const t0 = Date.now();
    try {
      const value = await candidate.fetch();
      const ms = Date.now() - t0;
      if (value === null || value === undefined) {
        attempts.push({ source: candidate.source, ok: true, ms, empty: true });
        continue;
      }
      if (isEmpty(value)) {
        attempts.push({ source: candidate.source, ok: true, ms, empty: true });
        continue;
      }
      attempts.push({ source: candidate.source, ok: true, ms });
      return {
        value,
        source: candidate.source,
        attempts,
        fetchedAt: Date.now(),
        ttlMs: opts.ttlMs ?? DEFAULT_TTL_MS,
        cached: false,
      };
    } catch (e: any) {
      const ms = Date.now() - t0;
      attempts.push({
        source: candidate.source,
        ok: false,
        ms,
        error: String(e?.message || e).substring(0, 200),
      });
    }
  }

  return {
    value: null,
    source: null,
    attempts,
    fetchedAt: Date.now(),
    ttlMs: opts.ttlMs ?? DEFAULT_TTL_MS,
    cached: false,
  };
}
