/**
 * HERMES dashboard widget — compact view.
 *
 * Reads via `useHermes()` (the one canonical hook). Pulls just the bits
 * that fit a small tile: status pill, total P/L %, equity sparkline.
 * Clicking the title navigates to the full HERMES page.
 */
import { Link } from "wouter";
import { Bot, Loader2 } from "lucide-react";
import { LineChart, Line, ResponsiveContainer } from "recharts";
import { useMemo } from "react";
import {
  useHermes, equityTotalPct, equityDollars, currentEquityDollars,
  totalPnlDollars, DEFAULT_STARTING_EQUITY,
} from "./useHermes";

export function HermesWidget() {
  const H = useHermes();
  const startingEquity = H.goal.data?.starting_equity ?? DEFAULT_STARTING_EQUITY;

  const sparkData = useMemo(
    () => equityDollars(H.equity.data?.equity, startingEquity).map((v, i) => ({ i, v })),
    [H.equity.data, startingEquity]
  );
  const totalPct = equityTotalPct(H.equity.data?.equity);
  const pnlDollars = totalPnlDollars(H.equity.data?.equity, startingEquity);
  const currentValue = currentEquityDollars(H.equity.data?.equity, startingEquity);
  const stats = H.stats.data;
  const statusText = H.status.data?.status ?? "unknown";
  const isOnline = statusText.toLowerCase() === "online";
  const isUp = pnlDollars >= 0;

  return (
    <div className="flex flex-col h-full p-2" data-testid="hermes-widget">
      <Link href="/hermes">
        <div className="widget-drag-handle cursor-grab active:cursor-grabbing flex items-center justify-between px-1 pb-2 border-b border-border">
          <div className="flex items-center gap-1.5">
            <Bot className="h-3.5 w-3.5 text-purple-400" />
            <span className="text-xs font-semibold text-foreground">HERMES</span>
            <span
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase ${
                isOnline ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"
              }`}
            >
              <span className={`h-1 w-1 rounded-full ${isOnline ? "bg-green-400" : "bg-red-400"}`} />
              {statusText}
            </span>
          </div>
          {(H.status.isFetching || H.equity.isFetching) && (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          )}
        </div>
      </Link>

      <div className="flex-1 flex flex-col justify-center px-1 py-2 gap-1.5">
        {/* Account value + P/L (dollars first — that's the warm-and-fuzzy view) */}
        <div className="space-y-0.5">
          <div className="flex items-baseline justify-between">
            <span className="text-mini uppercase tracking-wider text-muted-foreground">Account</span>
            <span className={`text-lg font-bold tabular-nums font-mono ${isUp ? "text-bull-light" : "text-bear-light"}`}>
              ${currentValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-mini uppercase tracking-wider text-muted-foreground">P/L</span>
            <span className={`text-2xs font-bold tabular-nums font-mono ${isUp ? "text-bull-light" : "text-bear-light"}`}>
              {isUp ? "+" : ""}${Math.abs(pnlDollars).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              {" · "}
              {isUp ? "+" : ""}{totalPct.toFixed(2)}%
            </span>
          </div>
        </div>

        {/* Equity sparkline */}
        {sparkData.length >= 2 && (
          <div className="h-12 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sparkData} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
                <Line
                  type="monotone"
                  dataKey="v"
                  stroke={isUp ? "rgb(var(--signal-bull-light))" : "rgb(var(--signal-bear-light))"}
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Mini stats row */}
        {stats && (
          <div className="grid grid-cols-3 gap-1 text-[10px] mt-1">
            <div>
              <p className="text-muted-foreground">Trades</p>
              <p className="font-bold tabular-nums">{stats.total_trades}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Win %</p>
              <p className="font-bold tabular-nums">{stats.win_rate.toFixed(0)}%</p>
            </div>
            <div>
              <p className="text-muted-foreground">Sharpe</p>
              <p className="font-bold tabular-nums">{stats.sharpe.toFixed(2)}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
