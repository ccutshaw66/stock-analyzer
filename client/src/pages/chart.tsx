/**
 * Strategy Chart — visual backtester comparing BBTC+VER, AMC, and three TFT
 * modes on the active ticker. Toggle strategies via dropdown and see:
 *   - Price chart with regime bands (TFT) and entry/exit dots
 *   - Summary stats: total $ P/L, win rate, R-multiple, captured B&H
 *   - Sortable trade list — click a trade to highlight its dots
 *
 * Data: GET /api/chart/:ticker?strategy=X&days=Y
 *
 * Page is the new "Strategy Chart" route at /chart. Active ticker comes from
 * TickerContext (matches the rest of the site). Existing /trade page is
 * untouched — this is purely additive.
 *
 * Dot rendering: uses Scatter overlays (one per dot category) instead of
 * ReferenceDot, because ReferenceDot on dense categorical X axes silently
 * drops dots that don't fall on rendered ticks. Scatter renders one point
 * per data row regardless of axis density.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  SIGNAL_BULL,
  SIGNAL_BULL_EMERALD,
  SIGNAL_BEAR,
  SIGNAL_WATCH,
  SIGNAL_REDUCE,
  SIGNAL_SHORT_ADD,
  SIGNAL_TREND_EXIT,
  COLOR_GRAY_NEUTRAL,
  ACCENT_SKY,
  CHART_RSI,
  CHART_GRID_DARK,
} from "@/lib/design-tokens";
import { apiRequest } from "@/lib/queryClient";
import { useTicker } from "@/contexts/TickerContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/PageHeader";
import { Disclaimer } from "@/components/Disclaimer";
import { LineChart as LineChartIcon, TrendingUp, TrendingDown, Target, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Scatter,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceArea,
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
  tradeNumber: number | null;
}
interface RegimeBand {
  startDate: string;
  endDate: string;
  regime: "BULLISH" | "BEARISH" | "NEUTRAL";
}
interface ChartTrade {
  tradeNumber: number;
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

const STRATEGY_OPTIONS: { value: ChartStrategy; label: string; description: string }[] = [
  { value: "bbtc-ver", label: "BBTC + VER", description: "Current website Ready/Set/Go strategy" },
  { value: "amc", label: "AMC only", description: "Adaptive Momentum Confluence (the 'Set' indicator alone)" },
  { value: "tft-40w", label: "TFT 40W", description: "Two-Layer Trend Continuation, weekly 40W SMA stop" },
  { value: "tft-60w", label: "TFT 60W", description: "TFT with slower 60W stop" },
  { value: "tft-catastrophic", label: "TFT Catastrophic", description: "TFT, core only exits on -15% catastrophic. Maximum moonshot capture" },
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

// ─── Dot category bucketing ───────────────────────────────────────────────
// Each dot gets bucketed into one of these visual categories. A separate
// Scatter component is rendered per category so colors stay consistent and
// hover tooltips can identify the dot type.

type DotCategory =
  | "core_entry"
  | "tactical_entry"
  | "long_entry"        // BBTC/VER/AMC entries (no layer)
  | "exit_win"          // teal — REDUCE / win exits
  | "exit_loss"         // red — STOP / catastrophic
  | "exit_clean"        // slate — trend exits
  | "watch"             // yellow — VER_WATCH_BUY etc
  | "info";             // hollow magenta/orange — info-only (shorts, watch_sell)

const CATEGORY_COLOR: Record<DotCategory, string> = {
  core_entry: ACCENT_SKY,
  tactical_entry: SIGNAL_BULL_EMERALD,
  long_entry: SIGNAL_BULL_EMERALD,
  exit_win: SIGNAL_REDUCE,
  exit_loss: SIGNAL_BEAR,
  exit_clean: COLOR_GRAY_NEUTRAL,
  watch: SIGNAL_WATCH,
  info: SIGNAL_SHORT_ADD,
};

function categorizeDot(s: ChartSignalDot): DotCategory {
  if (s.type === "ENTRY" && s.layer === "CORE") return "core_entry";
  if (s.type === "ENTRY" && s.layer === "TACTICAL") return "tactical_entry";
  if (s.type === "ENTRY") return "long_entry";
  if (s.type === "WATCH") return "watch";
  if (!s.filled) return "info";
  if (s.type === "EXIT") {
    // Color signal preserves win/loss/clean distinction set by the backend.
    if (s.color === SIGNAL_REDUCE) return "exit_win";
    if (s.color === SIGNAL_BEAR) return "exit_loss";
    return "exit_clean";
  }
  if (s.type === "REDUCE") return "exit_win";
  if (s.type === "INFO") return "info";
  return "info";
}

// ─── Custom dot shape — handles highlighted state ─────────────────────────
// Closure over `category` and `highlightedTradeNum` so each Scatter draws its
// own color and reads its own trade-num field on the shared row to decide
// whether to render in highlighted form.

interface DotShapeProps {
  cx?: number;
  cy?: number;
  payload?: Record<string, any>;
}

function makeDotShape(category: DotCategory, hollow: boolean, highlightedTradeNum: number | null) {
  return function DotShape(props: DotShapeProps) {
    const { cx, cy, payload } = props;
    if (cx == null || cy == null) return <g />;
    const color = CATEGORY_COLOR[category];
    const tradeNum = payload?.[`tradeNum_${category}`];
    const isHi = tradeNum != null && tradeNum === highlightedTradeNum;
    const r = isHi ? 7 : 4;
    return (
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill={hollow ? "transparent" : color}
        stroke={color}
        strokeWidth={isHi ? 2.5 : 1.5}
      />
    );
  };
}

// ─── Tooltip — distinguish dot hover from line hover ──────────────────────

function ChartTooltip({ active, payload }: { active?: boolean; payload?: any[] }) {
  if (!active || !payload?.length) return null;
  // The Recharts active payload is per-series. Find the entry that has signal
  // metadata (label/tradeNum) — that's a dot-hover. Otherwise fall back to
  // the line value (close price).
  const sigPayload = payload.find((p: any) => p?.payload?.sigLabel);
  const closePayload = payload.find((p: any) => p?.dataKey === "close");
  if (sigPayload) {
    const p = sigPayload.payload;
    return (
      <div className="bg-popover border border-border rounded px-2 py-1.5 text-xs shadow-lg">
        <div className="font-mono text-muted-foreground">{p.date}</div>
        <div className="font-semibold text-foreground">{p.sigLabel}</div>
        {p.sigTradeNum != null && (
          <div className="text-blue-400">Trade #{p.sigTradeNum}</div>
        )}
        <div className="text-muted-foreground">@ ${typeof p.sigPrice === "number" ? p.sigPrice.toFixed(2) : "—"}</div>
      </div>
    );
  }
  if (closePayload) {
    return (
      <div className="bg-popover border border-border rounded px-2 py-1 text-xs shadow-lg">
        <div className="font-mono text-muted-foreground">{closePayload.payload.date}</div>
        <div className="text-foreground">${Number(closePayload.value).toFixed(2)}</div>
      </div>
    );
  }
  return null;
}

// ─── Chart subcomponent ────────────────────────────────────────────────────

function StrategyChart({ data, highlightedTradeNum }: {
  data: ChartDataResponse;
  highlightedTradeNum: number | null;
}) {
  // Build a SINGLE chartData array that all series share. Each row has:
  //   - date (categorical X axis)
  //   - close (Line dataKey)
  //   - y_<category> (Scatter dataKey for that category, null if no signal)
  //   - tradeNum_<category> (read by the dot shape closure to highlight)
  //   - sigLabel / sigTradeNum / sigPrice (read by the tooltip)
  //
  // Sharing one data array is critical: when each Scatter has its OWN data
  // array, Recharts builds the categorical X axis from each series
  // independently and they don't merge — dates jumble. Single source = stable
  // chronological X axis.
  const chartData = useMemo(() => {
    // Index signals by date for O(N) lookup
    const sigsByDate = new Map<string, ChartSignalDot[]>();
    for (const s of data.signals) {
      if (!sigsByDate.has(s.date)) sigsByDate.set(s.date, []);
      sigsByDate.get(s.date)!.push(s);
    }

    return data.bars.map(b => {
      const row: Record<string, any> = { date: b.date, close: b.close };
      const sigs = sigsByDate.get(b.date) || [];
      for (const s of sigs) {
        const cat = categorizeDot(s);
        // If multiple signals of same category fire on same bar, last-wins
        // (rare; e.g. BBTC_BUY + VER_BUY both = long_entry).
        row[`y_${cat}`] = s.price;
        row[`tradeNum_${cat}`] = s.tradeNumber;
        row[`label_${cat}`] = s.label;
      }
      // Aggregate metadata for the tooltip (combines all signals firing on
      // this bar, if any).
      if (sigs.length > 0) {
        row.sigLabel = sigs.map(s => s.label).join(" + ");
        // Surface the lowest trade number among signals on this bar (entries
        // are usually first, so this picks the entry's number when an entry
        // and a same-bar exit both happen).
        const tradeNums = sigs.map(s => s.tradeNumber).filter((n): n is number => n != null);
        row.sigTradeNum = tradeNums.length > 0 ? Math.min(...tradeNums) : null;
        row.sigPrice = sigs[0].price;
      }
      return row;
    });
  }, [data.bars, data.signals]);

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

  // Determine which categories actually have any dots — skip empty Scatters
  // to keep the legend clean and avoid useless DOM nodes.
  const activeCategories = useMemo(() => {
    const seen = new Set<DotCategory>();
    for (const s of data.signals) {
      seen.add(categorizeDot(s));
    }
    return Array.from(seen);
  }, [data.signals]);

  return (
    <div className="w-full" style={{ height: 420 }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 30 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_DARK} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fill: SIGNAL_TREND_EXIT }}
            interval="preserveStartEnd"
            minTickGap={50}
            type="category"
            allowDuplicatedCategory={false}
          />
          <YAxis
            tick={{ fontSize: 10, fill: SIGNAL_TREND_EXIT }}
            domain={["auto", "auto"]}
            tickFormatter={v => `$${typeof v === "number" ? v.toFixed(0) : v}`}
          />
          <Tooltip content={<ChartTooltip />} />

          {/* Regime bands behind the price line */}
          {regimeAreas.map(area => (
            <ReferenceArea
              key={area.key}
              x1={area.x1}
              x2={area.x2}
              fill={area.regime === "BULLISH" ? SIGNAL_BULL_EMERALD : SIGNAL_BEAR}
              fillOpacity={0.06}
              ifOverflow="extendDomain"
            />
          ))}

          <Line
            type="monotone"
            dataKey="close"
            stroke={CHART_RSI}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />

          {/* One Scatter per dot category, all sharing chartData. dataKey
              picks out the per-category y field (e.g. "y_core_entry");
              rows where that field is null/undefined render no dot. Shared
              chartData = shared categorical axis = correctly ordered dates. */}
          {activeCategories.map(cat => {
            const hollow = cat === "info";
            return (
              <Scatter
                key={cat}
                name={cat}
                dataKey={`y_${cat}`}
                shape={makeDotShape(cat, hollow, highlightedTradeNum)}
                isAnimationActive={false}
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
  const totalColor = summary.totalPnLIncludingUnrealized >= 0 ? "text-bull-light" : "text-bear-light";
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
          <div className="text-micro text-muted-foreground mt-0.5 truncate" title={c.hint}>{c.hint}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Trade list with sortable columns ─────────────────────────────────────

type SortKey = "tradeNumber" | "entryDate" | "exitDate" | "pnlDollar" | "returnPct";
type SortDir = "asc" | "desc";

function SortHeader({
  label,
  sortKey,
  active,
  dir,
  onClick,
}: {
  label: string;
  sortKey: SortKey;
  active: boolean;
  dir: SortDir;
  onClick: (k: SortKey) => void;
}) {
  return (
    <button
      onClick={() => onClick(sortKey)}
      className={`flex items-center gap-1 text-left font-medium ${
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
      }`}
      data-testid={`sort-${sortKey}`}
    >
      {label}
      {active ? (
        dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
      ) : (
        <ArrowUpDown className="h-3 w-3 opacity-40" />
      )}
    </button>
  );
}

function TradeList({
  trades,
  highlightedTradeNum,
  onHighlight,
}: {
  trades: ChartTrade[];
  highlightedTradeNum: number | null;
  onHighlight: (tradeNum: number | null) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("tradeNumber");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const sorted = useMemo(() => {
    const copy = [...trades];
    copy.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "tradeNumber":
          cmp = a.tradeNumber - b.tradeNumber;
          break;
        case "entryDate":
          cmp = a.entryDate.localeCompare(b.entryDate);
          break;
        case "exitDate":
          cmp = (a.exitDate ?? "").localeCompare(b.exitDate ?? "");
          break;
        case "pnlDollar":
          cmp = (a.pnlDollar ?? 0) - (b.pnlDollar ?? 0);
          break;
        case "returnPct":
          cmp = (a.returnPct ?? 0) - (b.returnPct ?? 0);
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [trades, sortKey, sortDir]);

  function toggleSort(k: SortKey) {
    if (k === sortKey) setSortDir(d => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir(k === "tradeNumber" || k === "entryDate" ? "asc" : "desc"); }
  }

  if (trades.length === 0) {
    return <p className="text-sm text-muted-foreground p-4">No trades fired in this window.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-card z-10">
          <tr className="text-left border-b border-card-border">
            <th className="px-2 py-2">
              <SortHeader label="#" sortKey="tradeNumber" active={sortKey === "tradeNumber"} dir={sortDir} onClick={toggleSort} />
            </th>
            <th className="px-2 py-2 text-muted-foreground font-medium">Layer</th>
            <th className="px-2 py-2 text-muted-foreground font-medium">Source</th>
            <th className="px-2 py-2 text-muted-foreground font-medium">Side</th>
            <th className="px-2 py-2">
              <SortHeader label="Entry" sortKey="entryDate" active={sortKey === "entryDate"} dir={sortDir} onClick={toggleSort} />
            </th>
            <th className="px-2 py-2">
              <SortHeader label="Exit" sortKey="exitDate" active={sortKey === "exitDate"} dir={sortDir} onClick={toggleSort} />
            </th>
            <th className="px-2 py-2 text-muted-foreground font-medium">Hold</th>
            <th className="px-2 py-2 text-right">
              <SortHeader label="Return" sortKey="returnPct" active={sortKey === "returnPct"} dir={sortDir} onClick={toggleSort} />
            </th>
            <th className="px-2 py-2 text-right">
              <SortHeader label="P/L $" sortKey="pnlDollar" active={sortKey === "pnlDollar"} dir={sortDir} onClick={toggleSort} />
            </th>
            <th className="px-2 py-2 text-muted-foreground font-medium">Reason</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(t => {
            const won = (t.returnPct ?? 0) > 0;
            const isHi = highlightedTradeNum === t.tradeNumber;
            return (
              <tr
                key={t.tradeNumber}
                onClick={() => onHighlight(isHi ? null : t.tradeNumber)}
                className={`border-b border-card-border/60 cursor-pointer transition-colors ${
                  isHi ? "bg-blue-500/10" : "hover:bg-card-foreground/5"
                }`}
              >
                <td className="px-2 py-1.5 text-muted-foreground tabular-nums font-semibold">{t.tradeNumber}</td>
                <td className="px-2 py-1.5">
                  <span className={`text-micro px-1.5 py-0.5 rounded ${
                    t.layer === "CORE" ? "bg-sky-500/20 text-sky-300" :
                    t.layer === "TACTICAL" ? "bg-emerald-500/20 text-emerald-300" :
                    "bg-zinc-500/20 text-zinc-300"
                  }`}>{t.layer}</span>
                </td>
                <td className="px-2 py-1.5 text-muted-foreground">{t.source}</td>
                <td className="px-2 py-1.5">
                  <span className={t.side === "LONG" ? "text-bull-light" : "text-bear-light"}>{t.side}</span>
                </td>
                <td className="px-2 py-1.5 font-mono text-2xs">
                  {fmtDate(t.entryDate)} <span className="text-muted-foreground">${t.entryPrice.toFixed(2)}</span>
                </td>
                <td className="px-2 py-1.5 font-mono text-2xs">
                  {t.isOpen
                    ? <span className="text-blue-400">OPEN</span>
                    : <>{fmtDate(t.exitDate)} <span className="text-muted-foreground">${t.exitPrice?.toFixed(2)}</span></>}
                </td>
                <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{t.holdBars}</td>
                <td className={`px-2 py-1.5 text-right tabular-nums font-semibold ${won ? "text-bull-light" : "text-bear-light"}`}>
                  {fmtPct(t.returnPct != null ? t.returnPct * 100 : null, 1)}
                </td>
                <td className={`px-2 py-1.5 text-right tabular-nums font-semibold ${won ? "text-bull-light" : "text-bear-light"}`}>
                  {fmtMoney(t.pnlDollar)}
                </td>
                <td className="px-2 py-1.5 text-micro text-muted-foreground">
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
  const [highlightedTradeNum, setHighlightedTradeNum] = useState<number | null>(null);

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
                    onClick={() => { setStrategy(opt.value); setHighlightedTradeNum(null); }}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                      strategy === opt.value
                        ? "bg-blue-500 border-blue-500 text-white"
                        : "bg-card border-card-border hover:bg-blue-500/10 text-foreground"
                    }`}
                    title={opt.description}
                    data-testid={`strategy-${opt.value}`}
                  >
                    {opt.label}
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
                    onClick={() => { setDays(opt.value); setHighlightedTradeNum(null); }}
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

          {/* Methodology context — replaces the misleading "$5.28M basket" badge.
              The basket result is OUR test methodology, not a user-experience
              guarantee. */}
          <div className="mt-2 text-2xs text-muted-foreground bg-muted/30 border border-card-border rounded p-2 leading-relaxed">
            <strong className="text-foreground">Backtest methodology:</strong> All five strategies were backtested over 10 years (2015–2026) on an 80-ticker basket spanning all 11 sectors plus SPY/QQQ/DIA/IWM benchmarks. Results vary widely by ticker — this page shows you exactly how each strategy traded the active ticker, not basket averages. Past results don&apos;t guarantee future performance.
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
            <p className="text-bear-light">Failed to load chart data: {(error as Error).message}</p>
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
              <StrategyChart data={data} highlightedTradeNum={highlightedTradeNum} />
              {/* Legend */}
              <div className="flex flex-wrap items-center gap-3 mt-2 text-micro text-muted-foreground">
                {data.regimeBands.length > 0 && (
                  <>
                    <span className="inline-flex items-center gap-1">
                      <span className="inline-block w-3 h-3 rounded" style={{ backgroundColor: `${SIGNAL_BULL_EMERALD}40` }} />
                      Bullish regime
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="inline-block w-3 h-3 rounded" style={{ backgroundColor: `${SIGNAL_BEAR}40` }} />
                      Bearish regime
                    </span>
                  </>
                )}
                {data.strategy.startsWith("tft") ? (
                  <>
                    <span className="inline-flex items-center gap-1">
                      <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: ACCENT_SKY }} />
                      Core entry
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: SIGNAL_BULL_EMERALD }} />
                      Tactical entry
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: SIGNAL_REDUCE }} />
                      Win exit
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: SIGNAL_BEAR }} />
                      Loss exit
                    </span>
                  </>
                ) : (
                  <>
                    <span className="inline-flex items-center gap-1">
                      <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: SIGNAL_BULL_EMERALD }} />
                      Long entry
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: SIGNAL_REDUCE }} />
                      Reduce / win exit
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: SIGNAL_BEAR }} />
                      Stop / loss
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: COLOR_GRAY_NEUTRAL }} />
                      Trend exit
                    </span>
                  </>
                )}
                <span className="text-muted-foreground">· hover any dot to see its trade #</span>
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
                {highlightedTradeNum != null && (
                  <button
                    onClick={() => setHighlightedTradeNum(null)}
                    className="text-micro text-muted-foreground hover:text-foreground"
                  >
                    clear highlight
                  </button>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 max-h-[500px] overflow-y-auto">
              <TradeList
                trades={data.trades}
                highlightedTradeNum={highlightedTradeNum}
                onHighlight={setHighlightedTradeNum}
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
