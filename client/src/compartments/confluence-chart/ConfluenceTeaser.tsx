/**
 * Confluence Chart dashboard teaser — small tile that previews the verdict
 * + spot price + day change and links to the full /chart/confluence/<ticker>
 * page. Replaces the failed Round-8 line widget in the dashboard.
 */
import { useLocation } from "wouter";
import { useTicker } from "@/contexts/TickerContext";
import { useConfluenceChart } from "./useConfluenceChart";
import { Activity, ArrowUpRight } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import type { WidgetViewProps } from "../types";

function verdictColors(verdict: string | null | undefined): { bg: string; text: string; label: string } {
  const v = (verdict ?? "").toUpperCase();
  if (v.startsWith("GO ↑")) return { bg: "bg-bull", text: "text-white", label: verdict! };
  if (v.startsWith("GO")) return { bg: "bg-bear", text: "text-white", label: verdict! };
  if (v.startsWith("SET ↑")) return { bg: "bg-bull/70", text: "text-white", label: verdict! };
  if (v.startsWith("SET")) return { bg: "bg-bear/70", text: "text-white", label: verdict! };
  if (v.startsWith("READY ↑")) return { bg: "bg-bull/30", text: "text-bull-light", label: verdict! };
  if (v.startsWith("READY")) return { bg: "bg-bear/30", text: "text-bear-light", label: verdict! };
  if (v.startsWith("PULLBACK")) return { bg: "bg-amber-500/30", text: "text-amber-300", label: verdict! };
  if (v.startsWith("GATES")) return { bg: "bg-muted", text: "text-muted-foreground", label: "CLOSED" };
  return { bg: "bg-muted", text: "text-muted-foreground", label: verdict || "NO SETUP" };
}

export function ConfluenceTeaser(_props: WidgetViewProps) {
  const { activeTicker } = useTicker();
  const [_, navigate] = useLocation();
  const { bars, quote, quick } = useConfluenceChart(activeTicker, "1M");

  const last = bars.length > 0 ? bars[bars.length - 1] : null;
  const prev = bars.length > 1 ? bars[bars.length - 2] : null;
  const spot = quote?.regularMarketPrice ?? last?.close ?? null;
  const dayChangePct =
    quote?.regularMarketChangePercent ??
    (last && prev && prev.close !== 0 ? ((last.close - prev.close) / prev.close) * 100 : null);

  const style = verdictColors(quick?.verdict);

  const handleClick = () => {
    if (activeTicker) navigate(`/chart/confluence/${activeTicker}`);
    else navigate("/chart/confluence");
  };

  return (
    <div
      className="flex flex-col h-full cursor-pointer hover:bg-muted/20 transition-colors"
      onClick={handleClick}
      data-testid="confluence-teaser"
    >
      <div className="widget-drag-handle cursor-grab active:cursor-grabbing flex items-center justify-between gap-1.5 px-2 py-1.5 border-b border-border">
        <div className="flex items-center gap-1.5">
          <Activity className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-semibold text-foreground">Confluence Chart</span>
        </div>
        <ArrowUpRight className="h-3 w-3 text-muted-foreground" />
      </div>

      <div className="flex-1 flex flex-col items-center justify-center p-3 gap-2">
        {!activeTicker ? (
          <p className="text-xs text-muted-foreground text-center">
            Pick a ticker, then open the full chart.
          </p>
        ) : (
          <>
            <div className="text-xs font-mono font-bold text-foreground">{activeTicker}</div>
            {spot != null && (
              <div className="text-lg font-bold tabular-nums text-foreground">{formatCurrency(spot)}</div>
            )}
            {dayChangePct != null && (
              <div
                className={`text-xs font-semibold tabular-nums ${
                  dayChangePct >= 0 ? "text-bull" : "text-bear"
                }`}
              >
                {dayChangePct >= 0 ? "▲" : "▼"} {Math.abs(dayChangePct).toFixed(2)}%
              </div>
            )}
            <span
              className={`text-micro font-bold px-2 py-0.5 rounded mt-1 ${style.bg} ${style.text}`}
            >
              {style.label}
            </span>
            {quick?.score != null && (
              <div className="text-micro text-muted-foreground">
                Gates <span className="font-bold text-foreground tabular-nums">{quick.score}/3</span>
              </div>
            )}
            <div className="text-micro text-primary mt-2 flex items-center gap-0.5">
              Open full chart <ArrowUpRight className="h-3 w-3" />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
