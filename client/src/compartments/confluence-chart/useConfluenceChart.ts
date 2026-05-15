/**
 * Canonical hook for the Confluence Chart compartment.
 *
 * Reuses two existing canonical endpoints:
 *   - GET /api/analyze/:ticker  → chartData (close prices + EMA21/EMA50/SMA200 overlays)
 *   - GET /api/scanner-v2/quick/:ticker → verdict + score (gate-based)
 *
 * No new server endpoints. Refresh interval matches the Round 8 lock (5 min
 * while visible) — TanStack Query auto-pauses when the tab is hidden.
 */
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

const FIVE_MIN = 5 * 60 * 1000;

export interface ChartDataPoint {
  date: string;
  close: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
  ema9?: number | null;
  ema21?: number | null;
  ema50?: number | null;
  sma200?: number | null;
}

export interface QuickScanResult {
  ticker: string;
  /** Number of gates cleared (0-3 in the 3-gate verdict system). */
  score: number | null;
  /** Verdict string: "GO ↑" / "SET ↑" / "READY ↑" / "PULLBACK" / "GATES CLOSED" / "NO SETUP" / etc. */
  verdict: string | null;
  cached?: boolean;
}

export function useConfluenceChartData(ticker: string | null, timeframe: string) {
  const analyze = useQuery({
    queryKey: ["/api/analyze", ticker, timeframe],
    queryFn: async () => {
      if (!ticker) return null;
      const res = await apiRequest("GET", `/api/analyze/${ticker}?timeframe=${timeframe}`);
      return res.json();
    },
    enabled: !!ticker,
    refetchInterval: FIVE_MIN,
  });

  const scan = useQuery<QuickScanResult>({
    queryKey: ["/api/scanner-v2/quick", ticker, timeframe],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/scanner-v2/quick/${ticker}?timeframe=${timeframe}`);
      return res.json();
    },
    enabled: !!ticker,
    refetchInterval: FIVE_MIN,
  });

  return {
    chartData: (analyze.data?.chartData ?? []) as ChartDataPoint[],
    scan: scan.data,
    isLoading: analyze.isLoading || scan.isLoading,
    error: analyze.error ?? scan.error,
  };
}
