import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useTicker } from "@/contexts/TickerContext";
import { Compass, Loader2, Target } from "lucide-react";
import {
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, ResponsiveContainer, Tooltip,
} from "recharts";
import {
  SIGNAL_BULL,
  SIGNAL_BEAR,
  SIGNAL_WATCH,
  CHART_AXIS_LINE,
  CHART_TEXT,
  OVERLAY_BULL_30,
  OVERLAY_SLATE_20,
} from "@/lib/design-tokens";

interface ConfluenceSpoke {
  axis: string;
  value: number | null;
  rawScore: number | null;
  href: string;
}

interface ConfluencePulse {
  ticker: string;
  spotPrice: number | null;
  takenAt: string | null;
  verdict: string | null;
  confidence: string | null;
  confluence: number | null;
  alignment: number | null;
  spokes: ConfluenceSpoke[];
  axesAvailable: number;
  generatedAt: string;
}

function verdictTone(v: string | null): string {
  if (!v) return "text-muted-foreground";
  if (v.includes("BULLISH")) return "text-bull-light";
  if (v.includes("BEARISH")) return "text-bear-light";
  if (v.includes("DIVERGENT")) return "text-watch-light";
  return "text-foreground";
}

function confluenceTone(n: number | null): string {
  if (n == null) return "text-muted-foreground";
  if (n > 30) return "text-bull-light";
  if (n < -30) return "text-bear-light";
  return "text-watch-light";
}

export function ConfluencePulseWidget() {
  const { activeTicker } = useTicker();
  const [, navigate] = useLocation();
  const ticker = activeTicker || "SPY";

  const { data, isLoading, error } = useQuery<ConfluencePulse>({
    queryKey: ["/api/dashboard/confluence-pulse", ticker],
    queryFn: async () => (await apiRequest("GET", `/api/dashboard/confluence-pulse/${ticker}`)).json(),
    enabled: !!ticker,
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Computing confluence for {ticker}…
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-bear-light px-4 text-center">
        Confluence unavailable for {ticker}.
      </div>
    );
  }

  const radarData = data.spokes.map(s => ({
    axis: s.axis,
    value: s.value ?? 0,
    href: s.href,
    rawScore: s.rawScore,
    available: s.value != null,
  }));

  const noData = data.axesAvailable === 0 || data.spokes.every(s => s.value == null);

  return (
    <div className="h-full flex flex-col" data-testid="confluence-pulse">
      <div className="flex items-center justify-between px-3 py-2 border-b border-card-border">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider font-semibold text-muted-foreground">
          <Compass className="h-3.5 w-3.5" />
          Confluence Pulse
        </div>
        <div className="flex items-center gap-2 text-micro">
          <span className="font-bold text-foreground tabular-nums">{data.ticker}</span>
          {data.spotPrice != null && (
            <span className="text-muted-foreground tabular-nums">${data.spotPrice.toFixed(2)}</span>
          )}
        </div>
      </div>

      {noData ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-4 py-6">
          <Target className="h-8 w-8 text-muted-foreground/40" />
          <div className="text-sm font-semibold text-foreground">No compass snapshot for {data.ticker}</div>
          <div className="text-xs text-muted-foreground max-w-xs">
            The nightly compass cron only tracks ~100 megacaps today. Add {data.ticker} to the tracked universe to see this widget light up.
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col">
          {/* Verdict strip */}
          <div className="flex items-center justify-between px-3 py-1.5 bg-muted/20 border-b border-card-border">
            <div className="text-xs">
              <span className="text-muted-foreground">Verdict:</span>{" "}
              <span className={`font-semibold ${verdictTone(data.verdict)}`}>{data.verdict ?? "—"}</span>
              {data.confidence && (
                <span className="text-muted-foreground ml-1">· {data.confidence}</span>
              )}
            </div>
            <div className="text-xs tabular-nums">
              <span className="text-muted-foreground">Confluence:</span>{" "}
              <span className={`font-semibold ${confluenceTone(data.confluence)}`}>
                {data.confluence != null ? (data.confluence > 0 ? "+" : "") + data.confluence : "—"}
              </span>
            </div>
          </div>

          {/* Radar */}
          <div className="flex-1 min-h-0 px-2 py-2">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData} margin={{ top: 8, right: 16, bottom: 8, left: 16 }}>
                <PolarGrid stroke={CHART_AXIS_LINE} />
                <PolarAngleAxis dataKey="axis" tick={{ fill: CHART_TEXT, fontSize: 10 }} />
                <PolarRadiusAxis angle={90} domain={[0, 100]} tick={false} stroke={CHART_AXIS_LINE} />
                <Radar
                  name={data.ticker}
                  dataKey="value"
                  stroke={SIGNAL_BULL}
                  fill={OVERLAY_BULL_30}
                  fillOpacity={0.5}
                  strokeWidth={1.5}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "rgb(var(--brand-bg-card))",
                    border: "1px solid rgb(var(--brand-border))",
                    borderRadius: 6,
                    fontSize: 11,
                  }}
                  itemStyle={{ color: "rgb(var(--brand-text-bright))" }}
                  labelStyle={{ color: "rgb(var(--brand-text-muted))" }}
                  formatter={(v: number) => [`${Math.round(v)}/100`, "Score"]}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>

          {/* Spoke legend — clickable to drill into the source page */}
          <div className="px-3 py-2 border-t border-card-border grid grid-cols-2 gap-x-3 gap-y-1">
            {data.spokes.map(s => (
              <button
                key={s.axis}
                onClick={() => navigate(s.href)}
                className="text-left text-micro flex items-center justify-between gap-2 hover:bg-muted/30 rounded px-1 py-0.5 transition-colors"
                data-testid={`pulse-spoke-${s.axis}`}
              >
                <span className="text-muted-foreground truncate">{s.axis}</span>
                <span className={`tabular-nums font-semibold shrink-0 ${s.value == null ? "text-muted-foreground/50" : "text-foreground"}`}>
                  {s.value == null ? "—" : s.value}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
