// ============================================================
// In-memory cache for Yahoo Finance responses
// ============================================================

interface CacheEntry {
  data: any;
  timestamp: number;
  ttl: number;
}

const cache = new Map<string, CacheEntry>();

// Default TTLs by data type
const TTL = {
  quote: 5 * 60 * 1000,         // 5 minutes for quotes (price changes)
  chart: 15 * 60 * 1000,        // 15 minutes for chart data
  dividend: 60 * 60 * 1000,     // 1 hour for dividend data (changes rarely)
  sector: 30 * 60 * 1000,       // 30 minutes for sector data
  institutional: 60 * 60 * 1000, // 1 hour for institutional data
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
