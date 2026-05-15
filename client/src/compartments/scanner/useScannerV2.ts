/**
 * Canonical client-side hook for Scanner v2.
 *
 * Replaces ad-hoc sessionStorage round-trips in `client/src/pages/scanner.tsx`.
 * The query result is automatically persisted to sessionStorage via the
 * App.tsx-level `PersistQueryClientProvider` for any queryKey starting with
 * `/api/scanner`. Scanner page migration to this hook is a follow-up task.
 *
 * Q-C1 lock-in (DASHBOARD_PLAN.md): persisted TanStack Query cache replaces
 * legacy manual sessionStorage code.
 */
import { useQuery } from "@tanstack/react-query";

export interface ScannerV2Filters {
  /** Market cap tier: "all" | "mega" | "large" | "mid" | "small" */
  marketCap?: string;
  minPrice?: number;
  maxPrice?: number;
  /** Sector name or "all" */
  sector?: string;
  minVolume?: number;
  /** Direction bias: "up" | "down" | "either" */
  direction?: "up" | "down" | "either";
  /** Minimum aggregate score (0-100) to include */
  minScore?: number;
  /** Max rows returned (server caps at 500) */
  count?: number;
  /** Universe size to scan (server caps at 3000) */
  universeSize?: number;
}

export interface ScannerV2SignalResult {
  id: string;
  label: string;
  triggered: boolean;
  strength: number;
  direction: "up" | "down" | "either";
  detail?: string;
}

export interface ScannerV2Row {
  symbol: string;
  companyName: string;
  sector: string;
  industry: string;
  price: number;
  marketCap: number;
  volume: number;
  score: number;
  direction: "up" | "down" | "either";
  signals: ScannerV2SignalResult[];
  topSignals: string[];
}

export interface ScannerV2Response {
  scannedAt: string;
  universeSize: number;
  scanDurationMs: number;
  filters: ScannerV2Filters;
  results: ScannerV2Row[];
}

function buildQuery(filters: ScannerV2Filters): string {
  const params = new URLSearchParams();
  if (filters.marketCap) params.set("marketCap", filters.marketCap);
  if (filters.minPrice != null) params.set("minPrice", String(filters.minPrice));
  if (filters.maxPrice != null) params.set("maxPrice", String(filters.maxPrice));
  if (filters.sector) params.set("sector", filters.sector);
  if (filters.minVolume != null) params.set("minVolume", String(filters.minVolume));
  if (filters.direction) params.set("direction", filters.direction);
  if (filters.minScore != null) params.set("minScore", String(filters.minScore));
  if (filters.count != null) params.set("count", String(filters.count));
  if (filters.universeSize != null) params.set("universeSize", String(filters.universeSize));
  return params.toString();
}

/**
 * Canonical Scanner v2 hook. Disabled by default — call sites pass
 * `enabled: true` (or use the `enabled` option) to trigger the scan.
 * This keeps an idle dashboard widget from auto-firing an FMP scan
 * every time it mounts.
 */
export function useScannerV2(filters: ScannerV2Filters, options?: { enabled?: boolean }) {
  const qs = buildQuery(filters);
  return useQuery<ScannerV2Response>({
    queryKey: ["/api/scanner/v2", qs],
    queryFn: async () => {
      const res = await fetch(`/api/scanner/v2${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw new Error(`Scanner v2 failed: ${res.status}`);
      return res.json();
    },
    enabled: options?.enabled ?? false,
  });
}
