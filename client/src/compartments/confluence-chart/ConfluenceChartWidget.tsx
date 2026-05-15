/**
 * Confluence Chart widget — compact at-a-glance view per ticker.
 *
 * - Reads `TickerContext.activeTicker` for the ticker to display.
 * - Owns its timeframe via `config.timeframe` (persisted per-user via
 *   the dashboard layout JSONB). Default "3M".
 * - Top: close-price line chart + EMA21 + EMA50 overlays.
 * - Bottom signal pane: small verdict pill + gate score (gates cleared 0-3).
 * - Click body → setActiveTicker + navigate to `/profile` for the deeper view.
 *
 * Round 8 v1. Per-signal "top 5 firing" content (from Round 8b Q2) requires a
 * single-ticker scanner-v2 breakdown endpoint that doesn't exist yet; this
 * v1 ships the gate-based verdict + score (Stockotter's native "one voice
 * for signals" output) so the widget is useful immediately. Future round
 * extends the endpoint and swaps in per-signal bars.
 */
import { useMemo, useState, useEffect } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useLocation } from "wouter";
import { useTicker } from "@/contexts/TickerContext";
import { useConfluenceChartData } from "./useConfluenceChart";
import type { WidgetViewProps } from "../types";
import { Activity, ChevronDown } from "lucide-react";

const TIMEFRAME_OPTIONS = ["1M", "3M", "6M", "1Y", "2Y", "5Y"] as const;
type Timeframe = (typeof TIMEFRAME_OPTIONS)[number];
const DEFAULT_TIMEFRAME: Timeframe = "3M";

function isTimeframe(v: unknown): v is Timeframe {
  return typeof v === "string" && (TIMEFRAME_OPTIONS as readonly string[]).includes(v);
}

function verdictColor(verdict: string | null | undefined): { bg: string; text: string; label: string } {
  const v = (verdict ?? "").toUpperCase();
  if (v.startsWith("GO ↑") || v.startsWith("GO_UP")) return { bg: "bg-green-500", text: "text-white", label: verdict! };
  if (v.startsWith("GO")) return { bg: "bg-red-500", text: "text-white", label: verdict! };
  if (v.startsWith("SET ↑") || v.startsWith("SET_UP")) return { bg: "bg-green-500/70", text: "text-white", label: verdict! };
  if (v.startsWith("SET")) return { bg: "bg-red-500/70", text: "text-white", label: verdict! };
  if (v.startsWith("READY ↑")) return { bg: "bg-green-500/30", text: "text-green-300", label: verdict! };
  if (v.startsWith("READY")) return { bg: "bg-red-500/30", text: "text-red-300", label: verdict! };
  if (v.startsWith("PULLBACK")) return { bg: "bg-amber-500/30", text: "text-amber-300", label: verdict! };
  if (v.startsWith("GATES")) return { bg: "bg-muted", text: "text-muted-foreground", label: "CLOSED" };
  return { bg: "bg-muted", text: "text-muted-foreground", label: verdict || "NO SETUP" };
}

export function ConfluenceChartWidget({ config, onConfigChange }: WidgetViewProps) {
  const { activeTicker, setActiveTicker } = useTicker();
  const [_, navigate] = useLocation();

  // Initialize from persisted config; default to 3M.
  const persistedTf = isTimeframe(config?.timeframe) ? (config!.timeframe as Timeframe) : DEFAULT_TIMEFRAME;
  const [timeframe, setTimeframe] = useState<Timeframe>(persistedTf);

  // Keep local state in sync if config changes externally (e.g. another tab).
  useEffect(() => {
    if (isTimeframe(config?.timeframe) && config!.timeframe !== timeframe) {
      setTimeframe(config!.timeframe as Timeframe);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.timeframe]);

  const handleTimeframeChange = (tf: Timeframe) => {
    setTimeframe(tf);
    onConfigChange?.({ ...(config ?? {}), timeframe: tf });
  };

  const { chartData, scan, isLoading, error } = useConfluenceChartData(activeTicker, timeframe);

  const verdictStyle = useMemo(() => verdictColor(scan?.verdict), [scan?.verdict]);

  const handleBodyClick = (e: React.MouseEvent) => {
    // Don't navigate when clicking the timeframe dropdown.
    if ((e.target as HTMLElement).closest(".widget-no-drag")) return;
    if (!activeTicker) return;
    setActiveTicker(activeTicker);
    navigate("/profile");
  };

  return (
    <div className="flex flex-col h-full" data-testid="confluence-chart-widget">
      {/* Header (drag handle) */}
      <div className="widget-drag-handle cursor-grab active:cursor-grabbing flex items-center justify-between gap-1.5 px-2 py-1.5 border-b border-border">
        <div className="flex items-center gap-1.5 min-w-0">
          <Activity className="h-3.5 w-3.5 text-purple-500 flex-shrink-0" />
          <span className="text-xs font-semibold text-foreground">Confluence</span>
          {activeTicker && (
            <span className="text-xs font-mono font-bold text-foreground/80 truncate">{activeTicker}</span>
          )}
        </div>
        <div className="relative">
          <select
            value={timeframe}
            onChange={(e) => handleTimeframeChange(e.target.value as Timeframe)}
            onMouseDown={(e) => e.stopPropagation()}
            className="widget-no-drag text-[10px] bg-muted text-foreground rounded px-1.5 py-0.5 pr-4 appearance-none cursor-pointer"
            data-testid="select-confluence-timeframe"
          >
            {TIMEFRAME_OPTIONS.map((tf) => (
              <option key={tf} value={tf}>{tf}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-0.5 top-1/2 -translate-y-1/2 h-3 w-3 pointer-events-none text-muted-foreground" />
        </div>
      </div>

      {/* Body — clickable */}
      <div
        className={`flex-1 flex flex-col ${activeTicker ? "cursor-pointer" : ""}`}
        onClick={handleBodyClick}
      >
        {!activeTicker && (
          <div className="flex-1 flex items-center justify-center p-3">
            <p className="text-xs text-muted-foreground text-center">Click any ticker — Watchlist, Best Opps, My Trades — to chart it here.</p>
          </div>
        )}

        {activeTicker && isLoading && (
          <div className="flex-1 flex items-center justify-center p-3">
            <p className="text-xs text-muted-foreground">Loading {activeTicker}…</p>
          </div>
        )}

        {activeTicker && error && (
          <div className="flex-1 flex items-center justify-center p-3">
            <p className="text-xs text-red-500">Failed to load {activeTicker}.</p>
          </div>
        )}

        {activeTicker && !isLoading && !error && (
          <>
            {/* Chart pane */}
            <div className="flex-1 min-h-0 px-1">
              {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                      tickLine={false}
                      axisLine={false}
                      minTickGap={32}
                    />
                    <YAxis
                      domain={["auto", "auto"]}
                      tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                      tickLine={false}
                      axisLine={false}
                      width={32}
                    />
                    <Tooltip
                      contentStyle={{ fontSize: 11, backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                      labelStyle={{ color: "hsl(var(--foreground))" }}
                    />
                    <Line type="monotone" dataKey="close" stroke="#60a5fa" strokeWidth={1.5} dot={false} name="Close" />
                    <Line type="monotone" dataKey="ema21" stroke="#fbbf24" strokeWidth={1} dot={false} name="EMA21" />
                    <Line type="monotone" dataKey="ema50" stroke="#a78bfa" strokeWidth={1} dot={false} name="EMA50" />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center">
                  <p className="text-xs text-muted-foreground">No chart data</p>
                </div>
              )}
            </div>

            {/* Signal pane */}
            <div className="border-t border-border px-2 py-1.5">
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${verdictStyle.bg} ${verdictStyle.text}`}>
                  {verdictStyle.label}
                </span>
                <span className="text-xs text-muted-foreground">
                  Gates <span className="font-bold text-foreground tabular-nums">{scan?.score ?? "—"}/3</span>
                </span>
                <span className="text-[9px] text-muted-foreground ml-auto">click for full analysis →</span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
