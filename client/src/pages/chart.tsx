/**
 * Strategy Chart — visual backtester comparing BBTC+VER, AMC, and three TFT
 * modes on the active ticker. Toggle strategies via dropdown and see:
 *   - Price chart with regime bands (TFT) and entry/exit dots
 *   - Summary stats: total $ P/L, win rate, R-multiple, captured B&H
 *   - Scrollable trade list — click a trade to highlight its dots
 *
 * Data: GET /api/chart/:ticker?strategy=X&days=Y
 *
 * Page is the new "Strategy Chart" route at /chart. Active ticker comes from
 * TickerContext (matches the rest of the site). Existing /trade page is
 * untouched — this is purely additive.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useTicker } from "@/contexts/TickerContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/PageHeader";
import { Disclaimer } from "@/components/Disclaimer";
import { LineChart as LineChartIcon, TrendingUp, TrendingDown, Target } from "lucide-react";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceArea,
  ReferenceDot,
} from "recharts";

// ─── Types matching server/diag/chart-data.ts response ────────────────────

type ChartStrategy = "bbtc-ver" | "amc" | "tft-40w" | "tft-60w" | "tft-catastrophic";

interface ChartBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
interface ChartSignalDot {
  date: string;
  price: number;
  type: string;
  side: "LONG" | "SHORT";
  layer?: "CORE" | "TACTICAL";
  label: string;
  color: string;
  filled: boolean;
}
interface RegimeBand {
  startDate: string;
  endDate: string;
  regime: "BULLISH" | "BEARISH" | "NEUTRAL";
}
interface ChartTrade {
  layer: "CORE" | "TACTICAL" | "PAIR";
  side: "LONG" | "SHORT";
  entryDate: string;
  entryPrice: number;
  exitDate: string | null;
  exitPrice: number | null;
  exitReason: string | null;
  isOpen: boolean;
  holdBars: number;
  returnPct: number | null;
  pnlDollar: number | null;
  source: string;
}
interface ChartSummary {
  tradeCount: number;
  closedTradeCount: number;
  openTradeCount: number;
  wins: number;
  losses: number;
  winRate: number | null;
  totalPnLDollar: number;
  unrealizedPnLDollar: number;
  totalPnLIncludingUnrealized: number;
  rMultiple: number | null;
  avgWinPct: number | null;
  avgLossPct: number | null;
  avgWinDollar: number | null;
  avgLossDollar: number | null;
  bestTradePct: number | null;
  worstTradePct: number | null;
  avgHoldBars: number | null;
  maxDrawdownPct: number;
  buyAndHoldDollar: number;
  buyAndHoldReturnPct: number;
  capturedBnHPct: number | null;
  marketExposurePct: number | null;
}
interface ChartDataResponse {
  ticker: string;
  strategy: ChartStrategy;
  rangeFrom: string;
  rangeTo: string;
  positionSize: number;
  bars: ChartBar[];
  signals: ChartSignalDot[];
  regimeBands: RegimeBand[];
  trades: ChartTrade[];
  summary: ChartSummary;
  notes: string[];
}

// ─── Strategy + timeframe option metadata ─────────────────────────────────

const STRATEGY_OPTIONS: { value: ChartStrategy; label: string; description: string; badge?: string }[] = [
  { value: "bbtc-ver", label: "BBTC + VER", description: "Current website Ready/Set/Go strategy" },
  { value: "amc", label: "AMC only", description: "Adaptive Momentum Confluence (the 'Set' indicator alone)" },
  { value: "tft-40w", label: "TFT 40W", description: "Two-Layer Trend Continuation, weekly 40W SMA stop" },
  { value: "tft-60w", label: "TFT 60W", description: "TFT with slower 60W stop" },
  { value: "tft-catastrophic", label: "TFT Catastrophic", description: "TFT, core only exits on -15% catastrophic. Maximum moonshot capture", badge: "$5.28M basket" },
];

const TIMEFRAME_OPTIONS: { value: number; label: string }[] = [
  { value: 365, label: "1Y" },
  { value: 1095, label: "3Y" },
  { value: 1825, label: "5Y" },
  { value: 3650, label: "10Y" },
];

// ─── Formatting helpers ────────────────────────────────────────────────────

function fmtMoney(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}
function fmtPct(n: number | null, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}
function fmtDate(d: string | null): string {
  if (!d) return "—";
  return d;
}

// ─── Chart subcomponent ────────────────────────────────────────────────────

function StrategyChart({ data, highlightedTradeIdx }: {
  data: ChartDataResponse;
  highlightedTradeIdx: number | null;
}) {
  // Build a date-indexed lookup so ReferenceDot x-coordinates align with the
  // categorical X axis. Recharts categorical axes need exact-match strings.
  const chartData = useMemo(() => {
    return data.bars.map(b => ({ date: b.date, close: b.close }));
  }, [data.bars]);

  // Regime band fills. Bullish = subtle green tint, Bearish = subtle red,
  // Neutral = transparent (no band drawn). Drawn as ReferenceArea behind the line.
  const regimeAreas = useMemo(() => {
    return data.regimeBands
      .filter(b => b.regime !== "NEUTRAL")
      .map((b, i) => ({
        x1: b.startDate,
        x2: b.endDate,
        regime: b.regime,
        key: `regime-${i}`,
      }));
  }, [data.regimeBands]);

  // Highlighted trade — find its entry/exit dates so we can pulse those dots.
  const highlightedDates = useMemo(() => {
    if (highlightedTradeIdx == null) return new Set<string>();
    const t = data.trades[highlightedTradeIdx];
    if (!t) return new Set<string>();
    const set = new Set<string>([t.entryDate]);
    if (t.exitDate) set.add(t.exitDate);
    return set;
  }, [highlightedTradeIdx, data.trades]);

  return (
    <div className="w-full" style={{ height: 420 }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 30 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fill: "#94a3b8" }}
            interval="preserveStartEnd"
            minTickGap={50}
          />
          <YAxis
            tick={{ fontSize: 10, fill: "#94a3b8" }}
            domain={["auto", "auto"]}
            tickFormatter={v => `$${typeof v === "number" ? v.toFixed(0) : v}`}
          />
          <Tooltip
            contentStyle={{ backgroundColor: "#0f172a", border: "1px solid #1f2937", borderRadius: 6, fontSize: 12 }}
            labelStyle={{ color: "#e2e8f0" }}
            formatter={(value: any) => [`$${Number(value).toFixed(2)}`, "Close"]}
          />

          {/* Regime bands behind the price line */}
          {regimeAreas.map(area => (
            <ReferenceArea
              key={area.key}
              x1={area.x1}
              x2={area.x2}
              y1={undefined}
              y2={undefined}
              fill={area.regime === "BULLISH" ? "#10b981" : "#ef4444"}
              fillOpacity={0.06}
              ifOverflow="extendDomain"
            />
          ))}

          <Line
            type="monotone"
            dataKey="close"
            stroke="#3b82f6"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />

          {/* Signal dots — rendered as ReferenceDot so we can highlight on click */}
          {data.signals.map((s, i) => {
            const isHighlighted = highlightedDates.has(s.date);
            return (
              <ReferenceDot
                key={`sig-${i}`}
                x={s.date}
                y={s.price}
                r={isHighlighted ? 7 : 4}
                fill={s.filled ? s.color : "transparent"}
                stroke={s.color}
                strokeWidth={isHighlighted ? 2.5 : 1.5}
                isFront
                ifOverflow="extendDomain"
              />
            );
          })}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Summary stats grid ────────────────────────────────────────────────────

function SummaryStats({ summary }: { summary: ChartSummary }) {
  const totalColor = summary.totalPnLIncludingUnrealized >= 0 ? "text-green-400" : "text-red-400";
  const cells = [
    { label: "Total P/L", value: fmtMoney(summary.totalPnLIncludingUnrealized), color: totalColor, hint: `realized ${fmtMoney(summary.totalPnLDollar)} + unrealized ${fmtMoney(summary.unrealizedPnLDollar)}` },
    { label: "B&H Capture", value: fmtPct(summary.capturedBnHPct, 1), color: "text-foreground", hint: `B&H: ${fmtMoney(summary.buyAndHoldDollar)} (${fmtPct(summary.buyAndHoldReturnPct, 1)})` },
    { label: "Win Rate", value: summary.winRate != null ? `${(summary.winRate * 100).toFixed(0)}%` : "—", color: "text-foreground", hint: `${summary.wins}W / ${summary.losses}L` },
    { label: "R-Multiple", value: summary.rMultiple != null ? summary.rMultiple.toFixed(2) : "—", color: "text-foreground", hint: `avg win ${fmtPct(summary.avgWinPct, 1)} / avg loss ${fmtPct(summary.avgLossPct, 1)}` },
    { label: "Best / Worst", value: `${fmtPct(summary.bestTradePct, 1)} / ${fmtPct(summary.worstTradePct, 1)}`, color: "text-foreground", hint: `avg hold ${summary.avgHoldBars?.toFixed(0) ?? "—"} bars` },
    { label: "Max DD", value: fmtPct(summary.maxDrawdownPct, 1), color: "text-orange-400", hint: "worst peak-to-trough on per-trade equity" },
    { label: "Trades", value: `${summary.tradeCount}`, color: "text-foreground", hint: `${summary.closedTradeCount} closed, ${summary.openTradeCount} open` },
    summary.marketExposurePct != null
      ? { label: "Time in Market", value: fmtPct(summary.marketExposurePct, 1), color: "text-blue-400", hint: "fraction of bars with nonzero position (TFT)" }
      : { label: "Position Type", value: "Pair-traded", color: "text-blue-400", hint: "trade pairing — entries paired with exits per sub-strategy" },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {cells.map((c, i) => (
        <div key={i} className="bg-card border border-card-border rounded-lg p-3">
          <div className="text-xs text-muted-foreground">{c.label}</div>
          <div className={`text-lg font-bold tabular-nums ${c.color}`}>{c.value}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5 truncate" title={c.hint}>{c.hint}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Trade list ────────────────────────────────────────────────────────────

function TradeList({
  trades,
  highlightedIdx,
  onHighlight,
}: {
  trades: ChartTrade[];
  highlightedIdx: number | null;
  onHighlight: (idx: number | null) => void;
}) {
  if (trades.length === 0) {
    return <p className="text-sm text-muted-foreground p-4">No trades fired in this window.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-card z-10">
          <tr className="text-left text-muted-foreground border-b border-card-border">
            <th className="px-2 py-2 font-medium">#</th>
            <th className="px-2 py-2 font-medium">Layer</th>
            <th className="px-2 py-2 font-medium">Source</th>
            <th className="px-2 py-2 font-medium">Side</th>
            <th className="px-2 py-2 font-medium">Entry</th>
            <th className="px-2 py-2 font-medium">Exit</th>
            <th className="px-2 py-2 font-medium">Hold</th>
            <th className="px-2 py-2 font-medium text-right">Return</th>
            <th className="px-2 py-2 font-medium text-right">P/L $</th>
            <th className="px-2 py-2 font-medium">Reason</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t, i) => {
            const won = (t.returnPct ?? 0) > 0;
            const isHi = highlightedIdx === i;
            return (
              <tr
                key={i}
                onClick={() => onHighlight(isHi ? null : i)}
                className={`border-b border-card-border/60 cursor-pointer transition-colors ${
                  isHi ? "bg-blue-500/10" : "hover:bg-card-foreground/5"
                }`}
              >
                <td className="px-2 py-1.5 text-muted-foreground tabular-nums">{i + 1}</td>
                <td className="px-2 py-1.5">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                    t.layer === "CORE" ? "bg-sky-500/20 text-sky-300" :
                    t.layer === "TACTICAL" ? "bg-emerald-500/20 text-emerald-300" :
                    "bg-zinc-500/20 text-zinc-300"
                  }`}>{t.layer}</span>
                </td>
                <td className="px-2 py-1.5 text-muted-foreground">{t.source}</td>
                <td className="px-2 py-1.5">
                  <span className={t.side === "LONG" ? "text-green-400" : "text-red-400"}>{t.side}</span>
                </td>
                <td className="px-2 py-1.5 font-mono text-[11px]">
                  {fmtDate(t.entryDate)} <span className="text-muted-foreground">${t.entryPrice.toFixed(2)}</span>
                </td>
                <td className="px-2 py-1.5 font-mono text-[11px]">
                  {t.isOpen
                    ? <span className="text-blue-400">OPEN</span>
                    : <>{fmtDate(t.exitDate)} <span className="text-muted-foreground">${t.exitPrice?.toFixed(2)}</span></>}
                </td>
                <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{t.holdBars}</td>
                <td className={`px-2 py-1.5 text-right tabular-nums font-semibold ${won ? "text-green-400" : "text-red-400"}`}>
                  {fmtPct(t.returnPct != null ? t.returnPct * 100 : null, 1)}
                </td>
                <td className={`px-2 py-1.5 text-right tabular-nums font-semibold ${won ? "text-green-400" : "text-red-400"}`}>
                  {fmtMoney(t.pnlDollar)}
                </td>
                <td className="px-2 py-1.5 text-[10px] text-muted-foreground">
                  {t.exitReason ?? "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Top-level page ────────────────────────────────────────────────────────

export default function ChartPage() {
  const { activeTicker } = useTicker();
  const [strategy, setStrategy] = useState<ChartStrategy>("bbtc-ver");
  const [days, setDays] = useState<number>(1825); // 5y default
  const [highlightedTradeIdx, setHighlightedTradeIdx] = useState<number | null>(null);

  const { data, isLoading, error } = useQuery<ChartDataResponse>({
    queryKey: ["/api/chart", activeTicker, strategy, days],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/chart/${activeTicker}?strategy=${strategy}&days=${days}`);
      return res.json();
    },
    enabled: !!activeTicker,
    staleTime: 5 * 60 * 1000,
  });

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-6 space-y-6">
      <PageHeader
        icon={LineChartIcon}
        title="Strategy Chart"
        subtitle="Compare strategies side-by-side. Toggle between BBTC+VER, AMC, and three TFT modes to see how each one trades the same ticker."
      />
      <Disclaimer />

      {/* Strategy + timeframe selector */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-col gap-3">
            <div>
              <div className="text-xs text-muted-foreground mb-1.5">Strategy</div>
              <div className="flex flex-wrap gap-2">
                {STRATEGY_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => { setStrategy(opt.value); setHighlightedTradeIdx(null); }}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                      strategy === opt.value
                        ? "bg-blue-500 border-blue-500 text-white"
                        : "bg-card border-card-border hover:bg-blue-500/10 text-foreground"
                    }`}
                    title={opt.description}
                    data-testid={`strategy-${opt.value}`}
                  >
                    {opt.label}
                    {opt.badge && (
                      <span className={`ml-1.5 text-[10px] px-1 py-0.5 rounded ${strategy === opt.value ? "bg-white/20" : "bg-amber-500/20 text-amber-300"}`}>
                        {opt.badge}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1.5">Timeframe</div>
              <div className="flex flex-wrap gap-2">
                {TIMEFRAME_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => { setDays(opt.value); setHighlightedTradeIdx(null); }}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                      days === opt.value
                        ? "bg-blue-500 border-blue-500 text-white"
                        : "bg-card border-card-border hover:bg-blue-500/10 text-foreground"
                    }`}
                    data-testid={`timeframe-${opt.label}`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {!activeTicker && (
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground">
            <Target className="h-10 w-10 mx-auto mb-3 opacity-50" />
            <p>Pick a ticker from the search bar above to compare strategies on it.</p>
          </CardContent>
        </Card>
      )}

      {activeTicker && isLoading && (
        <div className="space-y-4">
          <Skeleton className="h-[420px] w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}

      {activeTicker && error && !isLoading && (
        <Card>
          <CardContent className="p-6 text-center">
            <p className="text-red-400">Failed to load chart data: {(error as Error).message}</p>
          </CardContent>
        </Card>
      )}

      {data && !isLoading && (
        <>
          {/* Chart */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center justify-between">
                <span>{data.ticker} · {STRATEGY_OPTIONS.find(o => o.value === data.strategy)?.label}</span>
                <span className="text-xs text-muted-foreground font-normal">
                  {data.rangeFrom} → {data.rangeTo}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3">
              <StrategyChart data={data} highlightedTradeIdx={highlightedTradeIdx} />
              {/* Legend */}
              <div className="flex flex-wrap items-center gap-3 mt-2 text-[10px] text-muted-foreground">
                {data.regimeBands.length > 0 && (
                  <>
                    <span className="inline-flex items-center gap-1">
                      <span className="inline-block w-3 h-3 rounded" style={{ backgroundColor: "#10b98140" }} />
                      Bullish regime
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="inline-block w-3 h-3 rounded" style={{ backgroundColor: "#ef444440" }} />
                      Bearish regime
                    </span>
                  </>
                )}
                {data.strategy.startsWith("tft") ? (
                  <>
                    <span className="inline-flex items-center gap-1">
                      <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: "#0ea5e9" }} />
                      Core entry
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: "#10b981" }} />
                      Tactical entry
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: "#14b8a6" }} />
                      Win exit
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: "#ef4444" }} />
                      Loss exit
                    </span>
                  </>
                ) : (
                  <>
                    <span className="inline-flex items-center gap-1">
                      <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: "#10b981" }} />
                      Long entry
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: "#14b8a6" }} />
                      Reduce / win exit
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: "#ef4444" }} />
                      Stop / loss
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: "#64748b" }} />
                      Trend exit
                    </span>
                  </>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Summary */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <TrendingUp className="h-4 w-4" />
                Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3">
              <SummaryStats summary={data.summary} />
            </CardContent>
          </Card>

          {/* Trade list */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <TrendingDown className="h-4 w-4" />
                  Trades ({data.trades.length})
                </span>
                {highlightedTradeIdx != null && (
                  <button
                    onClick={() => setHighlightedTradeIdx(null)}
                    className="text-[10px] text-muted-foreground hover:text-foreground"
                  >
                    clear highlight
                  </button>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 max-h-[500px] overflow-y-auto">
              <TradeList
                trades={data.trades}
                highlightedIdx={highlightedTradeIdx}
                onHighlight={setHighlightedTradeIdx}
              />
            </CardContent>
          </Card>

          {/* Notes */}
          {data.notes.length > 0 && (
            <Card>
              <CardContent className="p-4">
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {data.notes.map((n, i) => (
                    <li key={i}>• {n}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
