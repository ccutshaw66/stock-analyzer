/**
 * Canonical hook for the Confluence Chart page. Composes three existing
 * endpoints into one consumer-friendly shape:
 *   - GET /api/analyze/:ticker — chartData (OHLC + EMA21/50/200 + SMA200)
 *   - GET /api/scanner-v2/quick/:ticker — current 3-gate verdict + score
 *   - GET /api/scanner-v2/indicators/:ticker — last ~60 bars MACD + RSI series
 *
 * All three refetch every 5 minutes while the page is visible. TanStack
 * Query pauses automatically when the tab is hidden.
 */
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

const FIVE_MIN = 5 * 60 * 1000;

export interface CandleBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  ema9?: number | null;
  ema21?: number | null;
  ema50?: number | null;
  sma200?: number | null;
}

export interface QuickScan {
  ticker: string;
  score: number | null;
  verdict: string | null;
  cached?: boolean;
}

export interface IndicatorBar {
  t: number;
  close: number;
  macd: number;
  signal: number;
  hist: number;
  rsi: number | null;
}

export function useConfluenceChart(ticker: string | null, timeframe: string) {
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

  const quick = useQuery<QuickScan>({
    queryKey: ["/api/scanner-v2/quick", ticker, timeframe],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/scanner-v2/quick/${ticker}?timeframe=${timeframe}`);
      return res.json();
    },
    enabled: !!ticker,
    refetchInterval: FIVE_MIN,
  });

  const indicators = useQuery<{ ticker: string; series: IndicatorBar[]; reason?: string }>({
    queryKey: ["/api/scanner-v2/indicators", ticker, 60, timeframe],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/scanner-v2/indicators/${ticker}?bars=60&timeframe=${timeframe}`);
      return res.json();
    },
    enabled: !!ticker,
    refetchInterval: FIVE_MIN,
  });

  const bars: CandleBar[] = (analyze.data?.chartData ?? []) as CandleBar[];
  const quoteSummary = analyze.data?.quote ?? null;

  return {
    bars,
    quote: quoteSummary,
    quick: quick.data,
    indicators: indicators.data?.series ?? [],
    isLoading: analyze.isLoading || quick.isLoading || indicators.isLoading,
    error: analyze.error ?? quick.error ?? indicators.error,
  };
}
