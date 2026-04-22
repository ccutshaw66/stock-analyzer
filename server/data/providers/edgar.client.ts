/**
 * SEC EDGAR HTTP client.
 *
 * Public data, no API key. Rate limit: 10 req/sec per IP.
 * SEC requires a descriptive User-Agent (company name + contact email).
 *
 * Docs: https://www.sec.gov/os/accessing-edgar-data
 */

const UA = process.env.SEC_USER_AGENT || "StockOtter SaaS contact@stockotter.ai";

// Simple rate limiter: 8 req/sec (under SEC's 10/sec cap)
const MIN_INTERVAL_MS = 125;
let lastRequestAt = 0;

async function throttle() {
  const now = Date.now();
  const wait = Math.max(0, lastRequestAt + MIN_INTERVAL_MS - now);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

export interface EdgarFetchOptions {
  retries?: number;
  timeoutMs?: number;
  accept?: string;
}

export async function edgarFetch(url: string, opts: EdgarFetchOptions = {}): Promise<string> {
  const { retries = 2, timeoutMs = 15000, accept = "application/json, text/xml, */*" } = opts;

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
      if (res.status === 429) {
        // Back off on rate limit
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        lastErr = new Error(`EDGAR 429 rate limited: ${url}`);
        continue;
      }
      if (!res.ok) {
        throw new Error(`EDGAR ${res.status} ${res.statusText}: ${url}`);
      }
      return await res.text();
    } catch (err: any) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  }
  throw lastErr ?? new Error(`EDGAR fetch failed: ${url}`);
}

export async function edgarFetchJson<T = any>(url: string, opts?: EdgarFetchOptions): Promise<T> {
  const text = await edgarFetch(url, opts);
  return JSON.parse(text) as T;
}
