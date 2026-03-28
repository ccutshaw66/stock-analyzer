// ============================================================
// In-memory cache for Yahoo Finance responses
// ============================================================

interface CacheEntry {
  data: any;
  timestamp: number;
  ttl: number;
}

const cache = new Map<string, CacheEntry>();

// Default TTLs by data type — longer = fewer Yahoo requests = fewer 429s
const TTL = {
  quote: 15 * 60 * 1000,        // 15 minutes for quotes (was 5min — prices don't change that fast for scans)
  chart: 30 * 60 * 1000,        // 30 minutes for chart data
  dividend: 2 * 60 * 60 * 1000, // 2 hours for dividend data (changes rarely)
  sector: 60 * 60 * 1000,       // 1 hour for sector data
  institutional: 2 * 60 * 60 * 1000, // 2 hours for institutional data
  options: 15 * 60 * 1000,      // 15 minutes for options chain data
};

export function getCached(key: string): any | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > entry.ttl) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

export function setCache(key: string, data: any, ttlMs?: number): void {
  cache.set(key, {
    data,
    timestamp: Date.now(),
    ttl: ttlMs || TTL.quote,
  });
}

export function clearCache(): void {
  cache.clear();
}

export function getCacheStats(): { size: number; keys: string[] } {
  // Clean expired entries
  const keysToDelete: string[] = [];
  cache.forEach((entry, key) => {
    if (Date.now() - entry.timestamp > entry.ttl) keysToDelete.push(key);
  });
  keysToDelete.forEach(k => cache.delete(k));
  const keys: string[] = [];
  cache.forEach((_, key) => keys.push(key));
  return { size: cache.size, keys };
}

export { TTL };
