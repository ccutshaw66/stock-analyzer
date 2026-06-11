/**
 * Global request queue for rate-limited provider API calls.
 * Prevents 429 rate limiting by:
 * 1. Limiting concurrent requests (max 2 at a time)
 * 2. Enforcing minimum delay between requests (600ms)
 * 3. Exponential backoff on 429 errors
 * 4. Circuit breaker after repeated failures
 */

type QueuedRequest<T> = {
  fn: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: any) => void;
  label: string;
};

// Tightened 2026-05-04 after persistent 429s during institutional scans.
// Rate-limited providers tolerate ~1 req/sec sustained; bursts trip 429
// even when the average is under their stated cap. Going strictly serial
// with 1500ms gaps (= 0.66 req/sec) and aggressive backoff. The cost is
// slower scans (~45s for 30 fresh tickers vs ~15s previously) but with
// the 24h per-ticker cache this only matters on the first scan.
const MAX_CONCURRENT = 1;
const MIN_DELAY_MS = 1500; // minimum ms between request starts (~0.66 req/sec)
const BACKOFF_BASE_MS = 5000; // base backoff on 429 (was 3s — providers want longer cooldowns)
const MAX_BACKOFF_MS = 60000; // max backoff (was 30s)
const CIRCUIT_BREAK_THRESHOLD = 3; // trip sooner so we don't keep hitting 429s (was 5)
const CIRCUIT_BREAK_PAUSE_MS = 120000; // 2 minute pause on circuit break (was 1m)

let queue: QueuedRequest<any>[] = [];
let activeCount = 0;
let lastRequestTime = 0;
let consecutive429s = 0;
let circuitBroken = false;
let circuitBreakUntil = 0;
let totalRequests = 0;
let totalCacheHits = 0;

export function getQueueStats() {
  return {
    queued: queue.length,
    active: activeCount,
    total: totalRequests,
    cacheHits: totalCacheHits,
    consecutive429s,
    circuitBroken,
    circuitBreakUntil: circuitBroken ? new Date(circuitBreakUntil).toISOString() : null,
  };
}

export function recordCacheHit() {
  totalCacheHits++;
}

/**
 * Enqueue a rate-limited provider request. Returns a promise that resolves when
 * the request completes. Requests are processed in order with rate limiting.
 */
export function enqueue<T>(fn: () => Promise<T>, label = "request"): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    queue.push({ fn, resolve, reject, label });
    processQueue();
  });
}

async function processQueue() {
  if (queue.length === 0) return;
  if (activeCount >= MAX_CONCURRENT) return;

  // Circuit breaker check
  if (circuitBroken) {
    if (Date.now() < circuitBreakUntil) {
      return; // Still paused
    }
    console.log("[queue] Circuit breaker reset, resuming requests");
    circuitBroken = false;
    consecutive429s = 0;
  }

  // Enforce minimum delay between requests
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_DELAY_MS) {
    setTimeout(() => processQueue(), MIN_DELAY_MS - elapsed);
    return;
  }

  const item = queue.shift();
  if (!item) return;

  activeCount++;
  lastRequestTime = Date.now();
  totalRequests++;

  try {
    const result = await item.fn();
    consecutive429s = 0; // Reset on success
    item.resolve(result);
  } catch (err: any) {
    const is429 = err.message?.includes("429") || err.message?.includes("rate limit");
    if (is429) {
      consecutive429s++;
      console.log(`[queue] 429 detected (${consecutive429s}/${CIRCUIT_BREAK_THRESHOLD}) for ${item.label}`);

      if (consecutive429s >= CIRCUIT_BREAK_THRESHOLD) {
        circuitBroken = true;
        circuitBreakUntil = Date.now() + CIRCUIT_BREAK_PAUSE_MS;
        console.log(`[queue] CIRCUIT BREAKER TRIPPED — pausing all requests for ${CIRCUIT_BREAK_PAUSE_MS / 1000}s`);

        // Reject all queued items
        for (const q of queue) {
          q.reject(new Error("Rate limited — circuit breaker active. Try again in 1 minute."));
        }
        queue = [];
      } else {
        // Backoff and re-queue this request at the front
        const backoff = Math.min(BACKOFF_BASE_MS * Math.pow(2, consecutive429s - 1), MAX_BACKOFF_MS);
        console.log(`[queue] Backing off ${backoff}ms before retrying ${item.label}`);
        setTimeout(() => {
          queue.unshift(item); // Put it back at the front
          processQueue();
        }, backoff);
      }
    } else {
      item.reject(err);
    }
  } finally {
    activeCount--;
    // Process next item after a small delay
    if (queue.length > 0) {
      setTimeout(() => processQueue(), MIN_DELAY_MS);
    }
  }
}
