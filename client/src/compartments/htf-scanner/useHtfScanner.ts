/**
 * Canonical client-side hook for the HTF scanner.
 *
 * Every consumer (full page, dashboard widget, alert rules) routes through
 * here — no parallel `useQuery({ queryKey: "/api/htf/setups" })` blocks.
 *
 * The first call on a cold server cache triggers a fresh scan and may take
 * ~1 min; subsequent calls within the 30-min in-memory window return
 * instantly. `staleTime` is set generously so React Query doesn't time out
 * during the cold-start scan.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export interface HtfSetupRow {
  id: number;
  symbol: string;
  pattern: string;
  breakoutDate: string;
  breakoutPrice: number;
  targetPrice: number;
  stopPrice: number;
  qualityScore: number;
  poleGainPct: number;
  poleDays: number;
  flagDays: number;
  flagPullbackPct: number;
  breakoutVolRatio: number;
  recommendedShares: number;
  positionValue: number;
  actualRisk: number;
  rewardRiskRatio: number;
  actionable: boolean;
  blockedReason: string | null;
  warnings: string[] | null;
  sector: string | null;
}

export interface HtfSetupsResponse {
  scannedAt: string | null;
  durationMs: number;
  universeSize: number;
  rows: HtfSetupRow[];
}

export interface UseHtfScannerOptions {
  /** When true, request only actionable rows. */
  actionableOnly?: boolean;
  /** Minimum quality score filter. */
  minScore?: number;
  /** Restrict to a single symbol (useful for spot-checks). */
  symbol?: string;
  /** Endpoint variant: "setups" (full) or "filtered" (blocked only). */
  variant?: "setups" | "filtered";
}

function buildPath(opts: UseHtfScannerOptions): string {
  const variant = opts.variant ?? "setups";
  const base = variant === "filtered" ? "/api/htf/setups/filtered" : "/api/htf/setups";
  const qs = new URLSearchParams();
  if (opts.actionableOnly) qs.set("actionableOnly", "true");
  if (opts.minScore !== undefined) qs.set("minScore", String(opts.minScore));
  if (opts.symbol) qs.set("symbol", opts.symbol);
  const q = qs.toString();
  return q ? `${base}?${q}` : base;
}

/**
 * Read the live HTF setups list. Triggers a fresh server-side scan if the
 * in-memory cache is stale (≥30 min); returns instantly otherwise.
 */
export function useHtfScanner(opts: UseHtfScannerOptions = {}) {
  const path = buildPath(opts);
  return useQuery<HtfSetupsResponse>({
    queryKey: [path],
    queryFn: async () => (await apiRequest("GET", path)).json(),
    staleTime: 60_000,
  });
}

/** Force-refresh mutation — bypasses the in-memory 30-min cache. */
export function useHtfScannerRefresh() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/htf/scan/run", {})).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/htf/setups"] });
      qc.invalidateQueries({ queryKey: ["/api/htf/setups/filtered"] });
    },
  });
}
