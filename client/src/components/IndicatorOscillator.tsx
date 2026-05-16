import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useTimeframe } from "@/contexts/TimeframeContext";
import {
  SIGNAL_BULL,
  SIGNAL_BEAR,
  CHART_RSI,
  SIGNAL_WATCH_SHORT,
  SIGNAL_SHORT_ADD,
} from "@/lib/design-tokens";

const GRID_NEUTRAL = "rgb(82,82,91)";

interface Bar {
  t: number;
  close: number;
  macd: number;
  signal: number;
  hist: number;
  rsi: number | null;
}

/**
 * Compact MACD + RSI oscillator chart for scanner cards.
 * Top pane: MACD histogram (bars) with MACD line + signal line overlay.
 * Bottom pane: RSI(14) line with 30/70 guide rails.
 */
export function IndicatorOscillator({ ticker, bars = 60 }: { ticker: string; bars?: number }) {
  const { timeframe } = useTimeframe();
  const { data, isLoading } = useQuery<{ ticker: string; series: Bar[]; reason?: string }>({
    queryKey: ["/api/scanner-v2/indicators", ticker, bars, timeframe],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/scanner-v2/indicators/${ticker}?bars=${bars}&timeframe=${timeframe}`);
      return res.json();
    },
    staleTime: 10 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="h-24 flex items-center justify-center text-micro text-muted-foreground">
        Loading indicators…
      </div>
    );
  }
  const series = data?.series || [];
  if (!series.length) {
    return (
      <div className="h-24 flex items-center justify-center text-micro text-muted-foreground">
        No indicator data
      </div>
    );
  }

  const W = 320;
  const MACD_H = 50;
  const RSI_H = 40;
  const PAD_X = 4;
  const plotW = W - PAD_X * 2;

  // MACD scaling
  const hists = series.map(s => s.hist);
  const macds = series.map(s => s.macd);
  const sigs = series.map(s => s.signal);
  const macdMax = Math.max(...hists.map(Math.abs), ...macds.map(Math.abs), ...sigs.map(Math.abs), 0.01);
  const macdY = (v: number) => (MACD_H / 2) - (v / macdMax) * (MACD_H / 2 - 2);

  // RSI scaling (0-100)
  const rsiY = (v: number) => RSI_H - (v / 100) * RSI_H;

  const barW = plotW / series.length;

  // Build polylines
  const macdLinePts = series.map((s, i) => `${PAD_X + i * barW + barW / 2},${macdY(s.macd)}`).join(" ");
  const sigLinePts = series.map((s, i) => `${PAD_X + i * barW + barW / 2},${macdY(s.signal)}`).join(" ");
  const rsiLinePts = series
    .map((s, i) => (s.rsi == null ? null : `${PAD_X + i * barW + barW / 2},${rsiY(s.rsi)}`))
    .filter(Boolean)
    .join(" ");

  const last = series[series.length - 1];

  return (
    <div className="w-full">
      <div className="flex items-center justify-between text-micro text-muted-foreground mb-1">
        <span>MACD(12,26,9) · RSI(14) · {series.length}d</span>
        <span className="tabular-nums">
          <span className={last.hist >= 0 ? "text-green-400" : "text-red-400"}>
            H {last.hist.toFixed(3)}
          </span>
          {" · "}
          <span
            className={
              last.rsi == null
                ? ""
                : last.rsi >= 70
                ? "text-red-400"
                : last.rsi <= 30
                ? "text-green-400"
                : "text-foreground"
            }
          >
            RSI {last.rsi?.toFixed(0) ?? "—"}
          </span>
        </span>
      </div>

      {/* MACD pane */}
      <svg viewBox={`0 0 ${W} ${MACD_H}`} className="w-full" preserveAspectRatio="none" style={{ height: `${MACD_H}px` }}>
        {/* zero line */}
        <line x1={PAD_X} x2={W - PAD_X} y1={MACD_H / 2} y2={MACD_H / 2} stroke={GRID_NEUTRAL} strokeWidth="0.5" strokeDasharray="2,2" />
        {/* histogram bars */}
        {series.map((s, i) => {
          const y0 = MACD_H / 2;
          const y1 = macdY(s.hist);
          const top = Math.min(y0, y1);
          const h = Math.abs(y1 - y0);
          const color = s.hist >= 0 ? SIGNAL_BULL : SIGNAL_BEAR;
          return (
            <rect
              key={i}
              x={PAD_X + i * barW + 0.5}
              y={top}
              width={Math.max(0.5, barW - 1)}
              height={Math.max(0.5, h)}
              fill={color}
              opacity={0.65}
            />
          );
        })}
        {/* MACD line */}
        <polyline points={macdLinePts} fill="none" stroke={CHART_RSI} strokeWidth="1" />
        {/* Signal line */}
        <polyline points={sigLinePts} fill="none" stroke={SIGNAL_WATCH_SHORT} strokeWidth="1" />
      </svg>

      {/* RSI pane */}
      <svg viewBox={`0 0 ${W} ${RSI_H}`} className="w-full mt-1" preserveAspectRatio="none" style={{ height: `${RSI_H}px` }}>
        {/* overbought/oversold bands */}
        <line x1={PAD_X} x2={W - PAD_X} y1={rsiY(70)} y2={rsiY(70)} stroke={SIGNAL_BEAR} strokeWidth="0.5" strokeDasharray="2,2" opacity={0.6} />
        <line x1={PAD_X} x2={W - PAD_X} y1={rsiY(50)} y2={rsiY(50)} stroke={GRID_NEUTRAL} strokeWidth="0.5" strokeDasharray="2,2" />
        <line x1={PAD_X} x2={W - PAD_X} y1={rsiY(30)} y2={rsiY(30)} stroke={SIGNAL_BULL} strokeWidth="0.5" strokeDasharray="2,2" opacity={0.6} />
        <polyline points={rsiLinePts} fill="none" stroke={SIGNAL_SHORT_ADD} strokeWidth="1.2" />
      </svg>

      {/* Legend */}
      <div className="flex items-center gap-3 text-mini text-muted-foreground mt-1">
        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 bg-blue-500 rounded-sm" />MACD</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 bg-orange-500 rounded-sm" />Signal</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 bg-fuchsia-500 rounded-sm" />RSI</span>
      </div>
    </div>
  );
}
