/**
 * Canonical hook for the unified scanner. The query stays DISABLED until the
 * required filters (market-cap tier + price band) are set — no blind scan.
 */
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { ScanFilters, ScanHit } from "@shared/scanner/types";

export interface UnifiedScanResponse {
  filters: ScanFilters;
  source: "cache" | "live";
  ageHours: number | null;
  generatedAt: string;
  count: number;
  hits: ScanHit[];
}

function toQuery(f: ScanFilters, refresh: boolean): string {
  const p = new URLSearchParams();
  p.set("marketCapTier", f.marketCapTier);
  p.set("priceBandId", f.priceBandId);
  if (f.sector && f.sector !== "all") p.set("sector", f.sector);
  if (f.strategyIds.length) p.set("strategyIds", f.strategyIds.join(","));
  p.set("minScore", String(f.minScore));
  p.set("topN", String(f.topN));
  if (refresh) p.set("refresh", "1");
  return p.toString();
}

/**
 * @param filters  null until the user has chosen the required filters; the
 *                 query won't fire while null.
 * @param refresh  when true, the next fetch bypasses the cache (on-demand scan).
 */
export function useUnifiedScanner(filters: ScanFilters | null, refresh = false) {
  return useQuery<UnifiedScanResponse>({
    queryKey: ["/api/unified-scanner", filters, refresh],
    queryFn: async () => (await apiRequest("GET", `/api/unified-scanner?${toQuery(filters!, refresh)}`)).json(),
    enabled: filters !== null,
    staleTime: 5 * 60 * 1000,
  });
}

export type { ScanFilters, ScanHit };
export { MARKET_CAP_TIERS, MIN_GREEN, DEFAULT_TOP_N, getMarketCapTier } from "@shared/scanner/types";
