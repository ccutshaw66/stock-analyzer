/**
 * Best Opps widget — compact dashboard view of top scanner v2 picks.
 *
 * Opt-in: shows a "Run Scan" CTA on first mount instead of auto-firing
 * an FMP scan every time the dashboard opens. Once a scan runs, results
 * are persisted to sessionStorage via the App.tsx persister, so navigating
 * away and back doesn't re-scan.
 */
import { useState } from "react";
import { useTickerNavigate } from "@/lib/useTickerNavigate";
import { Flame, TrendingUp, TrendingDown, RefreshCw, Play } from "lucide-react";
import { useScannerV2, type ScannerV2Filters, type ScannerV2Row } from "./useScannerV2";

const DEFAULT_FILTERS: ScannerV2Filters = {
  direction: "either",
  minScore: 30,
  count: 5,
  universeSize: 1000,
  marketCap: "all",
};

function DirectionIcon({ direction }: { direction: ScannerV2Row["direction"] }) {
  if (direction === "up") return <TrendingUp className="h-3 w-3 text-bull" />;
  if (direction === "down") return <TrendingDown className="h-3 w-3 text-bear" />;
  return <span className="text-xs text-muted-foreground">~</span>;
}

function Row({ row, onSelect }: { row: ScannerV2Row; onSelect: () => void }) {
  return (
    <div
      className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/50 transition-colors cursor-pointer"
      onClick={onSelect}
      data-testid={`bestopps-row-${row.symbol}`}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <DirectionIcon direction={row.direction} />
        <span className="font-mono font-bold text-sm">{row.symbol}</span>
        {row.topSignals[0] && (
          <span className="text-mini text-muted-foreground truncate hidden sm:inline">
            {row.topSignals[0].replace(/_/g, " ")}
          </span>
        )}
      </div>
      <span className="text-xs font-bold tabular-nums text-foreground">{row.score.toFixed(0)}</span>
    </div>
  );
}

export function BestOppsWidget() {
  const [enabled, setEnabled] = useState(false);
  const tickerNavigate = useTickerNavigate();
  const { data, isFetching, error, refetch } = useScannerV2(DEFAULT_FILTERS, { enabled });

  const hasResults = data?.results && data.results.length > 0;

  return (
    <div className="flex flex-col h-full p-2" data-testid="bestopps-widget">
      <div className="widget-drag-handle cursor-grab active:cursor-grabbing flex items-center justify-between gap-1.5 px-1 pb-2 border-b border-border">
        <div className="flex items-center gap-1.5">
          <Flame className="h-3.5 w-3.5 text-orange-500" />
          <span className="text-xs font-semibold text-foreground">Best Opps</span>
        </div>
        {hasResults && (
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="widget-no-drag text-muted-foreground hover:text-foreground p-0.5 disabled:opacity-50"
            data-testid="button-bestopps-refresh"
            aria-label="Refresh scan"
          >
            <RefreshCw className={`h-3 w-3 ${isFetching ? "animate-spin" : ""}`} />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto pt-1">
        {!enabled && !hasResults && (
          <div className="flex flex-col items-center justify-center h-full text-center px-2">
            <button
              onClick={() => setEnabled(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-orange-500/20 hover:bg-orange-500/30 text-orange-300 text-xs font-medium"
              data-testid="button-bestopps-run"
            >
              <Play className="h-3 w-3" />
              Run scan
            </button>
            <p className="text-micro text-muted-foreground mt-2">Top 5 confluence setups, market-wide.</p>
          </div>
        )}

        {isFetching && !hasResults && (
          <div className="text-xs text-muted-foreground p-2">Scanning ~1000 tickers…</div>
        )}

        {error && (
          <div className="text-xs text-bear p-2">Scan failed: {(error as Error).message}</div>
        )}

        {hasResults && data!.results.slice(0, 5).map((row) => (
          <Row key={row.symbol} row={row} onSelect={() => tickerNavigate(row.symbol)} />
        ))}

        {data && !hasResults && !isFetching && (
          <div className="text-xs text-muted-foreground p-2">No setups matched the filters.</div>
        )}
      </div>
    </div>
  );
}
