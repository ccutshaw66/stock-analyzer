import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { BarChart3, TrendingUp, TrendingDown, Activity, X, Loader2, ArrowRight, Grid3X3 } from "lucide-react";
import { HelpBlock, Example, ScoreRange } from "@/components/HelpBlock";
import { Disclaimer } from "@/components/Disclaimer";
import { PageHeader } from "@/components/PageHeader";
import { formatCompact } from "@/lib/format";
import { useTicker } from "@/contexts/TickerContext";
import { SIGNAL_BULL, SIGNAL_BEAR, hexToRgb } from "@/lib/design-tokens";

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
// Endpoints anchored to design tokens so a brand-color change automatically
// reaches the heatmap. Midpoint is a near-black neutral (matches dark theme).

const HEAT_BEAR = hexToRgb(SIGNAL_BEAR);
const HEAT_BULL = hexToRgb(SIGNAL_BULL);
const HEAT_NEUTRAL = { r: 40, g: 40, b: 40 };

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function getHeatColor(pct: number): string {
  // Clamp between -5 and +5 for color mapping
  const clamped = Math.max(-5, Math.min(5, pct));
  const t = (clamped + 5) / 10; // 0 = bear, 0.5 = neutral, 1 = bull

  if (t < 0.5) {
    const f = t / 0.5; // 0 = full bear, 1 = neutral
    const r = lerp(HEAT_BEAR.r, HEAT_NEUTRAL.r, f);
    const g = lerp(HEAT_BEAR.g, HEAT_NEUTRAL.g, f);
    const b = lerp(HEAT_BEAR.b, HEAT_NEUTRAL.b, f);
    const a = 0.15 + (1 - f) * 0.35;
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  } else {
    const f = (t - 0.5) / 0.5; // 0 = neutral, 1 = full bull
    const r = lerp(HEAT_NEUTRAL.r, HEAT_BULL.r, f);
    const g = lerp(HEAT_NEUTRAL.g, HEAT_BULL.g, f);
    const b = lerp(HEAT_NEUTRAL.b, HEAT_BULL.b, f);
    const a = 0.15 + f * 0.35;
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
}

// ─── Main Component ──────────────────────────────────────────────────────────

interface SectorLeader {
  ticker: string;
  companyName: string;
  price: number;
  changePct: number;
  return1m: number;
  marketCap: number;
  volume: number;
  volSurge: number;
  score: number;
}

interface SectorLeadersResponse {
  sector: string;
  etf: string;
  leaders: SectorLeader[];
}

export default function SectorHeatmap() {
  const [timeframe, setTimeframe] = useState<Timeframe>("month1");
  const [drillSymbol, setDrillSymbol] = useState<string | null>(null);
  const [drillName, setDrillName] = useState<string>("");

  const { data: sectors, isLoading, error } = useQuery<SectorData[]>({
    queryKey: ["/api/sectors"],
  });

  const sorted = useMemo(() => {
    if (!sectors) return [];
    return [...sectors].sort((a, b) => b.returns[timeframe] - a.returns[timeframe]);
  }, [sectors, timeframe]);

  return (
    <div className="p-3 sm:p-4 md:p-6 space-y-6 max-w-[1200px] mx-auto" data-testid="sector-heatmap-page">
      {/* Title */}
      <PageHeader
        icon={Grid3X3}
        title="Sector Heatmap"
        subtitle="Track money flow across market sectors. Green = outperforming, Red = underperforming."
      />

      {/* Disclaimer */}
      <Disclaimer />

      {/* How It Works */}
      <HelpBlock title="Understanding sector rotation">
        <p><strong className="text-foreground">Sector rotation</strong> is the movement of money between different market sectors as economic conditions change.</p>
        <p>Smart money tends to rotate into sectors that benefit from the current economic cycle:</p>
        <Example type="good">
          <strong className="text-bull-light">Early recovery:</strong> Technology (XLK) and Consumer Discretionary (XLY) tend to lead. Industrials (XLI) follow as the economy picks up steam.
        </Example>
        <Example type="neutral">
          <strong className="text-watch-light">Late cycle:</strong> Energy (XLE) and Materials (XLB) often outperform as commodity prices rise. Financials (XLF) may benefit from rising rates.
        </Example>
        <Example type="bad">
          <strong className="text-bear-light">Recession:</strong> Utilities (XLU), Consumer Staples (XLP), and Healthcare (XLV) are defensive plays — they hold up better when the market falls.
        </Example>
        <ScoreRange label="Strong" range="> +3%" color="green" description="Sector is outperforming — money is flowing in" />
        <ScoreRange label="Neutral" range="±1%" color="yellow" description="Flat performance — sector is in line with the market" />
        <ScoreRange label="Weak" range="< -3%" color="red" description="Sector is underperforming — money is flowing out" />
      </HelpBlock>

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

        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Activity className="h-4 w-4 animate-spin" />
              <span>Loading sector data...</span>
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-center justify-center py-12">
            <span className="text-xs text-bear-light">Failed to load sector data. Please try again.</span>
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
                  onClick={() => { setDrillSymbol(sector.symbol); setDrillName(sector.name); }}
                  className="border border-card-border/50 rounded-lg p-3 transition-all cursor-pointer hover:border-foreground/40 hover:scale-[1.02]"
                  style={{ backgroundColor: getHeatColor(ret) }}
                  data-testid={`sector-card-${sector.symbol}`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold text-foreground">{sector.name}</span>
                    {isPositive
                      ? <TrendingUp className="h-3 w-3 text-bull-light" />
                      : <TrendingDown className="h-3 w-3 text-bear-light" />
                    }
                  </div>
                  <div className="flex items-baseline justify-between">
                    <span className="text-micro text-muted-foreground font-mono">{sector.symbol}</span>
                    <span className="text-xs text-muted-foreground font-mono tabular-nums">
                      ${sector.price.toFixed(2)}
                    </span>
                  </div>
                  <div className="mt-2">
                    <span className={`text-lg font-bold font-mono tabular-nums ${isPositive ? "text-bull-light" : "text-bear-light"}`}>
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
                          <div className="text-tiny text-muted-foreground">{label}</div>
                          <div className={`text-mini font-mono tabular-nums font-semibold ${v >= 0 ? "text-bull-light" : "text-bear-light"}`}>
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

      {drillSymbol && (
        <SectorLeadersModal
          symbol={drillSymbol}
          sectorName={drillName}
          onClose={() => setDrillSymbol(null)}
        />
      )}
    </div>
  );
}

// ─── Sector Leaders Modal ────────────────────────────────────────────────────

function SectorLeadersModal({ symbol, sectorName, onClose }: { symbol: string; sectorName: string; onClose: () => void }) {
  const [, setLocation] = useLocation();
  const { setActiveTicker } = useTicker();

  const { data, isLoading, error } = useQuery<SectorLeadersResponse>({
    queryKey: [`/api/sectors/${symbol}/top`],
    staleTime: 10 * 60 * 1000,
  });

  const goToTicker = (t: string) => {
    setActiveTicker(t);
    setLocation("/scanner");
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
      data-testid="sector-leaders-modal"
    >
      <div
        className="bg-card border border-card-border rounded-xl max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-card-border">
          <div>
            <h2 className="text-lg font-bold">Top 10 in {sectorName}</h2>
            <p className="text-xs text-muted-foreground">Where the money is flowing — ranked by 1-mo momentum + volume surge ({symbol})</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-muted rounded-md" data-testid="close-sector-modal">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {isLoading && (
            <div className="flex items-center justify-center py-12 gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Ranking {sectorName} leaders…</span>
            </div>
          )}
          {error && (
            <div className="text-center py-8 text-xs text-bear-light">Failed to load sector leaders.</div>
          )}
          {data && data.leaders.length === 0 && (
            <div className="text-center py-8 text-xs text-muted-foreground">No leaders found for this sector right now.</div>
          )}
          {data && data.leaders.length > 0 && (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-card-border">
                  <th className="py-2 pr-2">#</th>
                  <th className="py-2 pr-2">Ticker</th>
                  <th className="py-2 pr-2 text-right">Price</th>
                  <th className="py-2 pr-2 text-right">1D</th>
                  <th className="py-2 pr-2 text-right">1M</th>
                  <th className="py-2 pr-2 text-right">Vol Surge</th>
                  <th className="py-2 pr-2 text-right">Mkt Cap</th>
                  <th className="py-2 pr-1"></th>
                </tr>
              </thead>
              <tbody>
                {data.leaders.map((l, i) => (
                  <tr
                    key={l.ticker}
                    className="border-b border-card-border/40 hover:bg-muted/30 cursor-pointer"
                    onClick={() => goToTicker(l.ticker)}
                    data-testid={`sector-leader-${l.ticker}`}
                  >
                    <td className="py-2 pr-2 text-muted-foreground">{i + 1}</td>
                    <td className="py-2 pr-2">
                      <div className="font-semibold">{l.ticker}</div>
                      <div className="text-micro text-muted-foreground truncate max-w-[180px]">{l.companyName}</div>
                    </td>
                    <td className="py-2 pr-2 text-right tabular-nums">${l.price.toFixed(2)}</td>
                    <td className={`py-2 pr-2 text-right tabular-nums ${l.changePct >= 0 ? "text-bull-light" : "text-bear-light"}`}>
                      {l.changePct >= 0 ? "+" : ""}{l.changePct.toFixed(2)}%
                    </td>
                    <td className={`py-2 pr-2 text-right tabular-nums font-semibold ${l.return1m >= 0 ? "text-bull-light" : "text-bear-light"}`}>
                      {l.return1m >= 0 ? "+" : ""}{l.return1m.toFixed(1)}%
                    </td>
                    <td className={`py-2 pr-2 text-right tabular-nums ${l.volSurge >= 1.5 ? "text-watch-light font-semibold" : "text-muted-foreground"}`}>
                      {l.volSurge.toFixed(2)}x
                    </td>
                    <td className="py-2 pr-2 text-right tabular-nums text-muted-foreground">
                      ${formatCompact(l.marketCap)}
                    </td>
                    <td className="py-2 pr-1">
                      <ArrowRight className="h-3 w-3 text-muted-foreground" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="text-micro text-muted-foreground mt-3 italic">Tip: click any row to open the ticker in Scanner.</p>
        </div>
      </div>
    </div>
  );
}
