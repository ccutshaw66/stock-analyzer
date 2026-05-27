import { useQuery } from "@tanstack/react-query";
import {
  SIGNAL_BULL_LIGHT,
  SIGNAL_BEAR_LIGHT,
  SIGNAL_WATCH_LIGHT,
  OVERLAY_BULL_30,
  OVERLAY_WATCH_25,
  OVERLAY_BEAR_30,
} from "@/lib/design-tokens";
import { apiRequest } from "@/lib/queryClient";
import { useTicker } from "@/contexts/TickerContext";
import { formatCurrency, formatCompact } from "@/lib/format";
import { LimitReached } from "@/components/LimitReached";
import InvalidSymbol, { isSymbolNotFound } from "@/components/InvalidSymbol";
import { useSubscription } from "@/hooks/useSubscription";
import { PageTemplate } from "@/components/PageTemplate";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import {
  Shield, TrendingUp, TrendingDown, Activity, BarChart3,
  Zap, AlertTriangle, DollarSign, Target,
  ArrowUpRight, ArrowDownRight, Minus, Loader2,
  FlaskConical, Building2, UserCheck, LineChart, Scale, Award
} from "lucide-react";
import { Example, ScoreRange } from "@/components/HelpBlock";

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
  nasdaq?: number;
  gold: number;
  silver: number;
  hasData?: boolean;
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
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ringColorClass(score: number): string {
  if (score >= 70) return "text-bull-light";
  if (score >= 40) return "text-watch-light";
  return "text-bear-light";
}

function ringStrokeColor(score: number): string {
  if (score >= 70) return SIGNAL_BULL_LIGHT;
  if (score >= 40) return SIGNAL_WATCH_LIGHT;
  return SIGNAL_BEAR_LIGHT;
}

function ringGlowColor(score: number): string {
  if (score >= 70) return OVERLAY_BULL_30;
  if (score >= 40) return OVERLAY_WATCH_25;
  return OVERLAY_BEAR_30;
}

function barColor(color: string): string {
  switch (color) {
    case "green": return "bg-bull-light";
    case "red": return "bg-bear-light";
    case "yellow": return "bg-watch-light";
    default: return "bg-muted-foreground";
  }
}

function barTrackColor(color: string): string {
  switch (color) {
    case "green": return "bg-bull-light/15";
    case "red": return "bg-bear-light/15";
    case "yellow": return "bg-watch-light/15";
    default: return "bg-muted/40";
  }
}

function signalBadgeColor(color: string): string {
  switch (color) {
    case "green": return "bg-bull/15 text-bull-light border border-bull/20";
    case "red": return "bg-bear/15 text-bear-light border border-bear/20";
    case "yellow": return "bg-watch/15 text-watch-light border border-watch/20";
    default: return "bg-muted text-muted-foreground border border-card-border";
  }
}

function verdictBadgeStyle(verdict: string): string {
  switch (verdict) {
    case "STRONG CONVICTION": return "bg-bull/20 text-bull-light border-bull/30";
    case "INVESTMENT GRADE": return "bg-bull/15 text-bull-light border-bull/20";
    case "SPECULATIVE": return "bg-watch/15 text-watch-light border-watch/20";
    case "HIGH RISK": return "bg-bear/20 text-bear-light border-bear/30";
    default: return "bg-muted text-muted-foreground border-card-border";
  }
}

function pctColor(val: number | null | undefined): string {
  if (val == null) return "text-muted-foreground";
  if (val > 0) return "text-bull-light";
  if (val < 0) return "text-bear-light";
  return "text-muted-foreground";
}

function formatPct(val: number | null | undefined): string {
  if (val == null || isNaN(val)) return "N/A";
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
    <div className="space-y-6 animate-pulse">
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
  const { isAnalysisExhausted } = useSubscription();

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

  // ─── Limit reached — show otter instead of stale data ───────────────────
  // This is intentionally chrome-free (no PageHeader/Disclaimer) to keep
  // the LimitReached upgrade pitch as the only thing on screen.
  if (isAnalysisExhausted && !isLoading) {
    return (
      <div data-testid="verdict-page" className="max-w-5xl mx-auto px-3 sm:px-4 py-4 sm:py-6">
        <LimitReached feature="Long-Term Outlook" />
      </div>
    );
  }

  // ─── Invalid symbol → branded empty state, also chrome-free ─────────────
  if (error && isSymbolNotFound((error as Error).message || "")) {
    return (
      <div data-testid="verdict-page" className="max-w-5xl mx-auto px-3 sm:px-4 py-4 sm:py-6">
        <InvalidSymbol ticker={activeTicker!} />
      </div>
    );
  }

  const sortedFactors = data ? [...data.factors].sort((a, b) => b.weight - a.weight) : [];
  const subtitle = !activeTicker
    ? "Is this a good stock to own? Fundamentals, institutional flow, stress resilience & insider confidence."
    : data
      ? `${data.ticker} — fundamentals, institutional flow, stress resilience & insider confidence.`
      : `${activeTicker} — fundamentals, institutional flow, stress resilience & insider confidence.`;

  return (
    <PageTemplate
      className="max-w-5xl mx-auto px-3 sm:px-4 py-4 sm:py-6 space-y-6"
      icon={Award}
      title="Long-Term Outlook"
      subtitle={subtitle}
      howItWorksTitle="How the Long-Term Outlook Score Works"
      howItWorks={
        <>
          <p className="mb-2 text-amber-400/80 font-semibold">This score answers: "Is this a good stock to own over weeks to months?" It is NOT a trade signal. For entry timing, use Trade Analysis.</p>
          <p>The outlook combines <strong className="text-foreground">5 weighted factors</strong> into a single 0–100 score that represents the overall investment thesis for a stock.</p>

          <p className="font-semibold text-foreground mt-2">Factor Weights:</p>
          <p><strong className="text-foreground">Fundamental Analysis (30%)</strong> — Your Trade Analysis score (0–10) scaled to 0–100. Covers income strength, business quality, balance sheet, valuation, and performance.</p>
          <p><strong className="text-foreground">Institutional Flow (25%)</strong> — The flow score from the Institutions page (-100 to +100) converted to 0–100. Measures net smart money direction.</p>
          <p><strong className="text-foreground">Stress Resilience (15%)</strong> — How well the stock performed vs. the S&P 500 during 7 major historical crises (2000–2025). Score = percentage of events where the stock beat the S&P.</p>
          <p><strong className="text-foreground">Insider Confidence (10%)</strong> — Net insider buy/sell activity. Each net buy adds +10 points from a base of 50. Heavy insider buying = high confidence.</p>

          <p className="font-semibold text-foreground mt-2">Final Verdict Thresholds:</p>
          <ScoreRange label="STRONG CONVICTION" range="70–100" color="green" description="All factors align. Fundamentals solid, institutions buying, stress-tested, insiders confident. Strong long-term hold." />
          <ScoreRange label="INVESTMENT GRADE" range="55–69" color="green" description="Most factors positive with minor weaknesses. Solid long-term hold with some caveats." />
          <ScoreRange label="SPECULATIVE" range="41–54" color="yellow" description="Mixed fundamentals. Some strengths, some concerns. Higher risk for long-term commitment." />
          <ScoreRange label="SPECULATIVE" range="31–40" color="yellow" description="More negatives than positives. High risk for long-term holding." />
          <ScoreRange label="HIGH RISK" range="0–30" color="red" description="Significant concerns across multiple categories. Not recommended for long-term holding." />

          <p className="font-semibold text-foreground mt-2">Examples:</p>
          <Example type="good">
            <p><strong className="text-bull-light">HD (Score 78, STRONG BUY):</strong> Fundamental score 8.2/10 (strong dividends, low debt, high margins). Institutions accumulating (+35 flow). Beat the S&P in 5 of 7 stress events. Multiple insider buys. All factors green.</p>
          </Example>
          <Example type="neutral">
            <p><strong className="text-watch-light">F (Score 48, HOLD):</strong> Decent fundamentals (6.1/10) but high debt drags the score. Institutional flow neutral (+8). Only beat the S&P in 2 of 7 crises. Insiders mixed. Some promise but too many yellow flags.</p>
          </Example>
          <Example type="bad">
            <p><strong className="text-bear-light">RIVN (Score 25, AVOID):</strong> Weak fundamentals (3.4/10) — no profit, high cash burn. Institutions distributing (-28 flow). No historical stress data (too new). Insider selling. Red across the board.</p>
          </Example>

          <p className="font-semibold text-foreground mt-2">Stress Test Events:</p>
          <p>The stress test table compares the stock's performance against S&P 500, Gold, and Silver during: <strong className="text-foreground">Dot-com Crash, 9/11, Great Recession, Flash Crash, China/Oil Crisis, COVID Crash, and 2022 Rate Hikes</strong>. Rows highlighted green mean the stock outperformed the S&P during that crisis. "N/A" means the company wasn't publicly traded during that period.</p>

          <p className="font-semibold text-foreground mt-2">Metals Dashboard:</p>
          <p>Gold and silver are traditional safe-haven assets. The <strong className="text-foreground">Gold/Silver Ratio</strong> (typically 60–90) indicates relative value. A ratio above 80 historically suggests silver is undervalued relative to gold. The S&P 500 (SPY) benchmark lets you compare your stock's context against the broader market.</p>
        </>
      }
    >
      {!activeTicker ? (
        <div className="text-center py-16 text-muted-foreground">
          <Shield className="h-16 w-16 mx-auto mb-4 opacity-20" />
          <p className="text-lg font-medium">Search a ticker for a long-term outlook</p>
          <p className="text-micro mt-3 opacity-40 uppercase tracking-wider">This is not a trade signal — see Trade Analysis for entry timing</p>
        </div>
      ) : isLoading ? (
        <>
          <div className="flex items-center gap-3 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm font-medium">
              Building long-term outlook for <span className="text-foreground font-bold">{activeTicker}</span> — this may take 10-15 seconds…
            </span>
          </div>
          <VerdictSkeleton />
        </>
      ) : error ? (
        <div className="bg-bear/10 border border-bear/20 rounded-lg p-6 text-center">
          <AlertTriangle className="h-8 w-8 mx-auto mb-3 text-bear-light" />
          <p className="text-bear-light font-medium">{((error as Error).message || "").replace(/^\d+:\s*/, "").replace(/[{}"]/g, "").replace(/error:/i, "").trim() || "Failed to generate verdict. Please try again."}</p>
        </div>
      ) : !data ? null : (
        <>
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
          <span className="mt-2 text-micro text-muted-foreground/50 uppercase tracking-widest">Long-Term Outlook — Not a Trade Signal</span>

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
                  <span className={`text-2xs font-bold px-2 py-0.5 rounded-md uppercase ${signalBadgeColor(factor.color)}`}>
                    {factor.signal}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums w-10 text-right">
                    {(factor.weight * 100).toFixed(0)}% wt
                  </span>
                  <span className={`text-sm font-bold tabular-nums w-8 text-right ${
                    factor.score >= 70 ? "text-bull-light" : factor.score >= 40 ? "text-watch-light" : "text-bear-light"
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

          <DataTable<StressTest>
            columns={[
              { key: "name", header: "Event", sortValue: t => t.name, accessor: t => <span className="font-semibold text-foreground">{t.name}</span> },
              { key: "period", header: "Period", sortValue: t => t.period, accessor: t => <span className="text-muted-foreground whitespace-nowrap">{t.period}</span> },
              { key: "ticker", header: data.ticker, type: "number", sortValue: t => t.hasData === false ? Number.NEGATIVE_INFINITY : t.ticker, accessor: t => {
                const noData = t.hasData === false;
                return <span className={`font-bold ${noData ? "text-muted-foreground" : pctColor(t.ticker)}`}>{noData ? "N/A" : formatPct(t.ticker)}</span>;
              }},
              { key: "spy", header: "S&P 500", type: "number", sortValue: t => t.hasData === false ? Number.NEGATIVE_INFINITY : t.spy, accessor: t => {
                const noData = t.hasData === false;
                return <span className={noData ? "text-muted-foreground" : pctColor(t.spy)}>{noData ? "N/A" : formatPct(t.spy)}</span>;
              }},
              { key: "nasdaq", header: "Nasdaq 100", type: "number", sortValue: t => t.hasData === false || t.nasdaq == null ? Number.NEGATIVE_INFINITY : t.nasdaq, accessor: t => {
                const noData = t.hasData === false || t.nasdaq == null;
                return <span className={noData ? "text-muted-foreground" : pctColor(t.nasdaq)}>{noData ? "N/A" : formatPct(t.nasdaq)}</span>;
              }},
              { key: "gold", header: "Gold", type: "number", sortValue: t => t.hasData === false ? Number.NEGATIVE_INFINITY : t.gold, accessor: t => {
                const noData = t.hasData === false;
                return <span className={noData ? "text-muted-foreground" : pctColor(t.gold)}>{noData ? "N/A" : formatPct(t.gold)}</span>;
              }},
              { key: "silver", header: "Silver", type: "number", sortValue: t => t.hasData === false ? Number.NEGATIVE_INFINITY : t.silver, accessor: t => {
                const noData = t.hasData === false;
                return <span className={noData ? "text-muted-foreground" : pctColor(t.silver)}>{noData ? "N/A" : formatPct(t.silver)}</span>;
              }},
            ]}
            data={data.stressTests}
            getRowKey={(_, i) => i}
            rowClassName={t => t.hasData === false ? "opacity-40" : (t.ticker > t.spy ? "bg-bull/[0.04]" : "")}
            dense
          />

          <div className="px-6 py-2.5 border-t border-card-border/40 text-micro text-muted-foreground flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-sm bg-bull/[0.08] border border-bull/20" />
            <span>Highlighted rows indicate {data.ticker} outperformed the S&amp;P 500</span>
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
                  <span className={`text-2xs font-bold px-2.5 py-0.5 rounded-md border uppercase ${
                    data.analysis.verdict === "YES"
                      ? "bg-bull/15 text-bull-light border-bull/20"
                      : data.analysis.verdict === "NO"
                      ? "bg-bear/15 text-bear-light border-bear/20"
                      : "bg-watch/15 text-watch-light border-watch/20"
                  }`}>
                    {data.analysis.verdict}
                  </span>
                </div>

                {/* Score display */}
                <div className="flex items-end gap-1.5 mb-4">
                  <span className={`text-4xl font-black tabular-nums leading-none ${
                    data.analysis.score >= 7 ? "text-bull-light" : data.analysis.score >= 5 ? "text-watch-light" : "text-bear-light"
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
                          item.score >= 7 ? "text-bull-light" : item.score >= 5 ? "text-watch-light" : "text-bear-light"
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
                  <span className={`text-2xs font-bold px-2.5 py-0.5 rounded-md border uppercase ${
                    data.institutional.signal.includes("INFLOW") || data.institutional.signal === "ACCUMULATING"
                      ? "bg-bull/15 text-bull-light border-bull/20"
                      : data.institutional.signal.includes("OUTFLOW") || data.institutional.signal === "DISTRIBUTING"
                      ? "bg-bear/15 text-bear-light border-bear/20"
                      : "bg-watch/15 text-watch-light border-watch/20"
                  }`}>
                    {data.institutional.signal}
                  </span>
                </div>

                {/* Flow Score */}
                <div className="flex items-end gap-1.5 mb-4">
                  <span className={`text-4xl font-black tabular-nums leading-none ${
                    data.institutional.flowScore >= 20 ? "text-bull-light"
                    : data.institutional.flowScore <= -20 ? "text-bear-light"
                    : "text-watch-light"
                  }`}>
                    {data.institutional.flowScore > 0 ? "+" : ""}{data.institutional.flowScore}
                  </span>
                  <span className="text-sm text-muted-foreground mb-0.5">flow score</span>
                </div>

                {/* Quick stats */}
                <div className="grid grid-cols-2 gap-3 border-t border-card-border pt-3">
                  <div>
                    <p className="text-micro text-muted-foreground uppercase tracking-wider">Institutional %</p>
                    <p className="text-sm font-bold text-foreground tabular-nums">{(data.institutional.institutionPct ?? 0).toFixed(1)}%</p>
                  </div>
                  <div>
                    <p className="text-micro text-muted-foreground uppercase tracking-wider">Insider %</p>
                    <p className="text-sm font-bold text-foreground tabular-nums">{(data.institutional.insiderPct ?? 0).toFixed(1)}%</p>
                  </div>
                  <div>
                    <p className="text-micro text-muted-foreground uppercase tracking-wider">Inst. Increasing</p>
                    <p className="text-sm font-bold text-bull-light tabular-nums">{data.institutional.instIncreased}</p>
                  </div>
                  <div>
                    <p className="text-micro text-muted-foreground uppercase tracking-wider">Inst. Decreasing</p>
                    <p className="text-sm font-bold text-bear-light tabular-nums">{data.institutional.instDecreased}</p>
                  </div>
                  <div>
                    <p className="text-micro text-muted-foreground uppercase tracking-wider">Insider Buys</p>
                    <p className="text-sm font-bold text-bull-light tabular-nums">{data.institutional.insiderBuyCount}</p>
                  </div>
                  <div>
                    <p className="text-micro text-muted-foreground uppercase tracking-wider">Insider Sells</p>
                    <p className="text-sm font-bold text-bear-light tabular-nums">{data.institutional.insiderSellCount}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      )}
        </>
      )}
    </PageTemplate>
  );
}
