/**
 * Confluence Dashboard panel — a row-per-signal table with bull/bear/neutral
 * badges and a bias-percentage summary at the bottom. Modeled on the
 * TradingView "Advanced Confluence Dashboard" reference visualized in the
 * approved plan.
 *
 * Computes its rows client-side from already-loaded data (the latest values
 * in the bars array + the indicators series + the gate verdict). No new
 * server endpoint for v1 — verifies the visual pattern works before we
 * commit to extending the API.
 */
import { useMemo } from "react";
import type { CandleBar, IndicatorBar, QuickScan } from "./useConfluenceChart";
import { Check, X, Minus } from "lucide-react";

interface ConfluenceDashboardPanelProps {
  bars: CandleBar[];
  indicators: IndicatorBar[];
  quick: QuickScan | undefined;
}

type Direction = "bull" | "bear" | "neutral";

interface ConfluenceRow {
  label: string;
  value: string;
  direction: Direction;
  detail?: string;
}

function emaStackDirection(bar: CandleBar): Direction {
  if (bar.ema21 == null || bar.ema50 == null) return "neutral";
  if (bar.close > bar.ema21 && bar.ema21 > bar.ema50) return "bull";
  if (bar.close < bar.ema21 && bar.ema21 < bar.ema50) return "bear";
  return "neutral";
}

function rsiDirection(rsi: number | null): Direction {
  if (rsi == null) return "neutral";
  if (rsi >= 60) return "bull";
  if (rsi <= 40) return "bear";
  return "neutral";
}

function macdDirection(hist: number): Direction {
  if (hist > 0) return "bull";
  if (hist < 0) return "bear";
  return "neutral";
}

function priceVsSma200(bar: CandleBar): Direction {
  if (bar.sma200 == null) return "neutral";
  return bar.close > bar.sma200 ? "bull" : "bear";
}

function volumeVsAvg(bars: CandleBar[]): { ratio: number; direction: Direction } {
  if (bars.length < 21) return { ratio: 0, direction: "neutral" };
  const last = bars[bars.length - 1];
  if (last.volume == null) return { ratio: 0, direction: "neutral" };
  const window = bars.slice(-21, -1);
  const avg = window.reduce((s, b) => s + (b.volume ?? 0), 0) / window.length;
  if (avg === 0) return { ratio: 0, direction: "neutral" };
  const ratio = last.volume / avg;
  const direction: Direction = ratio >= 1.5 ? "bull" : ratio <= 0.7 ? "bear" : "neutral";
  return { ratio, direction };
}

function highBreakout(bars: CandleBar[], window: number): Direction {
  if (bars.length < window) return "neutral";
  const last = bars[bars.length - 1];
  const recent = bars.slice(-window);
  const max = Math.max(...recent.slice(0, -1).map((b) => b.high));
  const min = Math.min(...recent.slice(0, -1).map((b) => b.low));
  if (last.close > max) return "bull";
  if (last.close < min) return "bear";
  return "neutral";
}

function gateDirection(verdict: string | null | undefined): Direction {
  if (!verdict) return "neutral";
  const v = verdict.toUpperCase();
  if (v.includes("↑") || v.endsWith("UP") || v.startsWith("BULL")) return "bull";
  if (v.includes("↓") || v.endsWith("DOWN") || v.startsWith("BEAR")) return "bear";
  return "neutral";
}

function dirBadgeStyle(dir: Direction): { bg: string; text: string; icon: typeof Check; label: string } {
  switch (dir) {
    case "bull":
      return { bg: "bg-bull/15", text: "text-bull-light", icon: Check, label: "BULL" };
    case "bear":
      return { bg: "bg-bear/15", text: "text-bear-light", icon: X, label: "BEAR" };
    case "neutral":
      return { bg: "bg-muted/40", text: "text-muted-foreground", icon: Minus, label: "—" };
  }
}

export function ConfluenceDashboardPanel({ bars, indicators, quick }: ConfluenceDashboardPanelProps) {
  const rows: ConfluenceRow[] = useMemo(() => {
    if (bars.length === 0) return [];
    const last = bars[bars.length - 1];
    const lastInd = indicators[indicators.length - 1];

    const { ratio: volRatio, direction: volDir } = volumeVsAvg(bars);

    return [
      {
        label: "RSI(14)",
        value: lastInd?.rsi != null ? lastInd.rsi.toFixed(1) : "—",
        direction: rsiDirection(lastInd?.rsi ?? null),
      },
      {
        label: "MACD Hist",
        value: lastInd?.hist != null ? lastInd.hist.toFixed(3) : "—",
        direction: lastInd ? macdDirection(lastInd.hist) : "neutral",
      },
      {
        label: "EMA Stack",
        value:
          last.ema21 != null && last.ema50 != null
            ? `${last.close.toFixed(2)} / ${last.ema21.toFixed(2)} / ${last.ema50.toFixed(2)}`
            : "—",
        direction: emaStackDirection(last),
      },
      {
        label: "Price vs 200d",
        value: last.sma200 != null ? `${((last.close / last.sma200 - 1) * 100).toFixed(1)}%` : "—",
        direction: priceVsSma200(last),
      },
      {
        label: "Vol vs 20d",
        value: volRatio > 0 ? `${volRatio.toFixed(2)}x` : "—",
        direction: volDir,
      },
      {
        label: "20-day Break",
        value: bars.length >= 21 ? "checked" : "—",
        direction: highBreakout(bars, 21),
      },
      {
        label: "60-day Break",
        value: bars.length >= 61 ? "checked" : "—",
        direction: highBreakout(bars, 61),
      },
      {
        label: "Gate Verdict",
        value: quick?.verdict ?? "—",
        direction: gateDirection(quick?.verdict),
      },
      {
        label: "Gate Score",
        value: quick?.score != null ? `${quick.score}/3` : "—",
        direction:
          quick?.score == null
            ? "neutral"
            : quick.score >= 2
            ? "bull"
            : quick.score === 0
            ? "bear"
            : "neutral",
      },
    ];
  }, [bars, indicators, quick]);

  // Bias summary — counts of bull/bear with percentage.
  const summary = useMemo(() => {
    const bull = rows.filter((r) => r.direction === "bull").length;
    const bear = rows.filter((r) => r.direction === "bear").length;
    const total = rows.length;
    if (total === 0) return null;
    const net = bull - bear;
    const pct = Math.round((Math.abs(net) / total) * 100);
    const bias = net > 0 ? "LONG" : net < 0 ? "SHORT" : "NEUTRAL";
    return { bull, bear, total, pct, bias };
  }, [rows]);

  if (rows.length === 0) {
    return (
      <div className="px-4 py-3 text-xs text-muted-foreground">
        No confluence data yet.
      </div>
    );
  }

  return (
    <div className="border-t border-border" data-testid="confluence-dashboard-panel">
      <div className="px-4 py-2 flex items-center justify-between">
        <h3 className="text-micro font-bold tracking-widest text-muted-foreground uppercase">
          Confluence Dashboard
        </h3>
        {summary && (
          <div className="flex items-baseline gap-2">
            <span className="text-xs text-muted-foreground tabular-nums">
              {summary.bull} bull · {summary.bear} bear · {summary.total} total
            </span>
            <span
              className={`text-sm font-bold tabular-nums px-2 py-0.5 rounded ${
                summary.bias === "LONG"
                  ? "bg-bull/15 text-bull-light"
                  : summary.bias === "SHORT"
                  ? "bg-bear/15 text-bear-light"
                  : "bg-muted/40 text-muted-foreground"
              }`}
              data-testid="confluence-bias"
            >
              {summary.bias} BIAS {summary.pct}%
            </span>
          </div>
        )}
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-3 lg:grid-cols-3 gap-x-4 gap-y-1 px-4 pb-3">
        {rows.map((r) => {
          const style = dirBadgeStyle(r.direction);
          const Icon = style.icon;
          return (
            <div
              key={r.label}
              className="flex items-center justify-between gap-2 py-1 border-b border-border/50 last:border-b-0"
              data-testid={`confluence-row-${r.label.replace(/\W+/g, "-").toLowerCase()}`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-2xs text-muted-foreground truncate">{r.label}</span>
                <span className="text-xs font-mono tabular-nums text-foreground truncate">{r.value}</span>
              </div>
              <span className={`flex items-center gap-0.5 text-micro font-bold rounded px-1.5 py-0.5 ${style.bg} ${style.text}`}>
                <Icon className="h-3 w-3" />
                {style.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
