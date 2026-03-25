import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useTicker } from "@/contexts/TickerContext";
import { formatCurrency, formatCompact } from "@/lib/format";
import {
  Shield, TrendingUp, TrendingDown, Activity, BarChart3,
  Zap, AlertTriangle, Gem, DollarSign, Target,
  ArrowUpRight, ArrowDownRight, Minus, Loader2,
  FlaskConical, Building2, UserCheck, LineChart
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Factor {
  name: string;
  score: number;
  weight: number;
  signal: string;
  color: string;
}

interface ScoringItem {
  name: string;
  score: number;
  weight: number;
  reasoning: string;
}

interface Analysis {
  score: number;
  verdict: string;
  scoring: ScoringItem[];
}

interface Institutional {
  flowScore: number;
  signal: string;
  institutionPct: number;
  insiderPct: number;
  instIncreased: number;
  instDecreased: number;
  insiderBuyCount: number;
  insiderSellCount: number;
}

interface StressTest {
  name: string;
  desc: string;
  period: string;
  ticker: number;
  spy: number;
  gold: number;
  silver: number;
}

interface MetalData {
  price: number;
  change: number;
  name: string;
}

interface VerdictData {
  ticker: string;
  companyName: string;
  price: number;
  marketCap: number;
  unifiedScore: number;
  finalVerdict: string;
  verdictColor: string;
  factors: Factor[];
  analysis: Analysis | null;
  institutional: Institutional | null;
  strategies: null;
  stressTests: StressTest[];
  metals: {
    gold: MetalData;
    silver: MetalData;
    spy: MetalData;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ringColorClass(score: number): string {
  if (score >= 70) return "text-green-400";
  if (score >= 40) return "text-yellow-400";
  return "text-red-400";
}

function ringStrokeColor(score: number): string {
  if (score >= 70) return "#4ade80";
  if (score >= 40) return "#facc15";
  return "#f87171";
}

function ringGlowColor(score: number): string {
  if (score >= 70) return "rgba(74, 222, 128, 0.3)";
  if (score >= 40) return "rgba(250, 204, 21, 0.25)";
  return "rgba(248, 113, 113, 0.3)";
}

function barColor(color: string): string {
  switch (color) {
    case "green": return "bg-green-400";
    case "red": return "bg-red-400";
    case "yellow": return "bg-yellow-400";
    default: return "bg-muted-foreground";
  }
}

function barTrackColor(color: string): string {
  switch (color) {
    case "green": return "bg-green-400/15";
    case "red": return "bg-red-400/15";
    case "yellow": return "bg-yellow-400/15";
    default: return "bg-muted/40";
  }
}

function signalBadgeColor(color: string): string {
  switch (color) {
    case "green": return "bg-green-500/15 text-green-400 border border-green-500/20";
    case "red": return "bg-red-500/15 text-red-400 border border-red-500/20";
    case "yellow": return "bg-yellow-500/15 text-yellow-400 border border-yellow-500/20";
    default: return "bg-muted text-muted-foreground border border-card-border";
  }
}

function verdictBadgeStyle(verdict: string): string {
  switch (verdict) {
    case "STRONG BUY": return "bg-green-500/20 text-green-400 border-green-500/30";
    case "BUY": return "bg-green-500/15 text-green-400 border-green-500/20";
    case "HOLD": return "bg-yellow-500/15 text-yellow-400 border-yellow-500/20";
    case "CAUTIOUS": return "bg-red-500/15 text-red-400 border-red-500/20";
    case "AVOID": return "bg-red-500/20 text-red-400 border-red-500/30";
    default: return "bg-muted text-muted-foreground border-card-border";
  }
}

function pctColor(val: number): string {
  if (val > 0) return "text-green-400";
  if (val < 0) return "text-red-400";
  return "text-muted-foreground";
}

function formatPct(val: number): string {
  const sign = val > 0 ? "+" : "";
  return `${sign}${val.toFixed(1)}%`;
}

function factorIcon(name: string) {
  const lower = name.toLowerCase();
  if (lower.includes("fundamental")) return <BarChart3 className="h-4 w-4" />;
  if (lower.includes("institutional")) return <Building2 className="h-4 w-4" />;
  if (lower.includes("strateg")) return <Target className="h-4 w-4" />;
  if (lower.includes("stress")) return <FlaskConical className="h-4 w-4" />;
  if (lower.includes("insider")) return <UserCheck className="h-4 w-4" />;
  return <Activity className="h-4 w-4" />;
}

// ─── SVG Ring Gauge ───────────────────────────────────────────────────────────

function ScoreRing({ score, size = 220, strokeWidth = 14 }: { score: number; size?: number; strokeWidth?: number }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  const offset = circumference * (1 - pct);
  const center = size / 2;
  const color = ringStrokeColor(score);
  const glow = ringGlowColor(score);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="drop-shadow-lg">
      <defs>
        <filter id="ring-glow">
          <feGaussianBlur stdDeviation="6" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <linearGradient id="ring-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={color} stopOpacity="1" />
          <stop offset="100%" stopColor={color} stopOpacity="0.6" />
        </linearGradient>
      </defs>

      {/* Background track */}
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        className="text-muted/30"
      />

      {/* Glow underneath */}
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke={glow}
        strokeWidth={strokeWidth + 8}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${center} ${center})`}
        style={{ transition: "stroke-dashoffset 1.5s ease-out" }}
      />

      {/* Main arc */}
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke="url(#ring-grad)"
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${center} ${center})`}
        filter="url(#ring-glow)"
        style={{ transition: "stroke-dashoffset 1.5s ease-out" }}
      />

      {/* Tick marks at 25, 50, 75 */}
      {[25, 50, 75].map((tick) => {
        const angle = (tick / 100) * 360 - 90;
        const rad = (angle * Math.PI) / 180;
        const innerR = radius - strokeWidth / 2 - 4;
        const outerR = radius + strokeWidth / 2 + 4;
        return (
          <line
            key={tick}
            x1={center + innerR * Math.cos(rad)}
            y1={center + innerR * Math.sin(rad)}
            x2={center + outerR * Math.cos(rad)}
            y2={center + outerR * Math.sin(rad)}
            stroke="currentColor"
            strokeWidth="1"
            className="text-muted-foreground/30"
          />
        );
      })}
    </svg>
  );
}

// ─── Loading Skeleton ─────────────────────────────────────────────────────────

function VerdictSkeleton() {
  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6 animate-pulse">
      {/* Hero skeleton */}
      <div className="bg-card border border-card-border rounded-xl p-8">
        <div className="flex flex-col items-center gap-4">
          <div className="w-[220px] h-[220px] rounded-full bg-muted/40" />
          <div className="h-6 w-48 bg-muted/40 rounded" />
          <div className="flex gap-6">
            <div className="h-4 w-24 bg-muted/40 rounded" />
            <div className="h-4 w-24 bg-muted/40 rounded" />
            <div className="h-4 w-28 bg-muted/40 rounded" />
          </div>
        </div>
      </div>

      {/* Factor bars skeleton */}
      <div className="bg-card border border-card-border rounded-xl p-6 space-y-5">
        <div className="h-5 w-40 bg-muted/40 rounded" />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <div className="flex justify-between">
              <div className="h-4 w-36 bg-muted/40 rounded" />
              <div className="h-4 w-16 bg-muted/40 rounded" />
            </div>
            <div className="h-3 w-full bg-muted/40 rounded-full" />
          </div>
        ))}
      </div>

      {/* Table skeleton */}
      <div className="bg-card border border-card-border rounded-xl p-6 space-y-3">
        <div className="h-5 w-48 bg-muted/40 rounded" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-10 w-full bg-muted/40 rounded" />
        ))}
      </div>

      {/* Metals skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bg-card border border-card-border rounded-xl p-5 space-y-3">
            <div className="h-4 w-20 bg-muted/40 rounded" />
            <div className="h-8 w-28 bg-muted/40 rounded" />
            <div className="h-4 w-16 bg-muted/40 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Verdict() {
  const { activeTicker } = useTicker();

  const { data, isLoading, error } = useQuery<VerdictData>({
    queryKey: ["/api/verdict", activeTicker],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/verdict/${activeTicker}`);
      return res.json();
    },
    enabled: !!activeTicker,
    retry: 1,
    staleTime: 5 * 60 * 1000,
  });

  // ─── Empty state ──────────────────────────────────────────────────────────
  if (!activeTicker) {
    return (
      <div data-testid="verdict-page" className="max-w-5xl mx-auto px-4 py-6">
        <div className="text-center py-24 text-muted-foreground">
          <Shield className="h-16 w-16 mx-auto mb-4 opacity-20" />
          <p className="text-lg font-medium">Search a ticker to generate a research verdict</p>
          <p className="text-sm mt-1 opacity-60">Unified analysis combining fundamentals, flow, stress tests &amp; more</p>
        </div>
      </div>
    );
  }

  // ─── Loading ──────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div data-testid="verdict-page">
        <div className="max-w-5xl mx-auto px-4 pt-4 pb-2">
          <div className="flex items-center gap-3 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm font-medium">
              Building unified verdict for <span className="text-foreground font-bold">{activeTicker}</span> — this may take 10-15 seconds…
            </span>
          </div>
        </div>
        <VerdictSkeleton />
      </div>
    );
  }

  // ─── Error ────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div data-testid="verdict-page" className="max-w-5xl mx-auto px-4 py-6">
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-6 text-center">
          <AlertTriangle className="h-8 w-8 mx-auto mb-3 text-red-400" />
          <p className="text-red-400 font-medium">{(error as Error).message || "Failed to generate verdict. Please try again."}</p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const sortedFactors = [...data.factors].sort((a, b) => b.weight - a.weight);
  const goldSilverRatio = data.metals.silver.price > 0 ? (data.metals.gold.price / data.metals.silver.price) : 0;

  return (
    <div data-testid="verdict-page" className="max-w-5xl mx-auto px-4 py-6 space-y-6">

      {/* ━━━ 1. UNIFIED VERDICT RING (Hero) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <section className="bg-card border border-card-border rounded-xl overflow-hidden">
        {/* Gradient header accent */}
        <div
          className="h-1"
          style={{
            background: `linear-gradient(90deg, ${ringStrokeColor(data.unifiedScore)}44, ${ringStrokeColor(data.unifiedScore)}, ${ringStrokeColor(data.unifiedScore)}44)`,
          }}
        />

        <div className="flex flex-col items-center py-10 px-6">
          {/* Ring */}
          <div className="relative">
            <ScoreRing score={data.unifiedScore} size={220} strokeWidth={14} />

            {/* Center text overlay */}
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className={`text-5xl font-black tabular-nums leading-none ${ringColorClass(data.unifiedScore)}`}>
                {data.unifiedScore}
              </span>
              <span className="text-xs text-muted-foreground mt-1 tracking-widest uppercase">/ 100</span>
            </div>
          </div>

          {/* Verdict badge */}
          <div className={`mt-5 px-5 py-1.5 rounded-full border text-sm font-bold tracking-wider uppercase ${verdictBadgeStyle(data.finalVerdict)}`}>
            {data.finalVerdict}
          </div>

          {/* Company info */}
          <h2 className="mt-4 text-lg font-semibold text-foreground">{data.companyName}</h2>
          <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <DollarSign className="h-3.5 w-3.5" />
              {formatCurrency(data.price)}
            </span>
            <span className="text-card-border">|</span>
            <span>MCap {formatCompact(data.marketCap)}</span>
            <span className="text-card-border">|</span>
            <span className="font-mono font-bold text-foreground">{data.ticker}</span>
          </div>
        </div>
      </section>

      {/* ━━━ 2. FACTOR BREAKDOWN ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <section className="bg-card border border-card-border rounded-xl p-6">
        <div className="flex items-center gap-2 mb-6">
          <BarChart3 className="h-5 w-5 text-muted-foreground" />
          <h3 className="text-base font-semibold text-foreground">Factor Breakdown</h3>
        </div>

        <div className="space-y-5">
          {sortedFactors.map((factor) => (
            <div key={factor.name}>
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">{factorIcon(factor.name)}</span>
                  <span className="text-sm font-medium text-foreground">{factor.name}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md uppercase ${signalBadgeColor(factor.color)}`}>
                    {factor.signal}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums w-10 text-right">
                    {(factor.weight * 100).toFixed(0)}% wt
                  </span>
                  <span className={`text-sm font-bold tabular-nums w-8 text-right ${
                    factor.score >= 70 ? "text-green-400" : factor.score >= 40 ? "text-yellow-400" : "text-red-400"
                  }`}>
                    {factor.score}
                  </span>
                </div>
              </div>

              {/* Bar */}
              <div className={`h-2.5 rounded-full overflow-hidden ${barTrackColor(factor.color)}`}>
                <div
                  className={`h-full rounded-full ${barColor(factor.color)} transition-all duration-1000 ease-out`}
                  style={{ width: `${Math.max(2, factor.score)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ━━━ 3. STRESS TEST COMPARISON TABLE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {data.stressTests && data.stressTests.length > 0 && (
        <section className="bg-card border border-card-border rounded-xl overflow-hidden">
          <div className="p-6 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <FlaskConical className="h-5 w-5 text-muted-foreground" />
              <h3 className="text-base font-semibold text-foreground">Stress Test Comparison</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              How {data.ticker} performed vs. S&amp;P 500, Gold, and Silver during major historical events
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-t border-b border-card-border text-muted-foreground">
                  <th className="text-left py-2.5 px-6 font-semibold">Event</th>
                  <th className="text-left py-2.5 px-3 font-semibold">Period</th>
                  <th className="text-right py-2.5 px-3 font-semibold">{data.ticker}</th>
                  <th className="text-right py-2.5 px-3 font-semibold">S&amp;P 500</th>
                  <th className="text-right py-2.5 px-3 font-semibold">Gold</th>
                  <th className="text-right py-2.5 px-6 font-semibold">Silver</th>
                </tr>
              </thead>
              <tbody>
                {data.stressTests.map((test, i) => {
                  const beatSpy = test.ticker > test.spy;
                  return (
                    <tr
                      key={i}
                      className={`border-b border-card-border/40 transition-colors ${
                        beatSpy ? "bg-green-500/[0.04]" : "hover:bg-muted/20"
                      }`}
                      title={test.desc}
                    >
                      <td className="py-2.5 px-6">
                        <div className="font-semibold text-foreground">{test.name}</div>
                      </td>
                      <td className="py-2.5 px-3 text-muted-foreground whitespace-nowrap">{test.period}</td>
                      <td className={`py-2.5 px-3 text-right font-bold tabular-nums ${pctColor(test.ticker)}`}>
                        {formatPct(test.ticker)}
                      </td>
                      <td className={`py-2.5 px-3 text-right tabular-nums ${pctColor(test.spy)}`}>
                        {formatPct(test.spy)}
                      </td>
                      <td className={`py-2.5 px-3 text-right tabular-nums ${pctColor(test.gold)}`}>
                        {formatPct(test.gold)}
                      </td>
                      <td className={`py-2.5 px-6 text-right tabular-nums ${pctColor(test.silver)}`}>
                        {formatPct(test.silver)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="px-6 py-2.5 border-t border-card-border/40 text-[10px] text-muted-foreground flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-sm bg-green-500/[0.08] border border-green-500/20" />
            <span>Highlighted rows indicate {data.ticker} outperformed the S&amp;P 500</span>
          </div>
        </section>
      )}

      {/* ━━━ 4. METALS DASHBOARD ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {data.metals && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Gem className="h-5 w-5 text-muted-foreground" />
            <h3 className="text-base font-semibold text-foreground">Safe Haven &amp; Benchmark Comparison</h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Gold */}
            <div className="bg-card border border-card-border rounded-xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-lg bg-yellow-500/15 flex items-center justify-center">
                  <Gem className="h-4 w-4 text-yellow-400" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{data.metals.gold.name}</p>
                </div>
              </div>
              <p className="text-2xl font-bold text-foreground tabular-nums">{formatCurrency(data.metals.gold.price)}</p>
              <div className={`flex items-center gap-1 mt-1 text-sm font-semibold ${pctColor(data.metals.gold.change)}`}>
                {data.metals.gold.change >= 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
                <span className="tabular-nums">{formatPct(data.metals.gold.change)}</span>
                <span className="text-xs text-muted-foreground font-normal ml-1">today</span>
              </div>
            </div>

            {/* Silver */}
            <div className="bg-card border border-card-border rounded-xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-lg bg-gray-400/15 flex items-center justify-center">
                  <Gem className="h-4 w-4 text-gray-400" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{data.metals.silver.name}</p>
                </div>
              </div>
              <p className="text-2xl font-bold text-foreground tabular-nums">{formatCurrency(data.metals.silver.price)}</p>
              <div className={`flex items-center gap-1 mt-1 text-sm font-semibold ${pctColor(data.metals.silver.change)}`}>
                {data.metals.silver.change >= 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
                <span className="tabular-nums">{formatPct(data.metals.silver.change)}</span>
                <span className="text-xs text-muted-foreground font-normal ml-1">today</span>
              </div>
            </div>

            {/* S&P 500 */}
            <div className="bg-card border border-card-border rounded-xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-lg bg-blue-500/15 flex items-center justify-center">
                  <LineChart className="h-4 w-4 text-blue-400" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{data.metals.spy.name}</p>
                </div>
              </div>
              <p className="text-2xl font-bold text-foreground tabular-nums">{formatCurrency(data.metals.spy.price)}</p>
              <div className={`flex items-center gap-1 mt-1 text-sm font-semibold ${pctColor(data.metals.spy.change)}`}>
                {data.metals.spy.change >= 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
                <span className="tabular-nums">{formatPct(data.metals.spy.change)}</span>
                <span className="text-xs text-muted-foreground font-normal ml-1">today</span>
              </div>
            </div>
          </div>

          {/* Gold / Silver Ratio + Note */}
          <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6 px-1">
            {goldSilverRatio > 0 && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Gold / Silver Ratio:</span>
                <span className="font-bold text-foreground tabular-nums">{goldSilverRatio.toFixed(1)}</span>
              </div>
            )}
            <p className="text-xs text-muted-foreground leading-relaxed">
              Gold and silver serve as traditional safe-haven hedges. When equities decline, precious metals often hold value or appreciate, providing portfolio resilience.
            </p>
          </div>
        </section>
      )}

      {/* ━━━ 5. COMPONENT SCORES ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {(data.analysis || data.institutional) && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Zap className="h-5 w-5 text-muted-foreground" />
            <h3 className="text-base font-semibold text-foreground">Component Scores</h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Fundamental Analysis */}
            {data.analysis && (
              <div className="bg-card border border-card-border rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <BarChart3 className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-semibold text-foreground">Fundamental Analysis</span>
                  </div>
                  <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-md border uppercase ${
                    data.analysis.verdict === "YES"
                      ? "bg-green-500/15 text-green-400 border-green-500/20"
                      : data.analysis.verdict === "NO"
                      ? "bg-red-500/15 text-red-400 border-red-500/20"
                      : "bg-yellow-500/15 text-yellow-400 border-yellow-500/20"
                  }`}>
                    {data.analysis.verdict}
                  </span>
                </div>

                {/* Score display */}
                <div className="flex items-end gap-1.5 mb-4">
                  <span className={`text-4xl font-black tabular-nums leading-none ${
                    data.analysis.score >= 7 ? "text-green-400" : data.analysis.score >= 5 ? "text-yellow-400" : "text-red-400"
                  }`}>
                    {typeof data.analysis.score === 'number' ? data.analysis.score.toFixed(2) : data.analysis.score}
                  </span>
                  <span className="text-sm text-muted-foreground mb-0.5">/ 10</span>
                </div>

                {/* Mini scoring breakdown */}
                {data.analysis.scoring && data.analysis.scoring.length > 0 && (
                  <div className="space-y-2 border-t border-card-border pt-3">
                    {data.analysis.scoring.slice(0, 5).map((item, i) => (
                      <div key={i} className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground truncate mr-3">{item.name}</span>
                        <span className={`font-bold tabular-nums ${
                          item.score >= 7 ? "text-green-400" : item.score >= 5 ? "text-yellow-400" : "text-red-400"
                        }`}>
                          {item.score}/10
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Institutional Flow */}
            {data.institutional && (
              <div className="bg-card border border-card-border rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-semibold text-foreground">Institutional Flow</span>
                  </div>
                  <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-md border uppercase ${
                    data.institutional.signal.includes("INFLOW") || data.institutional.signal === "ACCUMULATING"
                      ? "bg-green-500/15 text-green-400 border-green-500/20"
                      : data.institutional.signal.includes("OUTFLOW") || data.institutional.signal === "DISTRIBUTING"
                      ? "bg-red-500/15 text-red-400 border-red-500/20"
                      : "bg-yellow-500/15 text-yellow-400 border-yellow-500/20"
                  }`}>
                    {data.institutional.signal}
                  </span>
                </div>

                {/* Flow Score */}
                <div className="flex items-end gap-1.5 mb-4">
                  <span className={`text-4xl font-black tabular-nums leading-none ${
                    data.institutional.flowScore >= 20 ? "text-green-400"
                    : data.institutional.flowScore <= -20 ? "text-red-400"
                    : "text-yellow-400"
                  }`}>
                    {data.institutional.flowScore > 0 ? "+" : ""}{data.institutional.flowScore}
                  </span>
                  <span className="text-sm text-muted-foreground mb-0.5">flow score</span>
                </div>

                {/* Quick stats */}
                <div className="grid grid-cols-2 gap-3 border-t border-card-border pt-3">
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Institutional %</p>
                    <p className="text-sm font-bold text-foreground tabular-nums">{data.institutional.institutionPct.toFixed(1)}%</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Insider %</p>
                    <p className="text-sm font-bold text-foreground tabular-nums">{data.institutional.insiderPct.toFixed(1)}%</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Inst. Increasing</p>
                    <p className="text-sm font-bold text-green-400 tabular-nums">{data.institutional.instIncreased}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Inst. Decreasing</p>
                    <p className="text-sm font-bold text-red-400 tabular-nums">{data.institutional.instDecreased}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Insider Buys</p>
                    <p className="text-sm font-bold text-green-400 tabular-nums">{data.institutional.insiderBuyCount}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Insider Sells</p>
                    <p className="text-sm font-bold text-red-400 tabular-nums">{data.institutional.insiderSellCount}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
