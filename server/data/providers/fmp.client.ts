/**
 * FMP HTTP client — shared fetch layer for the FMP adapter.
 *
 * Uses FMP's STABLE API (post-August 31, 2025 migration). Legacy /v3 and /v4
 * endpoints are no longer available on new keys.
 *
 * Features:
 *   - API key injection (from FMP_API_KEY env var)
 *   - Automatic retry with exponential backoff on 429 / 5xx
 *   - In-memory TTL cache keyed by full URL (ignores the apikey param)
 *   - Structured logging tagged with endpoint + ticker
 *   - Never throws on missing API key at import time — throws only when a
 *     method is actually called, so the app still boots without FMP configured
 *
 * LEGAL NOTE: FMP individual plans prohibit redistribution. Upgrade to
 * Build/Enterprise tier before Stock Otter has paying users (tracked as
 * Phase 6 pre-GA hardening).
 */
import { logger as rootLogger } from "../../lib/logger";

const log = rootLogger.child({ module: "fmp" });

// NOTE: stable API base. Override with FMP_BASE_URL if needed.
const BASE_URL = process.env.FMP_BASE_URL || "https://financialmodelingprep.com/stable";
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 3;

export class FmpConfigError extends Error {}
export class FmpApiError extends Error {
  status: number;
  constructor(status: number, msg: string) {
    super(msg);
    this.status = status;
  }
}

function apiKey(): string {
  const k = process.env.FMP_API_KEY;
  if (!k) {
    throw new FmpConfigError(
      "FMP_API_KEY is not set. Add it to .env to enable the FMP data adapter.",
    );
  }
  return k;
}

// ─── Cache ──────────────────────────────────────────────────────────────────
// Keyed by "path?query" (without apikey). TTL per endpoint.
interface CacheEntry {
  expiresAt: number;
  payload: any;
}
const cache = new Map<string, CacheEntry>();

/** Default TTLs by endpoint prefix. Paths are stable-API-style (no /v3 or /v4). */
const TTL_BY_PREFIX: Array<{ prefix: string; ttlMs: number }> = [
  // Slow-moving: 13F filings, annual financials
  { prefix: "/institutional-ownership/", ttlMs: 24 * 60 * 60 * 1000 }, // 24h
  { prefix: "/ratios-ttm", ttlMs: 6 * 60 * 60 * 1000 },                 // 6h
  { prefix: "/income-statement", ttlMs: 6 * 60 * 60 * 1000 },           // 6h
  { prefix: "/balance-sheet-statement", ttlMs: 6 * 60 * 60 * 1000 },    // 6h
  { prefix: "/cash-flow-statement", ttlMs: 6 * 60 * 60 * 1000 },        // 6h
  // Medium: analyst + earnings — intraday refresh
  { prefix: "/price-target-consensus", ttlMs: 60 * 60 * 1000 }, // 1h
  { prefix: "/grades-consensus", ttlMs: 60 * 60 * 1000 },       // 1h
  { prefix: "/ratings-snapshot", ttlMs: 60 * 60 * 1000 },       // 1h
  { prefix: "/ratings-historical", ttlMs: 60 * 60 * 1000 },     // 1h
  { prefix: "/earnings", ttlMs: 60 * 60 * 1000 },               // 1h
  { prefix: "/insider-trading", ttlMs: 30 * 60 * 1000 },        // 30m
  // Default: 5m
];
const DEFAULT_TTL_MS = 5 * 60 * 1000;

function ttlFor(path: string): number {
  for (const { prefix, ttlMs } of TTL_BY_PREFIX) {
    if (path.startsWith(prefix)) return ttlMs;
  }
  return DEFAULT_TTL_MS;
}

// ─── Retry helpers ──────────────────────────────────────────────────────────
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryable(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

// ─── Core fetch ─────────────────────────────────────────────────────────────
/**
 * GET a path on FMP. Path should start with a slash and use stable endpoints,
 * e.g. "/price-target-consensus" or "/insider-trading/search".
 *
 * Query params should be passed as an object; apikey is added automatically.
 *
 * Returns parsed JSON. Throws FmpApiError with status and body on HTTP errors.
 */
export async function fmpGet<T = any>(
  path: string,
  query: Record<string, string | number | undefined> = {},
): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    qs.set(k, String(v));
  }
  const cacheKey = `${path}?${qs.toString()}`;

  // Cache hit?
  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) {
    log.debug({ path, cache_hit: true }, "fmp cache hit");
    return hit.payload as T;
  }

  qs.set("apikey", apiKey());
  const url = `${BASE_URL}${path}?${qs.toString()}`;

  let lastErr: any = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const started = Date.now();
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch(url, { signal: ctrl.signal });
      } finally {
        clearTimeout(timer);
      }
      const duration_ms = Date.now() - started;
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        if (isRetryable(res.status) && attempt < MAX_RETRIES) {
          const backoff = Math.min(30_000, 500 * Math.pow(2, attempt));
          log.warn(
            { path, status: res.status, attempt, backoff, duration_ms },
            "fmp retryable error — backing off",
          );
          await sleep(backoff);
          continue;
        }
        throw new FmpApiError(res.status, `FMP ${res.status} on ${path}: ${body.slice(0, 300)}`);
      }
      const json = (await res.json()) as T;
      const ttl = ttlFor(path);
      cache.set(cacheKey, { expiresAt: Date.now() + ttl, payload: json });
      log.debug({ path, duration_ms, ttl_ms: ttl }, "fmp fetched");
      return json;
    } catch (e: any) {
      lastErr = e;
      if (e?.name === "AbortError" && attempt < MAX_RETRIES) {
        const backoff = Math.min(30_000, 500 * Math.pow(2, attempt));
        log.warn({ path, attempt, backoff }, "fmp timeout — retrying");
        await sleep(backoff);
        continue;
      }
      if (e instanceof FmpApiError) throw e;
      if (attempt < MAX_RETRIES) {
        const backoff = Math.min(30_000, 500 * Math.pow(2, attempt));
        log.warn({ path, attempt, backoff, err: String(e?.message || e) }, "fmp transient error — retrying");
        await sleep(backoff);
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

/** Clear the entire in-memory cache. Used by tests; also exposed for admin. */
export function clearFmpCache(): void {
  cache.clear();
}

/** Cache stats for admin observability. */
export function fmpCacheStats(): { size: number } {
  return { size: cache.size };
}
