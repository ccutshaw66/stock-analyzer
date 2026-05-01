/**
 * SEC EDGAR HTTP client.
 *
 * Public data, no API key. SEC's stated rate limit is 10 req/sec per IP,
 * but their CDN (Akamai) auto-blocks IPs that sustain anywhere near that
 * — once blocked, the IP can be locked out for 24-72h regardless of
 * subsequent behavior. We deliberately throttle to 4 req/sec with jitter
 * to stay well clear of the trip wire.
 *
 * SEC requires a descriptive User-Agent (company name + contact email).
 * The default below uses a working mailbox — if you change it, make sure
 * the address actually receives mail. SEC does sample-validate.
 *
 * Docs: https://www.sec.gov/os/accessing-edgar-data
 */

const UA = process.env.SEC_USER_AGENT || "StockOtter SaaS superotter@stockotter.ai";

// Conservative rate limit: 4 req/sec sustained (250ms min interval).
// SEC's stated cap is 10/sec, but Akamai blocks have been observed at lower
// effective rates when bursty. 4/sec leaves headroom even if multiple crons
// run concurrently and share this throttle.
//
// Critical: the throttle MUST serialize across concurrent callers, not just
// delay each individually. The previous implementation read lastRequestAt
// synchronously, computed `wait`, then awaited setTimeout — which meant N
// concurrent callers all read the same lastRequestAt, all slept the same
// duration, and all woke up together to fire N simultaneous requests. That
// burst is exactly what Akamai 429s. The Promise-chain pattern below
// guarantees only one slot executes the lastRequestAt update at a time, so
// the spacing actually holds at 4 req/sec regardless of concurrency.
const MIN_INTERVAL_MS = 250;
let lastRequestAt = 0;
let throttleChain: Promise<void> = Promise.resolve();

// Akamai-block circuit breaker. Once we see N consecutive 403s, we stop
// making requests for a cooldown period — every additional request while
// blocked may extend the block. Reset on any successful response.
const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_COOLDOWN_MS = 60 * 60 * 1000; // 1h
let consecutive403s = 0;
let blockedUntil = 0;

export function isEdgarCircuitOpen(): boolean {
  return Date.now() < blockedUntil;
}

let lastSuccessAt = 0;
let totalSuccesses = 0;
let totalFailures = 0;

export function getEdgarCircuitStatus() {
  return {
    consecutive403s,
    blockedUntil,
    blockedUntilIso: blockedUntil > 0 ? new Date(blockedUntil).toISOString() : null,
    minutesUntilRetry: blockedUntil > Date.now()
      ? Math.ceil((blockedUntil - Date.now()) / 60000)
      : 0,
    open: Date.now() < blockedUntil,
    lastSuccessAt,
    lastSuccessIso: lastSuccessAt > 0 ? new Date(lastSuccessAt).toISOString() : null,
    totalSuccesses,
    totalFailures,
  };
}

/** Manual circuit reset. Use when SEC has confirmed unblock and we know
 *  the previous 403s aren't recurring. Doesn't override rate limiting —
 *  subsequent requests still go through throttle(). */
export function forceCloseEdgarCircuit(): void {
  consecutive403s = 0;
  blockedUntil = 0;
  console.log("[edgar] circuit breaker manually reset");
}

async function throttle(): Promise<void> {
  const slot = throttleChain.then(async () => {
    const now = Date.now();
    const jitter = Math.floor(Math.random() * 50);
    const wait = Math.max(0, lastRequestAt + MIN_INTERVAL_MS + jitter - now);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastRequestAt = Date.now();
  });
  throttleChain = slot;
  await slot;
}

export interface EdgarFetchOptions {
  retries?: number;
  timeoutMs?: number;
  accept?: string;
}

/** Thrown when EDGAR returns 403 (Akamai-level block). Distinct error class
 *  so warmup loops can detect the block and exit early instead of looping
 *  through 250 tickets all returning the same error. */
export class EdgarBlockedError extends Error {
  status = 403;
  isEdgarBlock = true;
  constructor(url: string) {
    super(`EDGAR 403 Forbidden (Akamai block): ${url}`);
    this.name = "EdgarBlockedError";
  }
}

export async function edgarFetch(url: string, opts: EdgarFetchOptions = {}): Promise<string> {
  const { retries = 2, timeoutMs = 15000, accept = "application/json, text/xml, */*" } = opts;

  // Circuit breaker — short-circuit if we know we're blocked.
  if (isEdgarCircuitOpen()) {
    throw new EdgarBlockedError(url);
  }

  let lastErr: any;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await throttle();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": UA,
          "Accept": accept,
          "Accept-Encoding": "gzip, deflate",
        },
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (res.status === 403) {
        // Akamai block. Don't retry — retrying makes the block worse.
        // Bump the circuit-breaker counter; if we cross the threshold,
        // open the circuit for the cooldown period.
        consecutive403s++;
        if (consecutive403s >= CIRCUIT_BREAKER_THRESHOLD) {
          blockedUntil = Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS;
          console.warn(
            `[edgar] CIRCUIT BREAKER OPEN: ${consecutive403s} consecutive 403s; ` +
            `pausing all EDGAR calls for ${CIRCUIT_BREAKER_COOLDOWN_MS / 60000}min`
          );
        }
        throw new EdgarBlockedError(url);
      }
      if (res.status === 429) {
        // Rate limited. Back off exponentially.
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
        lastErr = new Error(`EDGAR 429 rate limited: ${url}`);
        continue;
      }
      if (!res.ok) {
        throw new Error(`EDGAR ${res.status} ${res.statusText}: ${url}`);
      }
      // Success — reset the 403 counter.
      consecutive403s = 0;
      lastSuccessAt = Date.now();
      totalSuccesses++;
      return await res.text();
    } catch (err: any) {
      clearTimeout(timer);
      lastErr = err;
      // Don't retry on Akamai blocks — they don't time out, they need cooldown.
      if (err?.isEdgarBlock) { totalFailures++; throw err; }
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  }
  totalFailures++;
  throw lastErr ?? new Error(`EDGAR fetch failed: ${url}`);
}

export async function edgarFetchJson<T = any>(url: string, opts?: EdgarFetchOptions): Promise<T> {
  const text = await edgarFetch(url, opts);
  return JSON.parse(text) as T;
}
