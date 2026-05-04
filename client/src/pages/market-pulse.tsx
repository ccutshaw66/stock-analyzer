/**
 * Market Pulse v0.1
 *
 * One-glance answer to "is the market environment hostile, neutral, or
 * favorable for trading right now?" — measured from price/volume only,
 * never narrated. The user gets the verdict in 3 seconds at the top;
 * three groups of numbers below let them verify the headline.
 */
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Disclaimer } from "@/components/Disclaimer";
import { HelpBlock } from "@/components/HelpBlock";
import {
  Activity, TrendingUp, TrendingDown, Minus, ArrowUpRight, ArrowDownRight,
  Loader2,
} from "lucide-react";

// ─── Types (mirror MarketPulse from the server adapter) ────────────────────
interface VolatilityMetrics {
  vix: number | null;
  vixPercentile20d: number | null;
  vix9d: number | null;
  vix3m: number | null;
  vixTermRatio: number | null;
}
interface BreadthMetrics {
  pctAbove50dma: number | null;
  pctAbove200dma: number | null;
  newHighs: number | null;
  newLows: number | null;
  universeSize: number | null;
}
interface RiskAppetiteMetrics {
  hygLqdRatio: number | null;
  hygLqdDirection: "rising" | "falling" | "flat" | null;
  spyTltRatio: number | null;
  spyTltDirection: "rising" | "falling" | "flat" | null;
}
interface IndexCardData {
  symbol: string;
  price: number | null;
  changePct: number | null;
  above50dma: boolean | null;
  above200dma: boolean | null;
}
type RegimeTier = "EUPHORIC" | "RISK_ON" | "NEUTRAL" | "DEFENSIVE" | "RISK_OFF";
interface RegimeVerdict {
  score: number;
  tier: RegimeTier;
  headline: string;
  contributors: string[];
}
interface MarketPulse {
  asOf: number;
  marketOpen: boolean;
  volatility: VolatilityMetrics;
  breadth: BreadthMetrics;
  riskAppetite: RiskAppetiteMetrics;
  indices: IndexCardData[];
  regime: RegimeVerdict;
}

// ─── Tier styling ─────────────────────────────────────────────────────────
const TIER_LABEL: Record<RegimeTier, string> = {
  EUPHORIC:  "EUPHORIC",
  RISK_ON:   "RISK-ON",
  NEUTRAL:   "NEUTRAL",
  DEFENSIVE: "DEFENSIVE",
  RISK_OFF:  "RISK-OFF",
};
const TIER_BG: Record<RegimeTier, string> = {
  EUPHORIC:  "bg-yellow-500/15 border-yellow-500/30 text-yellow-400",
  RISK_ON:   "bg-green-500/15 border-green-500/30 text-green-400",
  NEUTRAL:   "bg-muted/30 border-card-border text-foreground",
  DEFENSIVE: "bg-orange-500/15 border-orange-500/30 text-orange-400",
  RISK_OFF:  "bg-red-500/15 border-red-500/30 text-red-400",
};

// ─── Helpers ──────────────────────────────────────────────────────────────
function dash(v: number | null | undefined, digits = 2): string {
  if (v == null || isNaN(v)) return "—";
  return v.toFixed(digits);
}
function pctOrDash(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return "—";
  return `${v.toFixed(0)}%`;
}
function moneyOrDash(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return "—";
  return `$${v.toFixed(2)}`;
}
function signedPctOrDash(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
}
function ago(ts: number): string {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

function DirectionIcon({ d }: { d: RiskAppetiteMetrics["hygLqdDirection"] }) {
  if (d === "rising")  return <ArrowUpRight className="h-3 w-3 text-green-400 inline" />;
  if (d === "falling") return <ArrowDownRight className="h-3 w-3 text-red-400 inline" />;
  return <Minus className="h-3 w-3 text-muted-foreground inline" />;
}

// ─── Reusable small cells ─────────────────────────────────────────────────
function MetricBlock({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold text-foreground tabular-nums leading-tight mt-1">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────
export default function MarketPulse() {
  const { data, isLoading, error } = useQuery<MarketPulse>({
    queryKey: ["/api/market-pulse"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/market-pulse");
      return res.json();
    },
    refetchInterval: 60_000, // 60s while page is open
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto px-3 sm:px-4 py-4 sm:py-6">
        <div className="flex flex-col items-center gap-3 py-24">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading Market Pulse…</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-5xl mx-auto px-3 sm:px-4 py-4 sm:py-6">
        <div className="bg-card border border-red-500/30 rounded-xl p-6 text-center">
          <p className="text-red-400 font-semibold">Could not load Market Pulse</p>
          <p className="text-xs text-muted-foreground mt-2">{(error as any)?.message || "The intraday cron may not have populated the cache yet. Try again in ~30 seconds."}</p>
        </div>
      </div>
    );
  }

  const tierClasses = TIER_BG[data.regime.tier];
  const updatedLabel = data.marketOpen ? `Updated ${ago(data.asOf)}` : `Market closed — last close ${ago(data.asOf)}`;

  const v = data.volatility;
  const b = data.breadth;
  const r = data.riskAppetite;

  return (
    <div className="max-w-5xl mx-auto px-3 sm:px-4 py-4 sm:py-6 space-y-5" data-testid="market-pulse-page">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            Market Pulse
          </h1>
          <p className="text-xs text-muted-foreground">
            Is the market environment hostile, neutral, or favorable for trading right now?
            Measured from price/volume — no narrative.
          </p>
          <Disclaimer />
        </div>
        <div className="text-[11px] text-muted-foreground">{updatedLabel}</div>
      </div>

      {/* Methodology — at the top so users can read it before scrolling */}
      <HelpBlock title="How the regime score works">
        <p>
          The score combines three independent signal groups — <strong className="text-foreground">volatility</strong>,
          <strong className="text-foreground"> breadth</strong>, and <strong className="text-foreground">risk appetite</strong> —
          into a single 0-100 number. No news, no narrative, no editorial. Just measured market behavior.
        </p>
        <ul className="list-disc pl-5 mt-2 space-y-1">
          <li><strong className="text-foreground">Volatility:</strong> VIX level + 20-day percentile + VIX9D/VIX3M term structure.
            Low fear and contango (front month below back month) lift the score; elevated VIX or backwardation drag it.</li>
          <li><strong className="text-foreground">Breadth:</strong> percent of the S&P 500 trading above their 50-day and 200-day
            moving averages, plus 52-week high/low counts. Broad participation lifts; narrow leadership drags.</li>
          <li><strong className="text-foreground">Risk Appetite:</strong> HYG (junk bonds) vs LQD (investment grade)
            and SPY vs TLT (long bonds). Junk leading IG = investors reaching for yield = risk-on.</li>
        </ul>
        <p className="mt-2">
          <strong className="text-foreground">Tier mapping:</strong> 80+ Euphoric · 60-79 Risk-On · 40-59 Neutral ·
          20-39 Defensive · &lt;20 Risk-Off. Updated every 5 minutes during market hours; breadth refreshes once daily.
        </p>
      </HelpBlock>

      {/* Verdict pill */}
      <div className={`rounded-xl border p-5 ${tierClasses}`}>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="text-xs uppercase tracking-wider opacity-80">Regime</div>
            <div className="text-3xl font-bold mt-1 tabular-nums">{TIER_LABEL[data.regime.tier]}</div>
            <div className="text-sm mt-2 opacity-90">{data.regime.headline}</div>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-wider opacity-80">Score</div>
            <div className="text-4xl font-bold tabular-nums mt-1">{data.regime.score}</div>
            <div className="text-[11px] opacity-70">/ 100</div>
          </div>
        </div>
      </div>

      {/* Three metric groups */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Volatility */}
        <div className="bg-card border border-card-border rounded-xl p-4 space-y-4">
          <div className="text-sm font-semibold text-foreground">Volatility</div>
          <MetricBlock
            label="VIX"
            value={dash(v.vix, 2)}
            sub={v.vixPercentile20d !== null ? `${v.vixPercentile20d.toFixed(0)}th %ile (20d)` : "—"}
          />
          <MetricBlock
            label="VIX Term"
            value={v.vixTermRatio !== null ? (v.vixTermRatio < 1 ? "Contango" : "Backwardation") : "—"}
            sub={v.vixTermRatio !== null ? `VIX9D / VIX3M = ${v.vixTermRatio.toFixed(2)}` : "—"}
          />
        </div>

        {/* Breadth */}
        <div className="bg-card border border-card-border rounded-xl p-4 space-y-4">
          <div className="text-sm font-semibold text-foreground">Breadth (S&P 500)</div>
          <div className="grid grid-cols-2 gap-2">
            <MetricBlock label="> 50d MA" value={pctOrDash(b.pctAbove50dma)} />
            <MetricBlock label="> 200d MA" value={pctOrDash(b.pctAbove200dma)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <MetricBlock label="New Highs" value={b.newHighs ?? "—"} sub="52-week" />
            <MetricBlock label="New Lows" value={b.newLows ?? "—"} sub="52-week" />
          </div>
          {b.universeSize !== null && b.universeSize > 0 && (
            <div className="text-[10px] text-muted-foreground">Sample: {b.universeSize} tickers</div>
          )}
        </div>

        {/* Risk Appetite */}
        <div className="bg-card border border-card-border rounded-xl p-4 space-y-4">
          <div className="text-sm font-semibold text-foreground">Risk Appetite</div>
          <MetricBlock
            label="Junk / IG"
            value={
              <span>
                {dash(r.hygLqdRatio, 2)} <DirectionIcon d={r.hygLqdDirection} />
              </span>
            }
            sub={`HYG / LQD · ${r.hygLqdDirection ?? "—"}`}
          />
          <MetricBlock
            label="Stocks / Bonds"
            value={
              <span>
                {dash(r.spyTltRatio, 2)} <DirectionIcon d={r.spyTltDirection} />
              </span>
            }
            sub={`SPY / TLT · ${r.spyTltDirection ?? "—"}`}
          />
        </div>
      </div>

      {/* Major Indices */}
      <div className="bg-card border border-card-border rounded-xl p-4">
        <div className="text-sm font-semibold text-foreground mb-3">Major Indices</div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {data.indices.map((idx) => (
            <div key={idx.symbol} className="bg-muted/20 border border-card-border rounded-lg p-3">
              <div className="flex items-center justify-between mb-1">
                <div className="font-mono font-bold text-foreground">{idx.symbol}</div>
                <div className={`text-xs font-semibold tabular-nums ${idx.changePct == null ? "text-muted-foreground" : idx.changePct >= 0 ? "text-green-400" : "text-red-400"}`}>
                  {signedPctOrDash(idx.changePct)}
                </div>
              </div>
              <div className="text-xl font-bold text-foreground tabular-nums mb-2">{moneyOrDash(idx.price)}</div>
              <div className="flex items-center gap-2 text-[11px]">
                <span className={idx.above50dma === null ? "text-muted-foreground" : idx.above50dma ? "text-green-400" : "text-red-400"}>
                  {idx.above50dma === null ? "—" : idx.above50dma ? "✓" : "✗"} 50d
                </span>
                <span className={idx.above200dma === null ? "text-muted-foreground" : idx.above200dma ? "text-green-400" : "text-red-400"}>
                  {idx.above200dma === null ? "—" : idx.above200dma ? "✓" : "✗"} 200d
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Contributors */}
      {data.regime.contributors.length > 0 && (
        <div className="bg-card border border-card-border rounded-xl p-4">
          <div className="text-sm font-semibold text-foreground mb-2">What's moving the score</div>
          <div className="flex flex-wrap gap-2">
            {data.regime.contributors.map((c, i) => (
              <span key={i} className={`text-xs px-2 py-1 rounded-md ${c.startsWith("+") ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"}`}>
                {c}
              </span>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
