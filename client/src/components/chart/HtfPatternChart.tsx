/**
 * HtfPatternChart — visualises one HTF setup on the canonical CandlePane.
 *
 * Renders:
 *   - OHLC candles + volume histogram (CandlePane defaults)
 *   - 20-bar SMA line (Givens' trail reference)
 *   - Markers at pole start, flag start, breakout bar
 *   - Horizontal price lines: breakout (= flag high), target, stop
 *
 * Data shape comes from `GET /api/htf/chart/:symbol`. The component is
 * pure render — fetching lives in the parent (the Dialog on /htf).
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { CandlePane } from "./CandlePane";
import type { ChartBar, ChartMarker, LineOverlay, PriceLine } from "./types";
import { BrandedLoader } from "@/components/BrandedLoader";
import { BrandedEmptyState } from "@/components/BrandedEmptyState";
import { AlertTriangle, Flag } from "lucide-react";
import {
  SIGNAL_BULL, SIGNAL_BULL_LIGHT, SIGNAL_BEAR, SIGNAL_BEAR_LIGHT, CHART_SMA_20, ACCENT_AMBER_DEEP,
} from "@/lib/design-tokens";
import { apiRequest } from "@/lib/queryClient";

interface HtfChartBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  sma20?: number;
}

interface HtfAnnotation {
  poleStartDate: string;
  poleStartPrice: number;
  poleEndPrice: number;
  poleGainPct: number;
  poleDays: number;
  flagStartDate: string | null;
  flagDays: number;
  flagHigh: number;
  flagLow: number;
  flagPullbackPct: number;
  breakoutDate: string;
  breakoutPrice: number;
  breakoutVolRatio: number;
  targetPrice: number;
  stopPrice: number;
  qualityScore: number;
}

interface HtfChartResponse {
  symbol: string;
  bars: HtfChartBar[];
  annotation: HtfAnnotation | null;
}

export function HtfPatternChart({ symbol }: { symbol: string }) {
  const q = useQuery<HtfChartResponse>({
    queryKey: ["/api/htf/chart", symbol],
    queryFn: async () => (await apiRequest("GET", `/api/htf/chart/${symbol}`)).json(),
    enabled: !!symbol,
    staleTime: 60_000,
  });

  const { bars, overlays, markers, priceLines } = useMemo(() => {
    const data = q.data;
    if (!data || data.bars.length === 0) {
      return { bars: [] as ChartBar[], overlays: [], markers: [], priceLines: [] };
    }
    const cb: ChartBar[] = data.bars.map(b => ({
      date: b.date,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume,
      sma20: b.sma20,
    }));

    const ov: LineOverlay[] = [
      {
        dataKey: "sma20",
        label: "20-MA (trail)",
        color: CHART_SMA_20,
        width: 2,
        visible: true,
        showLastValueLabel: true,
      },
    ];

    const mk: ChartMarker[] = [];
    const pl: PriceLine[] = [];
    if (data.annotation) {
      const a = data.annotation;
      mk.push({
        date: a.poleStartDate,
        position: "belowBar",
        shape: "circle",
        color: SIGNAL_BULL_LIGHT,
        text: `Pole start +${a.poleGainPct.toFixed(0)}%`,
      });
      if (a.flagStartDate) {
        mk.push({
          date: a.flagStartDate,
          position: "aboveBar",
          shape: "circle",
          color: ACCENT_AMBER_DEEP, // amber — consolidation flag marker
          text: `Flag (${a.flagDays}d)`,
        });
      }
      mk.push({
        date: a.breakoutDate,
        position: "belowBar",
        shape: "arrowUp",
        color: SIGNAL_BULL,
        text: `Breakout ${a.breakoutVolRatio.toFixed(1)}× vol`,
      });

      pl.push(
        {
          price: a.targetPrice,
          color: SIGNAL_BULL,
          width: 2,
          style: "dashed",
          title: `Target ${a.targetPrice.toFixed(2)}`,
        },
        {
          price: a.flagHigh,
          color: SIGNAL_BULL_LIGHT,
          width: 1,
          style: "dotted",
          title: `Flag high ${a.flagHigh.toFixed(2)}`,
        },
        {
          price: a.breakoutPrice,
          color: SIGNAL_BULL_LIGHT,
          width: 2,
          style: "solid",
          title: `Entry ≈ ${a.breakoutPrice.toFixed(2)}`,
        },
        {
          price: a.flagLow,
          color: SIGNAL_BEAR_LIGHT,
          width: 1,
          style: "dotted",
          title: `Flag low ${a.flagLow.toFixed(2)}`,
        },
        {
          price: a.stopPrice,
          color: SIGNAL_BEAR,
          width: 2,
          style: "dashed",
          title: `Stop ${a.stopPrice.toFixed(2)}`,
        },
      );
    }
    return { bars: cb, overlays: ov, markers: mk, priceLines: pl };
  }, [q.data]);

  if (q.isLoading) {
    return (
      <div className="h-[480px] w-full flex items-center justify-center">
        <BrandedLoader message={`Loading ${symbol} pattern chart…`} />
      </div>
    );
  }
  if (q.isError) {
    return (
      <BrandedEmptyState
        icon={AlertTriangle}
        title="Couldn't load chart"
        description={(q.error as any)?.message || "The chart endpoint returned an error."}
      />
    );
  }
  if (!q.data || q.data.bars.length === 0) {
    return (
      <BrandedEmptyState
        icon={Flag}
        title="No bars available"
        description="FMP returned no historical data for this symbol — can't render the pattern."
      />
    );
  }

  return (
    <div className="space-y-3">
      {q.data.annotation && (
        <PatternStatBar a={q.data.annotation} />
      )}
      <div className="h-[480px] w-full rounded-md border border-border bg-card">
        <CandlePane
          bars={bars}
          overlays={overlays}
          markers={markers}
          priceLines={priceLines}
        />
      </div>
      <ChartLegend />
    </div>
  );
}

function PatternStatBar({ a }: { a: HtfAnnotation }) {
  const stats: Array<[string, string]> = [
    ["Score", `${a.qualityScore}`],
    ["Pole", `+${a.poleGainPct.toFixed(0)}% / ${a.poleDays}d`],
    ["Flag", `${a.flagDays}d / -${a.flagPullbackPct.toFixed(1)}%`],
    ["Breakout vol", `${a.breakoutVolRatio.toFixed(1)}×`],
    ["Entry", `$${a.breakoutPrice.toFixed(2)}`],
    ["Target", `$${a.targetPrice.toFixed(2)}`],
    ["Stop", `$${a.stopPrice.toFixed(2)}`],
    ["R/R", `${((a.targetPrice - a.breakoutPrice) / (a.breakoutPrice - a.stopPrice)).toFixed(2)}:1`],
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
      {stats.map(([label, value]) => (
        <div key={label} className="rounded-md border border-border p-2 bg-card text-center">
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-sm font-bold text-foreground tabular-nums">{value}</div>
        </div>
      ))}
    </div>
  );
}

function ChartLegend() {
  const items: Array<{ swatch: string; label: string; dashed?: boolean }> = [
    { swatch: SIGNAL_BULL, label: "Target (measure rule)", dashed: true },
    { swatch: SIGNAL_BULL_LIGHT, label: "Entry / flag high" },
    { swatch: SIGNAL_BEAR, label: "Stop (below flag low)", dashed: true },
    { swatch: SIGNAL_BEAR_LIGHT, label: "Flag low" },
    { swatch: CHART_SMA_20, label: "20-MA (trail line)" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map(it => (
        <div key={it.label} className="flex items-center gap-1.5">
          <span
            className="inline-block w-4 h-0"
            style={{
              borderTop: `2px ${it.dashed ? "dashed" : "solid"} ${it.swatch}`,
            }}
          />
          <span>{it.label}</span>
        </div>
      ))}
    </div>
  );
}
