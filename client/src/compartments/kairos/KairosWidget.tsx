/**
 * KAIROS dashboard widget — compact view.
 *
 * Pulls just the bits that fit a small tile: status pill, total P/L %,
 * open-position count, recent trade count. Clicking the title navigates
 * to the full KAIROS page.
 *
 * When the bot is offline (Milestone 1), the widget shows the offline
 * pill and an "awaiting deploy" note — same shape, just no live data.
 */
import { Link } from "wouter";
import { Bot, Loader2 } from "lucide-react";
import { useMemo } from "react";
import { LineChart, Line, ResponsiveContainer } from "recharts";
import {
  useKairos, equityTotalPct, winRatePct,
  equityDollars, currentEquityDollars, totalPnlDollars, DEFAULT_STARTING_EQUITY,
} from "./useKairos";

export function KairosWidget() {
  const K = useKairos();
  const startingEquity = K.goal.data?.starting_equity ?? DEFAULT_STARTING_EQUITY;
  const totalPct = equityTotalPct(K.equity.data?.equity);
  const winRate = winRatePct(K.trades.data);
  const tradeCount = K.trades.data?.length ?? 0;
  const openCount = K.status.data?.open_positions?.length ?? 0;
  const statusText = K.status.data?.status ?? "unknown";
  const isOnline = !K.offline && statusText.toLowerCase() === "online";

  const currentValue = currentEquityDollars(K.equity.data?.equity, startingEquity);
  const pnlDollars = totalPnlDollars(K.equity.data?.equity, startingEquity);
  const isUp = pnlDollars >= 0;

  const sparkData = useMemo(
    () => equityDollars(K.equity.data?.equity, startingEquity).map((v, i) => ({ i, v })),
    [K.equity.data, startingEquity]
  );

  return (
    <div className="flex flex-col h-full p-2" data-testid="kairos-widget">
      <Link href="/kairos">
        <div className="widget-drag-handle cursor-grab active:cursor-grabbing flex items-center justify-between px-1 pb-2 border-b border-border">
          <div className="flex items-center gap-1.5">
            <Bot className="h-3.5 w-3.5 text-primary" />
            <span className="text-xs font-semibold text-foreground">KAIROS</span>
            <span
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-mini font-bold uppercase ${
                isOnline ? "bg-bull/15 text-bull-light" : "bg-bear/15 text-bear-light"
              }`}
            >
              <span className={`h-1 w-1 rounded-full ${isOnline ? "bg-bull-light" : "bg-bear-light"}`} />
              {isOnline ? statusText : "offline"}
            </span>
          </div>
          {(K.status.isFetching || K.equity.isFetching) && (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          )}
        </div>
      </Link>

      <div className="flex-1 flex flex-col justify-center px-1 py-2 gap-1.5">
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

        <div className="grid grid-cols-3 gap-1 text-mini mt-1">
          <div>
            <p className="text-muted-foreground">Trades</p>
            <p className="font-bold tabular-nums text-foreground">{tradeCount}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Win %</p>
            <p className="font-bold tabular-nums text-foreground">{tradeCount > 0 ? `${winRate.toFixed(0)}%` : "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Open</p>
            <p className="font-bold tabular-nums text-foreground">{openCount}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
