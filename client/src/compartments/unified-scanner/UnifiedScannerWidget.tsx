/**
 * Unified Scanner dashboard widget — compact top-5 green-grade setups for a
 * sensible default filter (Small-cap / $5–15, all default strategies). Links
 * out to the full /scanner page and routes tickers to /profile.
 */
import { useLocation } from "wouter";
import { useTickerNavigate } from "@/lib/useTickerNavigate";
import { useUnifiedScanner } from "./useUnifiedScanner";
import type { ScanFilters } from "@shared/scanner/types";
import { listScannableStrategies } from "@shared/strategies/registry";
import { Radar, Loader2, ArrowUpRight } from "lucide-react";

const WIDGET_FILTERS: ScanFilters = {
  marketCapTier: "small",
  priceBandId: "p2", // $5–15
  sector: "all",
  strategyIds: listScannableStrategies().filter(m => m.liveScan?.defaultOn).map(m => m.id),
  minScore: 80,
  topN: 5,
};

export function UnifiedScannerWidget() {
  const drillTo = useTickerNavigate();
  const [, navigate] = useLocation();
  const { data, isLoading, error } = useUnifiedScanner(WIDGET_FILTERS);
  const hits = data?.hits ?? [];

  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
          <Radar className="h-4 w-4 text-primary" /> Top Setups
        </span>
        <button onClick={() => navigate("/scanner")} className="text-xs text-muted-foreground hover:text-foreground">
          Open scanner →
        </button>
      </div>

      {isLoading && (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      )}
      {!isLoading && error && (
        <div className="flex flex-1 items-center justify-center text-xs text-red-400">Couldn't load setups.</div>
      )}
      {!isLoading && !error && hits.length === 0 && (
        <div className="flex flex-1 items-center justify-center px-2 text-center text-xs text-muted-foreground">
          No green-grade small-cap setups right now.
        </div>
      )}
      {!isLoading && hits.length > 0 && (
        <div className="flex-1 space-y-1.5 overflow-auto">
          {hits.map((h, i) => (
            <button
              key={`${h.symbol}-${h.strategyId}-${i}`}
              onClick={() => drillTo(h.symbol)}
              className="group flex w-full items-center gap-2 rounded-md border border-border bg-background/40 px-2 py-1.5 text-left hover:border-primary/40"
            >
              <span className="rounded bg-green-500/15 px-1.5 py-0.5 text-xs font-bold text-green-500">{h.score}</span>
              <span className="font-mono text-sm font-semibold text-foreground">{h.symbol}</span>
              <span className="rounded bg-primary/10 px-1 text-[10px] text-primary">{h.strategyLabel}</span>
              <span className="ml-auto text-xs text-muted-foreground">${h.price.toFixed(2)}</span>
              <ArrowUpRight className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
