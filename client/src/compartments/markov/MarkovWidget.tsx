/**
 * Markov dashboard widget — compact placeholder until the backend is live.
 *
 * Reads via `useMarkov()` (the one canonical hook). Once the Python service
 * is deployed and the hook starts returning real backtest results, this
 * widget will surface the last run's headline numbers — Sharpe, CAGR, and
 * max drawdown — with a sparkline of the equity curve.
 */
import { Link } from "wouter";
import { Network } from "lucide-react";
import { useMarkov } from "./useMarkov";

export function MarkovWidget() {
  const M = useMarkov();

  return (
    <div className="flex flex-col h-full p-2" data-testid="markov-widget">
      <Link href="/markov">
        <div className="widget-drag-handle cursor-grab active:cursor-grabbing flex items-center justify-between px-1 pb-2 border-b border-border">
          <div className="flex items-center gap-1.5">
            <Network className="h-3.5 w-3.5 text-purple-400" />
            <span className="text-xs font-semibold text-foreground">Markov</span>
          </div>
          <span
            className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
              M.connected
                ? "bg-green-500/15 text-green-400"
                : "bg-amber-500/15 text-amber-400"
            }`}
          >
            {M.connected ? "Live" : "Pending"}
          </span>
        </div>
      </Link>

      <div className="flex-1 flex items-center justify-center text-center px-3">
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          {M.connected
            ? "Open the full page to run a backtest."
            : "Awaiting Python service deployment. Source is checked in at python/markov_trading_v2.py."}
        </p>
      </div>
    </div>
  );
}
