/**
 * My Trades widget — compact dashboard view of personal trade P/L.
 *
 * Reads via canonical `useTrades` + `useTradesSummary` hooks. Per-row P/L
 * uses shared/pnl primitives so the numbers match `/api/trades/summary`
 * (server-side canonical). Clicking a row publishes the ticker to the
 * shared `TickerContext` bus.
 */
import { useMemo } from "react";
import { useTicker } from "@/contexts/TickerContext";
import { ClipboardList, TrendingUp, TrendingDown } from "lucide-react";
import { useTrades, useTradesSummary } from "./useTrades";
import { computeClosedTradeProfit } from "@shared/pnl";
import type { Trade } from "@shared/schema";

function fmtMoney(n: number): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

function pnlColor(n: number): string {
  if (n > 0) return "text-green-500";
  if (n < 0) return "text-red-500";
  return "text-muted-foreground";
}

export function MyTradesWidget() {
  const { setActiveTicker } = useTicker();
  const trades = useTrades();
  const summary = useTradesSummary();

  const recentClosed = useMemo(() => {
    if (!trades.data) return [] as Array<Trade & { profit: number }>;
    return trades.data
      .filter((t) => !!t.closeDate)
      .map((t) => ({ ...t, profit: computeClosedTradeProfit(t) }))
      .sort((a, b) => (b.closeDate ?? "").localeCompare(a.closeDate ?? ""))
      .slice(0, 4);
  }, [trades.data]);

  const isLoading = trades.isLoading || summary.isLoading;
  const error = trades.error ?? summary.error;

  return (
    <div className="flex flex-col h-full p-2" data-testid="mytrades-widget">
      <div className="widget-drag-handle cursor-grab active:cursor-grabbing flex items-center gap-1.5 px-1 pb-2 border-b border-border">
        <ClipboardList className="h-3.5 w-3.5 text-blue-500" />
        <span className="text-xs font-semibold text-foreground">My Trades</span>
      </div>

      <div className="flex-1 overflow-y-auto pt-2">
        {isLoading && <div className="text-xs text-muted-foreground p-2">Loading…</div>}
        {error && <div className="text-xs text-red-500 p-2">Failed to load trades.</div>}

        {!isLoading && !error && summary.data && (
          <>
            <div className="grid grid-cols-2 gap-2 px-1 pb-2">
              <div>
                <div className="text-mini text-muted-foreground uppercase tracking-wide">Realized P/L</div>
                <div className={`text-base font-bold tabular-nums ${pnlColor(summary.data.totalProfit)}`}>
                  {fmtMoney(summary.data.totalProfit)}
                </div>
                <div className="text-micro text-muted-foreground">
                  {summary.data.totalWins} wins ({summary.data.winRate.toFixed(0)}%)
                </div>
              </div>
              <div>
                <div className="text-mini text-muted-foreground uppercase tracking-wide">Open ({summary.data.openTrades})</div>
                <div className={`text-base font-bold tabular-nums ${pnlColor(summary.data.openPL)}`}>
                  {fmtMoney(summary.data.openPL)}
                </div>
                <div className="text-micro text-muted-foreground">unrealized</div>
              </div>
            </div>

            <div className="border-t border-border pt-1">
              <div className="text-mini text-muted-foreground uppercase tracking-wide px-1 pb-1">Recent closed</div>
              {recentClosed.length === 0 && (
                <div className="text-xs text-muted-foreground p-2">No closed trades yet.</div>
              )}
              {recentClosed.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between py-1 px-2 rounded hover:bg-muted/50 transition-colors cursor-pointer"
                  onClick={() => setActiveTicker(t.symbol)}
                  data-testid={`mytrades-row-${t.id}`}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    {t.profit >= 0 ? (
                      <TrendingUp className="h-3 w-3 text-green-500 flex-shrink-0" />
                    ) : (
                      <TrendingDown className="h-3 w-3 text-red-500 flex-shrink-0" />
                    )}
                    <span className="font-mono font-bold text-xs">{t.symbol}</span>
                    <span className="text-mini text-muted-foreground truncate">{t.tradeType}</span>
                  </div>
                  <span className={`text-xs font-bold tabular-nums ${pnlColor(t.profit)}`}>
                    {fmtMoney(t.profit)}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
