import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { TrendingUp, TrendingDown, Minus, ArrowUpRight, ArrowDownRight, HelpCircle, X } from "lucide-react";
import { useState } from "react";

interface PulseDay {
  t: number;
  date: string;
  close: number;
  composite: number;
  bullishCount: number;
  bearishCount: number;
  perSignal: Array<{
    id: string;
    label: string;
    triggered: boolean;
    direction: "up" | "down" | "either";
    strength: number;
  }>;
}

interface PulseData {
  ticker: string;
  days: PulseDay[];
  catalysts: Array<{ id: string; label: string; triggered: boolean | null; note?: string }>;
  summary: {
    lastComposite: number;
    avgComposite10d: number;
    trend: "up" | "down" | "flat";
    zeroCross: "bullish" | "bearish" | null;
  };
  reason?: string;
}

/**
 * SignalPulse — Stock Otter's proprietary oscillator built from the 12 Scanner 2.0 signals.
 *
 * Unlike MACD/RSI which plot price derivatives, SignalPulse plots the net count of
 * bullish vs bearish signals firing each day. Direction is unmistakable:
 *   - Green blocks above zero line = bullish signals stacking
 *   - Red blocks below zero line = bearish signals stacking
 *   - Per-signal stack (below) shows WHICH of the 12 signals fired each day
 */
export function SignalPulse({ ticker }: { ticker: string | null }) {
  const [showHelp, setShowHelp] = useState(false);

  const { data, isLoading } = useQuery<PulseData>({
    queryKey: ["/api/scanner-v2/pulse", ticker],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/scanner-v2/pulse/${ticker}`);
      return res.json();
    },
    enabled: !!ticker,
    staleTime: 10 * 60 * 1000,
  });

  if (!ticker) {
    return (
      <div className="bg-card border border-card-border rounded-xl p-6 text-center text-sm text-muted-foreground">
        Click any scanner result below to see its Signal Pulse oscillator.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="bg-card border border-card-border rounded-xl p-6 text-center text-sm text-muted-foreground">
        Loading Signal Pulse for {ticker}…
      </div>
    );
  }

  const days = data?.days || [];
  if (!days.length) {
    return (
      <div className="bg-card border border-card-border rounded-xl p-6 text-center text-sm text-muted-foreground">
        Not enough history to compute Signal Pulse for {ticker}.
      </div>
    );
  }

  const W = 900;
  const PAD_X = 12;
  const plotW = W - PAD_X * 2;
  const barW = plotW / days.length;

  // Composite pane
  const COMP_H = 100;
  const maxAbs = Math.max(6, ...days.map(d => Math.abs(d.composite)));
  const compY = (v: number) => COMP_H / 2 - (v / maxAbs) * (COMP_H / 2 - 4);

  // Direction indicator
  const { summary } = data!;
  const trendArrow =
    summary.trend === "up" ? <ArrowUpRight className="h-7 w-7 text-green-400" strokeWidth={3} /> :
    summary.trend === "down" ? <ArrowDownRight className="h-7 w-7 text-red-400" strokeWidth={3} /> :
    <Minus className="h-7 w-7 text-muted-foreground" strokeWidth={3} />;

  const trendLabel =
    summary.trend === "up" ? "HEATING UP" :
    summary.trend === "down" ? "COOLING DOWN" :
    "FLAT";

  const trendColor =
    summary.trend === "up" ? "text-green-400" :
    summary.trend === "down" ? "text-red-400" :
    "text-muted-foreground";

  // Per-signal stack (12 rows)
  const SIGNAL_ROWS = 6; // technical only
  const ROW_H = 14;

  return (
    <div className="bg-card border border-card-border rounded-xl p-4">
      {/* Header */}
      <div className="flex items-center gap-3 mb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold text-foreground">{data!.ticker}</span>
            <span className="text-xs text-muted-foreground">· Signal Pulse</span>
          </div>
          <div className="text-[10px] text-muted-foreground">
            60-day composite of 12 Scanner 2.0 signals
          </div>
        </div>

        <div className="ml-auto flex items-center gap-3">
          {/* Big direction readout */}
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-background border border-card-border">
            {trendArrow}
            <div>
              <div className={`text-xs font-bold uppercase tracking-wider ${trendColor}`}>{trendLabel}</div>
              <div className="text-[10px] text-muted-foreground tabular-nums">
                Today {summary.lastComposite > 0 ? "+" : ""}{summary.lastComposite.toFixed(1)} ·
                10d avg {summary.avgComposite10d > 0 ? "+" : ""}{summary.avgComposite10d.toFixed(1)}
              </div>
            </div>
          </div>

          {summary.zeroCross && (
            <div className={`px-2 py-1 rounded text-[10px] font-bold uppercase ${
              summary.zeroCross === "bullish"
                ? "bg-green-500/20 text-green-300 border border-green-500/40"
                : "bg-red-500/20 text-red-300 border border-red-500/40"
            }`}>
              {summary.zeroCross === "bullish" ? "↑ Bullish cross (5d)" : "↓ Bearish cross (5d)"}
            </div>
          )}

          <button
            onClick={() => setShowHelp(!showHelp)}
            className="p-1.5 rounded hover:bg-background text-muted-foreground hover:text-foreground"
            title="How this works"
          >
            <HelpCircle className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* How it works */}
      {showHelp && (
        <div className="mb-3 p-3 bg-background rounded-lg border border-card-border text-xs space-y-2">
          <div className="flex items-start justify-between">
            <b className="text-foreground">How Signal Pulse works</b>
            <button onClick={() => setShowHelp(false)} className="text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="text-muted-foreground">
            Each day we evaluate 12 proprietary Scanner 2.0 signals on this ticker (BB squeeze, ATR expansion,
            relative volume, 52w breakout, gap hold, fib pullback, plus 6 catalyst signals). Each fire counts
            as <span className="text-green-400">+1 bullish</span> or <span className="text-red-400">−1 bearish</span>
            depending on its direction.
          </p>
          <p className="text-muted-foreground">
            The <b className="text-foreground">Composite</b> is simply bullish minus bearish. Above the zero line =
            momentum to the upside. Below = downside pressure. A <b>zero cross</b> (line moving through 0) is the
            key inflection — bullish cross = signals just flipped positive, often an early entry cue.
          </p>
          <p className="text-muted-foreground">
            The <b className="text-foreground">Signal Stack</b> below shows exactly which of the 6 technical signals
            fired each day. Green dot = bullish direction, red dot = bearish. Look for stacking (multiple greens in
            a column) as a conviction cue.
          </p>
          <p className="text-muted-foreground text-[10px] italic">
            Catalyst signals (earnings, insider, options, analyst, gamma, small-float) only evaluate on today's
            live data — they aren't replayable historically.
          </p>
        </div>
      )}

      {/* Composite oscillator */}
      <svg viewBox={`0 0 ${W} ${COMP_H}`} className="w-full" preserveAspectRatio="none" style={{ height: `${COMP_H}px` }}>
        {/* zero line */}
        <line x1={PAD_X} x2={W - PAD_X} y1={COMP_H / 2} y2={COMP_H / 2}
              stroke="rgb(113,113,122)" strokeWidth="1" />
        {/* +/- rails */}
        <line x1={PAD_X} x2={W - PAD_X} y1={compY(3)} y2={compY(3)}
              stroke="rgb(34,197,94)" strokeWidth="0.5" strokeDasharray="3,3" opacity={0.4} />
        <line x1={PAD_X} x2={W - PAD_X} y1={compY(-3)} y2={compY(-3)}
              stroke="rgb(239,68,68)" strokeWidth="0.5" strokeDasharray="3,3" opacity={0.4} />

        {/* Composite bars */}
        {days.map((d, i) => {
          const x = PAD_X + i * barW;
          const y0 = COMP_H / 2;
          const y1 = compY(d.composite);
          const top = Math.min(y0, y1);
          const h = Math.max(0.5, Math.abs(y1 - y0));
          const color = d.composite > 0 ? "rgb(34,197,94)" : d.composite < 0 ? "rgb(239,68,68)" : "rgb(113,113,122)";
          return (
            <rect key={i} x={x + 0.5} y={top} width={Math.max(0.5, barW - 1)} height={h} fill={color} opacity={0.85} />
          );
        })}

        {/* Rail labels */}
        <text x={PAD_X + 2} y={compY(3) - 2} fontSize="8" fill="rgb(34,197,94)" opacity={0.7}>+3 strong bull</text>
        <text x={PAD_X + 2} y={compY(-3) + 9} fontSize="8" fill="rgb(239,68,68)" opacity={0.7}>−3 strong bear</text>
        <text x={PAD_X + 2} y={COMP_H / 2 - 2} fontSize="8" fill="rgb(161,161,170)" opacity={0.6}>0 neutral</text>
      </svg>

      {/* Per-signal stack */}
      <div className="mt-3">
        <div className="text-[10px] text-muted-foreground uppercase font-semibold mb-1">Signal Stack (technical)</div>
        <div className="relative" style={{ height: `${SIGNAL_ROWS * ROW_H + 12}px` }}>
          {/* signal labels */}
          {days[days.length - 1].perSignal.slice(0, SIGNAL_ROWS).map((sig, rowIdx) => (
            <div
              key={sig.id}
              className="absolute left-0 text-[9px] text-muted-foreground font-medium whitespace-nowrap"
              style={{ top: `${rowIdx * ROW_H + 3}px`, width: "88px" }}
            >
              {sig.label}
            </div>
          ))}

          {/* dots grid */}
          <svg
            viewBox={`0 0 ${W} ${SIGNAL_ROWS * ROW_H}`}
            className="absolute"
            preserveAspectRatio="none"
            style={{ left: "90px", top: 0, width: `calc(100% - 90px)`, height: `${SIGNAL_ROWS * ROW_H}px` }}
          >
            {days.map((d, i) => {
              const x = (i / days.length) * W + (W / days.length) / 2;
              return d.perSignal.slice(0, SIGNAL_ROWS).map((sig, rowIdx) => {
                if (!sig.triggered) return null;
                const y = rowIdx * ROW_H + ROW_H / 2;
                const color =
                  sig.direction === "up" ? "rgb(34,197,94)" :
                  sig.direction === "down" ? "rgb(239,68,68)" :
                  "rgb(251,191,36)";
                const r = 2 + sig.strength * 3; // strength affects size
                return <circle key={`${i}-${sig.id}`} cx={x} cy={y} r={r} fill={color} opacity={0.85} />;
              });
            })}
          </svg>
        </div>
      </div>

      {/* Catalyst row (live only) */}
      {data!.catalysts?.length ? (
        <div className="mt-3 pt-3 border-t border-card-border/50">
          <div className="text-[10px] text-muted-foreground uppercase font-semibold mb-1">
            Catalyst signals <span className="font-normal normal-case">(live only — not replayable)</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {data!.catalysts.map(c => (
              <span
                key={c.id}
                className="text-[10px] px-2 py-0.5 rounded bg-zinc-700/40 text-zinc-400 border border-zinc-600/30"
                title={c.note}
              >
                {c.label}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {/* Footer legend */}
      <div className="mt-3 pt-3 border-t border-card-border/50 flex items-center gap-4 text-[10px] text-muted-foreground flex-wrap">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 bg-green-500 rounded-sm" />
          Bullish firing
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 bg-red-500 rounded-sm" />
          Bearish firing
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 bg-green-500 rounded-full" />
          <span className="inline-block w-3.5 h-3.5 bg-green-500 rounded-full" />
          Dot size = signal strength
        </span>
      </div>
    </div>
  );
}
