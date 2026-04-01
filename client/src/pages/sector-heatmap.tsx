import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, TrendingUp, TrendingDown, Activity } from "lucide-react";
import { HelpBlock, Example, ScoreRange } from "@/components/HelpBlock";
import { Disclaimer } from "@/components/Disclaimer";

// ─── Types ───────────────────────────────────────────────────────────────────

interface SectorData {
  symbol: string;
  name: string;
  price: number;
  change: number;
  returns: {
    day1: number;
    week1: number;
    month1: number;
    month3: number;
  };
}

type Timeframe = "day1" | "week1" | "month1" | "month3";

const TIMEFRAME_LABELS: Record<Timeframe, string> = {
  day1: "1D",
  week1: "1W",
  month1: "1M",
  month3: "3M",
};

// ─── Color interpolation ─────────────────────────────────────────────────────

function getHeatColor(pct: number): string {
  // Clamp between -5 and +5 for color mapping
  const clamped = Math.max(-5, Math.min(5, pct));
  const t = (clamped + 5) / 10; // 0 = deep red, 0.5 = neutral, 1 = deep green

  if (t < 0.5) {
    // Red → neutral
    const r = Math.round(220 - (220 - 40) * (t / 0.5));
    const g = Math.round(38 + (40 - 38) * (t / 0.5));
    const b = Math.round(38 + (40 - 38) * (t / 0.5));
    const a = 0.15 + (1 - t / 0.5) * 0.35;
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  } else {
    // Neutral → green
    const factor = (t - 0.5) / 0.5;
    const r = Math.round(40 - (40 - 34) * factor);
    const g = Math.round(40 + (197 - 40) * factor);
    const b = Math.round(40 + (94 - 40) * factor);
    const a = 0.15 + factor * 0.35;
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function SectorHeatmap() {
  const [timeframe, setTimeframe] = useState<Timeframe>("month1");

  const { data: sectors, isLoading, error } = useQuery<SectorData[]>({
    queryKey: ["/api/sectors"],
  });

  const sorted = useMemo(() => {
    if (!sectors) return [];
    return [...sectors].sort((a, b) => b.returns[timeframe] - a.returns[timeframe]);
  }, [sectors, timeframe]);

  return (
    <div className="p-3 sm:p-4 md:p-6 space-y-6 max-w-[1200px] mx-auto" data-testid="sector-heatmap-page">
      <h1 className="text-lg font-bold text-foreground">Sector Rotation Heatmap</h1>
      <p className="text-xs text-muted-foreground -mt-4">Track money flow across market sectors. Green = outperforming, Red = underperforming.</p>
      <Disclaimer />

      <div className="bg-card border border-card-border rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-bold text-foreground">Sector Performance</h3>
          </div>

          {/* Timeframe Selector */}
          <div className="flex gap-1" data-testid="sector-timeframe-selector">
            {(Object.entries(TIMEFRAME_LABELS) as [Timeframe, string][]).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTimeframe(key)}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                  timeframe === key
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
                data-testid={`sector-tf-${key}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <HelpBlock title="Understanding sector rotation">
          <p><strong className="text-foreground">Sector rotation</strong> is the movement of money between different market sectors as economic conditions change.</p>
          <p>Smart money tends to rotate into sectors that benefit from the current economic cycle:</p>
          <Example type="good">
            <strong className="text-green-400">Early recovery:</strong> Technology (XLK) and Consumer Discretionary (XLY) tend to lead. Industrials (XLI) follow as the economy picks up steam.
          </Example>
          <Example type="neutral">
            <strong className="text-yellow-400">Late cycle:</strong> Energy (XLE) and Materials (XLB) often outperform as commodity prices rise. Financials (XLF) may benefit from rising rates.
          </Example>
          <Example type="bad">
            <strong className="text-red-400">Recession:</strong> Utilities (XLU), Consumer Staples (XLP), and Healthcare (XLV) are defensive plays — they hold up better when the market falls.
          </Example>
          <ScoreRange label="Strong" range="> +3%" color="green" description="Sector is outperforming — money is flowing in" />
          <ScoreRange label="Neutral" range="±1%" color="yellow" description="Flat performance — sector is in line with the market" />
          <ScoreRange label="Weak" range="< -3%" color="red" description="Sector is underperforming — money is flowing out" />
        </HelpBlock>

        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Activity className="h-4 w-4 animate-spin" />
              <span>Loading sector data from Yahoo Finance...</span>
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-center justify-center py-12">
            <span className="text-xs text-red-400">Failed to load sector data. Please try again.</span>
          </div>
        )}

        {sorted.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3" data-testid="sector-grid">
            {sorted.map(sector => {
              const ret = sector.returns[timeframe];
              const isPositive = ret >= 0;
              return (
                <div
                  key={sector.symbol}
                  className="border border-card-border/50 rounded-lg p-3 transition-colors"
                  style={{ backgroundColor: getHeatColor(ret) }}
                  data-testid={`sector-card-${sector.symbol}`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold text-foreground">{sector.name}</span>
                    {isPositive
                      ? <TrendingUp className="h-3 w-3 text-green-400" />
                      : <TrendingDown className="h-3 w-3 text-red-400" />
                    }
                  </div>
                  <div className="flex items-baseline justify-between">
                    <span className="text-[10px] text-muted-foreground font-mono">{sector.symbol}</span>
                    <span className="text-xs text-muted-foreground font-mono tabular-nums">
                      ${sector.price.toFixed(2)}
                    </span>
                  </div>
                  <div className="mt-2">
                    <span className={`text-lg font-bold font-mono tabular-nums ${isPositive ? "text-green-400" : "text-red-400"}`}>
                      {isPositive ? "+" : ""}{ret.toFixed(2)}%
                    </span>
                  </div>

                  {/* Mini returns bar */}
                  <div className="flex gap-1 mt-2">
                    {(Object.entries(TIMEFRAME_LABELS) as [Timeframe, string][]).map(([key, label]) => {
                      const v = sector.returns[key];
                      return (
                        <div key={key} className={`flex-1 text-center rounded py-0.5 ${
                          key === timeframe ? "bg-foreground/10" : ""
                        }`}>
                          <div className="text-[8px] text-muted-foreground">{label}</div>
                          <div className={`text-[9px] font-mono tabular-nums font-semibold ${v >= 0 ? "text-green-400" : "text-red-400"}`}>
                            {v >= 0 ? "+" : ""}{v.toFixed(1)}%
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
