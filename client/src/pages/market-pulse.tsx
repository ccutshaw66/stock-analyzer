/**
 * Market Pulse page.
 *
 * Single-screen macro snapshot. Answers: "is the environment hostile,
 * neutral, or favorable for the kind of trade I'm about to make?"
 *
 * No headlines. No talking heads. Just measured market behavior:
 *   - Volatility (VIX + 20d %ile + term structure)
 *   - Breadth (% of S&P 500 above 50/200d MA + new H/L)
 *   - Risk appetite (HYG/LQD, SPY/TLT)
 *   - Major indices (SPY, QQQ, IWM, DIA)
 *   - Safe haven (Gold, Silver, Gold/Silver ratio with regime tag)
 *
 * One headline tier label at top: RISK-OFF / DEFENSIVE / NEUTRAL / RISK-ON / EUPHORIC.
 */

import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { API_MARKET_PULSE } from "@shared/api/endpoints";
import { PageTemplate } from "@/components/PageTemplate";
import { formatCurrency } from "@/lib/format";
import {
  Activity, Loader2, ArrowUpRight, ArrowDownRight,
  Gem, BarChart3, Zap, Compass,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

type RegimeTier = "RISK-OFF" | "DEFENSIVE" | "NEUTRAL" | "RISK-ON" | "EUPHORIC";

interface IndexCard {
  symbol: string;
  name: string;
  price: number | null;
  changePct: number | null;
  above50d: boolean | null;
  above200d: boolean | null;
}

interface MetalCard {
  symbol: string;
  name: string;
  price: number | null;
  changePct: number | null;
}

interface MarketPulse {
  asOf: number;
  breadthAsOf: number;
  marketStatus: "open" | "closed";
  volatility: {
    vix: number | null;
    vixPercentile20d: number | null;
    vix9d: number | null;
    vix3m: number | null;
    termRatio: number | null;
  };
  breadth: {
    pctAbove50d: number | null;
    pctAbove200d: number | null;
    newHighs: number | null;
    newLows: number | null;
    universeSize: number | null;
  };
  riskAppetite: {
    junkInvestmentRatio: number | null;
    junkRising5d: boolean | null;
    stocksBondsRatio: number | null;
    stocksRising5d: boolean | null;
  };
  indices: IndexCard[];
  safeHaven: {
    gold: MetalCard;
    silver: MetalCard;
    goldSilverRatio: number | null;
    ratioRegime: "GOLD CHEAP" | "FAIR" | "SILVER CHEAP" | null;
  };
  regime: { score: number; tier: RegimeTier; explainer: string };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmtNum(v: number | null, digits = 1): string {
  return v == null ? "—" : v.toFixed(digits);
}
function fmtPct(v: number | null, digits = 2): string {
  if (v == null) return "—";
  const s = v >= 0 ? "+" : "";
  return `${s}${v.toFixed(digits)}%`;
}
function pctColor(v: number | null): string {
  if (v == null) return "text-muted-foreground";
  if (v > 0) return "text-bull-light";
  if (v < 0) return "text-bear-light";
  return "text-muted-foreground";
}

// Tier colors: RISK-OFF (bear) → DEFENSIVE (orange) → NEUTRAL (gray) → RISK-ON
// (bull) → EUPHORIC (fuchsia). EUPHORIC switched from `watch` yellow on
// 2026-05-21 — it collided visually with the global Disclaimer bar which
// previously also used watch yellow. Fuchsia keeps the "excess / FOMO peak"
// semantic (over-extended bull, watch for the snap-back) without the clash.
const TIER_STYLE: Record<RegimeTier, { ring: string; text: string; bg: string; sub: string }> = {
  "EUPHORIC":  { ring: "ring-fuchsia-400/40", text: "text-fuchsia-300", bg: "bg-fuchsia-500/10", sub: "text-fuchsia-200/80" },
  "RISK-ON":   { ring: "ring-bull/40",        text: "text-bull-light",  bg: "bg-bull/10",        sub: "text-bull/80" },
  "NEUTRAL":   { ring: "ring-muted/40",       text: "text-foreground",  bg: "bg-muted/10",       sub: "text-muted-foreground" },
  "DEFENSIVE": { ring: "ring-orange-400/40",  text: "text-orange-300",  bg: "bg-orange-500/10",  sub: "text-orange-200/80" },
  "RISK-OFF":  { ring: "ring-bear/40",        text: "text-bear-light",  bg: "bg-bear/10",        sub: "text-bear/80" },
};

function timeAgo(ms: number): string {
  if (!ms) return "—";
  const d = Date.now() - ms;
  if (d < 60_000) return "just now";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} min ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)} hr ago`;
  return `${Math.floor(d / 86_400_000)} d ago`;
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function MarketPulsePage() {
  const { data, isLoading, error } = useQuery<MarketPulse>({
    queryKey: [API_MARKET_PULSE],
    queryFn: async () => {
      const res = await apiRequest("GET", API_MARKET_PULSE);
      return res.json();
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const tier = data?.regime.tier;
  const style = tier ? TIER_STYLE[tier] : null;

  return (
    <PageTemplate
      maxWidth="max-w-5xl"
      icon={Activity}
      title="Market Pulse"
      subtitle="Macro environment at a glance — measured, not narrated."
      howItWorksTitle="How Market Pulse works"
      howItWorks={
        <>
          <p>One sentence at the top: <strong>is the environment hostile, neutral, or favorable</strong> for the trade you're about to make. Computed from price/volume only — no news, no headlines.</p>
          <p><strong className="text-foreground">Volatility</strong> — VIX level, 20-day percentile, and the VIX9D/VIX3M term ratio. Term ratio &gt; 1.0 means the front-month is pricing more fear than the back-month — early stress signal.</p>
          <p><strong className="text-foreground">Breadth</strong> — what % of the S&amp;P 500 is above its 50-day and 200-day moving averages, plus today's new 52-week highs vs. lows. Tells you if a rally is broad or just the megacaps doing all the work.</p>
          <p><strong className="text-foreground">Risk appetite</strong> — HYG/LQD (junk bonds vs. investment grade) and SPY/TLT (stocks vs. long bonds). Rising = risk-on rotation.</p>
          <p><strong className="text-foreground">Major indices</strong> — SPY, QQQ, IWM, DIA with current price, % change, and whether each is above its 50-day and 200-day MA.</p>
          <p><strong className="text-foreground">Safe haven</strong> — Gold, Silver, and the Gold/Silver Ratio with regime tag (&gt;80 silver looks cheap, &lt;60 gold looks cheap, 60-80 fair).</p>
          <p>The headline tier — RISK-OFF / DEFENSIVE / NEUTRAL / RISK-ON / EUPHORIC — is a 0–100 score across these signals. Not a trade signal in itself; context for whatever else you're looking at.</p>
        </>
      }
    >
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : error || !data || !style ? (
        <div className="bg-card border border-card-border rounded-xl p-8 text-center">
          <p className="text-sm text-muted-foreground">Market Pulse cache is warming. Refresh in a few seconds.</p>
        </div>
      ) : (
        <>

      {/* ━━━ HEADLINE TIER ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <section className={`rounded-2xl ${style.bg} ring-1 ${style.ring} p-6 sm:p-8`}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <Compass className="h-4 w-4" />
            <span>Headline</span>
          </div>
          <div className="text-xs text-muted-foreground tabular-nums">
            {data.marketStatus === "open" ? "Live · " : "Market closed · "}
            updated {timeAgo(data.asOf)}
          </div>
        </div>
        <div className={`text-3xl sm:text-4xl font-bold tracking-tight ${style.text}`}>{tier}</div>
        <div className={`mt-2 text-sm sm:text-base ${style.sub}`}>{data.regime.explainer}</div>
        <div className="mt-3 text-xs text-muted-foreground tabular-nums">Regime score: {data.regime.score}/100</div>
      </section>

      {/* ━━━ VOLATILITY · BREADTH · RISK APPETITE ━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Volatility */}
        <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <Zap className="h-4 w-4" />
            <span>Volatility</span>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">VIX</div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-foreground tabular-nums">{fmtNum(data.volatility.vix, 2)}</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {data.volatility.vixPercentile20d != null ? `${data.volatility.vixPercentile20d}th %ile (20d)` : ""}
              </span>
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">Term ratio (VIX9D / VIX3M)</div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-foreground tabular-nums">{fmtNum(data.volatility.termRatio, 2)}</span>
              <span className="text-xs text-muted-foreground">
                {data.volatility.termRatio == null ? "" : data.volatility.termRatio > 1.0 ? "backwardation (stress)" : "contango (calm)"}
              </span>
            </div>
          </div>
        </div>

        {/* Breadth */}
        <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <BarChart3 className="h-4 w-4" />
            <span>Breadth (S&amp;P 500)</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs text-muted-foreground mb-1">&gt; 50-day MA</div>
              <div className="text-2xl font-bold text-foreground tabular-nums">
                {data.breadth.pctAbove50d == null ? "—" : `${data.breadth.pctAbove50d}%`}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">&gt; 200-day MA</div>
              <div className="text-2xl font-bold text-foreground tabular-nums">
                {data.breadth.pctAbove200d == null ? "—" : `${data.breadth.pctAbove200d}%`}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div>
              <div className="text-xs text-muted-foreground mb-1">New 52w highs</div>
              <div className="text-base font-semibold text-bull-light tabular-nums">
                {data.breadth.newHighs == null ? "—" : data.breadth.newHighs}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">New 52w lows</div>
              <div className="text-base font-semibold text-bear-light tabular-nums">
                {data.breadth.newLows == null ? "—" : data.breadth.newLows}
              </div>
            </div>
          </div>
          {data.breadth.universeSize != null && (
            <div className="text-micro text-muted-foreground">
              Across {data.breadth.universeSize} S&amp;P 500 names · refreshed {timeAgo(data.breadthAsOf)}
            </div>
          )}
        </div>

        {/* Risk appetite */}
        <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <Activity className="h-4 w-4" />
            <span>Risk appetite</span>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">Junk / Investment-Grade (HYG/LQD)</div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-foreground tabular-nums">{fmtNum(data.riskAppetite.junkInvestmentRatio, 3)}</span>
              <span className={`text-xs font-semibold ${data.riskAppetite.junkRising5d ? "text-bull-light" : "text-bear-light"}`}>
                {data.riskAppetite.junkRising5d == null ? "" : data.riskAppetite.junkRising5d ? "rising 5d" : "falling 5d"}
              </span>
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">Stocks / Long Bonds (SPY/TLT)</div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-foreground tabular-nums">{fmtNum(data.riskAppetite.stocksBondsRatio, 3)}</span>
              <span className={`text-xs font-semibold ${data.riskAppetite.stocksRising5d ? "text-bull-light" : "text-bear-light"}`}>
                {data.riskAppetite.stocksRising5d == null ? "" : data.riskAppetite.stocksRising5d ? "rising 5d" : "falling 5d"}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ━━━ MAJOR INDICES ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <section className="bg-card border border-card-border rounded-xl overflow-hidden">
        <div className="p-5 pb-3">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <BarChart3 className="h-4 w-4" />
            <span>Major Indices</span>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-card-border">
          {data.indices.map((idx) => (
            <div key={idx.symbol} className="bg-card p-4">
              <div className="flex items-baseline justify-between">
                <div>
                  <div className="text-sm font-bold text-foreground">{idx.symbol}</div>
                  <div className="text-2xs text-muted-foreground">{idx.name}</div>
                </div>
                <div className={`flex items-center gap-1 text-sm font-semibold ${pctColor(idx.changePct)}`}>
                  {idx.changePct != null && (idx.changePct >= 0
                    ? <ArrowUpRight className="h-3.5 w-3.5" />
                    : <ArrowDownRight className="h-3.5 w-3.5" />)}
                  <span className="tabular-nums">{fmtPct(idx.changePct)}</span>
                </div>
              </div>
              <div className="mt-2 text-xl font-bold text-foreground tabular-nums">
                {idx.price == null ? "—" : formatCurrency(idx.price)}
              </div>
              <div className="mt-2 flex items-center gap-3 text-2xs text-muted-foreground">
                <span className={idx.above50d ? "text-bull-light" : idx.above50d === false ? "text-bear-light" : ""}>
                  {idx.above50d == null ? "—" : (idx.above50d ? "✓" : "✗")} 50d
                </span>
                <span className={idx.above200d ? "text-bull-light" : idx.above200d === false ? "text-bear-light" : ""}>
                  {idx.above200d == null ? "—" : (idx.above200d ? "✓" : "✗")} 200d
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ━━━ SAFE HAVEN ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <section className="bg-card border border-card-border rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
          <Gem className="h-4 w-4" />
          <span>Safe Haven</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Gold */}
          <div>
            <div className="text-xs text-muted-foreground mb-1">{data.safeHaven.gold.name}</div>
            <div className="text-2xl font-bold text-foreground tabular-nums">
              {data.safeHaven.gold.price == null ? "—" : formatCurrency(data.safeHaven.gold.price)}
            </div>
            <div className={`text-xs font-semibold mt-1 flex items-center gap-1 ${pctColor(data.safeHaven.gold.changePct)}`}>
              {data.safeHaven.gold.changePct != null && (data.safeHaven.gold.changePct >= 0
                ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />)}
              <span className="tabular-nums">{fmtPct(data.safeHaven.gold.changePct)}</span>
            </div>
          </div>
          {/* Silver */}
          <div>
            <div className="text-xs text-muted-foreground mb-1">{data.safeHaven.silver.name}</div>
            <div className="text-2xl font-bold text-foreground tabular-nums">
              {data.safeHaven.silver.price == null ? "—" : formatCurrency(data.safeHaven.silver.price)}
            </div>
            <div className={`text-xs font-semibold mt-1 flex items-center gap-1 ${pctColor(data.safeHaven.silver.changePct)}`}>
              {data.safeHaven.silver.changePct != null && (data.safeHaven.silver.changePct >= 0
                ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />)}
              <span className="tabular-nums">{fmtPct(data.safeHaven.silver.changePct)}</span>
            </div>
          </div>
          {/* Gold/Silver Ratio */}
          <div>
            <div className="text-xs text-muted-foreground mb-1">Gold / Silver Ratio</div>
            <div className="text-2xl font-bold text-foreground tabular-nums">
              {fmtNum(data.safeHaven.goldSilverRatio, 1)}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {data.safeHaven.ratioRegime ?? "—"}
            </div>
          </div>
        </div>
        <div className="text-micro text-muted-foreground">
          Regime tag: &gt;80 silver looks cheap · 60–80 fair · &lt;60 gold looks cheap.
        </div>
      </section>
        </>
      )}
    </PageTemplate>
  );
}
