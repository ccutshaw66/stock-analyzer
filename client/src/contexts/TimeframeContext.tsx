import { createContext, useContext, useState, useCallback, useEffect } from "react";

export const TIMEFRAME_VALUES = ["1d", "1mo", "3mo", "6mo", "1y", "2y", "5y"] as const;
export type TimeframeValue = (typeof TIMEFRAME_VALUES)[number];

export const TIMEFRAME_LABELS: Record<TimeframeValue, string> = {
  "1d":  "1D",
  "1mo": "1M",
  "3mo": "3M",
  "6mo": "6M",
  "1y":  "1Y",
  "2y":  "2Y",
  "5y":  "5Y",
};

const STORAGE_KEY = "stockotter.timeframe";
const DEFAULT_TIMEFRAME: TimeframeValue = "1y";

function isTimeframeValue(v: unknown): v is TimeframeValue {
  return typeof v === "string" && (TIMEFRAME_VALUES as readonly string[]).includes(v);
}

interface TimeframeContextType {
  timeframe: TimeframeValue;
  setTimeframe: (v: TimeframeValue) => void;
}

const TimeframeContext = createContext<TimeframeContextType | null>(null);

export function TimeframeProvider({ children }: { children: React.ReactNode }) {
  const [timeframe, setTimeframeRaw] = useState<TimeframeValue>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (isTimeframeValue(stored)) return stored;
    } catch { /* ignore */ }
    return DEFAULT_TIMEFRAME;
  });

  const setTimeframe = useCallback((v: TimeframeValue) => {
    setTimeframeRaw(v);
    try { localStorage.setItem(STORAGE_KEY, v); } catch { /* ignore */ }
  }, []);

  // Sync across tabs
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && isTimeframeValue(e.newValue)) {
        setTimeframeRaw(e.newValue);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return (
    <TimeframeContext.Provider value={{ timeframe, setTimeframe }}>
      {children}
    </TimeframeContext.Provider>
  );
}

export function useTimeframe(): TimeframeContextType {
  const ctx = useContext(TimeframeContext);
  if (!ctx) throw new Error("useTimeframe must be used within TimeframeProvider");
  return ctx;
}
