import { createContext, useContext, useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

interface TickerContextType {
  activeTicker: string | null;
  setActiveTicker: (ticker: string) => void;
  analysisData: any | null;
  tradeData: any | null;
  isAnalysisLoading: boolean;
  isTradeLoading: boolean;
  analysisError: Error | null;
  tradeError: Error | null;
  dataUpdatedAt: number;
}

const TickerContext = createContext<TickerContextType | null>(null);

export function TickerProvider({ children }: { children: React.ReactNode }) {
  const [activeTicker, setActiveTickerRaw] = useState<string | null>(null);

  const setActiveTicker = useCallback((ticker: string) => {
    setActiveTickerRaw(ticker.toUpperCase());
  }, []);

  const DATA_STALE_TIME = 30 * 60 * 1000; // 30 minutes

  const {
    data: analysisData,
    isLoading: isAnalysisLoading,
    error: analysisError,
    dataUpdatedAt: analysisUpdatedAt,
  } = useQuery({
    queryKey: ["/api/analyze", activeTicker],
    queryFn: async () => {
      if (!activeTicker) return null;
      const res = await apiRequest("GET", `/api/analyze/${activeTicker}`);
      return res.json();
    },
    enabled: !!activeTicker,
    staleTime: DATA_STALE_TIME,
  });

  const {
    data: tradeData,
    isLoading: isTradeLoading,
    error: tradeError,
    dataUpdatedAt: tradeUpdatedAt,
  } = useQuery({
    queryKey: ["/api/trade-analysis", activeTicker],
    queryFn: async () => {
      if (!activeTicker) return null;
      const res = await apiRequest("GET", `/api/trade-analysis/${activeTicker}`);
      return res.json();
    },
    enabled: !!activeTicker,
    retry: 1,
    staleTime: DATA_STALE_TIME,
  });

  const dataUpdatedAt = Math.max(analysisUpdatedAt || 0, tradeUpdatedAt || 0);

  return (
    <TickerContext.Provider
      value={{
        activeTicker,
        setActiveTicker,
        analysisData: analysisData ?? null,
        tradeData: tradeData ?? null,
        isAnalysisLoading,
        isTradeLoading,
        analysisError: analysisError as Error | null,
        tradeError: tradeError as Error | null,
        dataUpdatedAt,
      }}
    >
      {children}
    </TickerContext.Provider>
  );
}

export function useTicker() {
  const ctx = useContext(TickerContext);
  if (!ctx) throw new Error("useTicker must be used within TickerProvider");
  return ctx;
}
