/**
 * Conviction Compass page.
 *
 * A four-axis radar that fuses orthogonal signal categories — smart money
 * flow, dealer positioning, technical momentum, fundamental quality — into
 * a single readable conviction signal. The novelty isn't any one axis;
 * it's that all four come from independent data streams, so when they
 * agree it's a much stronger signal than four TA components agreeing.
 *
 * Visual hierarchy:
 *   1. Big plain-language verdict at the top (ALL_ALIGNED_BULLISH etc).
 *   2. The radar chart in the middle — distance from center = magnitude,
 *      color = direction. One look tells you whether the four agree.
 *   3. Per-axis component breakdowns below — the inputs that built each
 *      axis score, so the user can audit "why did this axis say bullish?"
 */

import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useTicker } from "@/contexts/TickerContext";
import { Disclaimer } from "@/components/Disclaimer";
import { HelpBlock } from "@/components/HelpBlock";
import {
  Compass, TrendingUp, TrendingDown, Minus, Loader2,
  Building2, Activity, LineChart, BarChart3,
} from "lucide-react";
import {
  ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis,
  PolarRadiusAxis, Radar,
} from "recharts";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AxisComponent {
  label: string;
  value: number | null;
  contribution: number;
  direction: "bullish" | "bearish" | "neutral";
}

interface AxisScore {
  score: number;
  weight: number;
  components: AxisComponent[];
  notes: string[];
}

type ConvictionVerdict =
  | "ALL_ALIGNED_BULLISH"
  | "MOSTLY_BULLISH"
  | "DIVERGENT"
  | "MOSTLY_BEARISH"
  | "ALL_ALIGNED_BEARISH"
  | "WEAK_SIGNAL";

interface ConvictionCompass {
  ticker: string;
  asOf: number;
  schemaVersion: 1;
  smartMoneyFlow: AxisScore;
  dealerPositioning: AxisScore;
  technicalMomentum: AxisScore;
  fundamentalQuality: AxisScore;
  confluence: number;
  alignment: number;
  verdict: ConvictionVerdict;
  confidence: "HIGH" | "MODERATE" | "LOW";
}

// ─── Verdict styling ──────────────────────────────────────────────────────────

const VERDICT_COPY: Record<ConvictionVerdict, { label: string; tone: "bull" | "bear" | "mixed"; sub: string }> = {
  ALL_ALIGNED_BULLISH:  { label: "ALL ALIGNED — BULLISH",  tone: "bull",  sub: "All four signal categories agree to the upside. Highest conviction setup." },
  MOSTLY_BULLISH:       { label: "MOSTLY BULLISH",         tone: "bull",  sub: "Three of four categories bullish, no contradicting bearish signal. Strong but not unanimous." },
  DIVERGENT:            { label: "DIVERGENT",              tone: "mixed", sub: "Categories disagree. Smart money and technicals (or other pair) point opposite directions — wait for resolution." },
  MOSTLY_BEARISH:       { label: "MOSTLY BEARISH",         tone: "bear",  sub: "Three of four categories bearish, no contradicting bullish signal. Strong but not unanimous." },
  ALL_ALIGNED_BEARISH:  { label: "ALL ALIGNED — BEARISH",  tone: "bear",  sub: "All four signal categories agree to the downside. Highest conviction warning." },
  WEAK_SIGNAL:          { label: "WEAK SIGNAL",            tone: "mixed", sub: "All categories near neutral, or insufficient data to score multiple axes. No directional edge." },
};

function verdictToneClasses(tone: "bull" | "bear" | "mixed") {
  if (tone === "bull") return "bg-green-500/15 text-green-400 border-green-500/30";
  if (tone === "bear") return "bg-red-500/15 text-red-400 border-red-500/30";
  return "bg-yellow-500/15 text-yellow-400 border-yellow-500/30";
}

function dirIcon(direction: AxisComponent["direction"]) {
  if (direction === "bullish") return <TrendingUp className="h-3.5 w-3.5 text-green-400" />;
  if (direction === "bearish") return <TrendingDown className="h-3.5 w-3.5 text-red-400" />;
  return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
}

function scoreColor(score: number): string {
  if (score >= 50) return "text-green-400";
  if (score >= 15) return "text-green-400/80";
  if (score <= -50) return "text-red-400";
  if (score <= -15) return "text-red-400/80";
  return "text-yellow-400/80";
}

function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n == null || isNaN(n)) return "—";
  const num = Number(n);
  const abs = Math.abs(num);
  // Compact format for large magnitudes — GEX in particular comes in as
  // dollar dealer-gamma-per-1%-move which can run into the billions and
  // blow out the row layout. Same K/M/B/T pattern used elsewhere in the
  // app for shares, market cap, etc.
  if (abs >= 1e12) return (num / 1e12).toFixed(2) + "T";
  if (abs >= 1e9)  return (num / 1e9).toFixed(2) + "B";
  if (abs >= 1e6)  return (num / 1e6).toFixed(2) + "M";
  if (abs >= 1e3)  return (num / 1e3).toFixed(2) + "K";
  return num.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

// ─── Radar chart ──────────────────────────────────────────────────────────────

interface RadarPoint {
  axis: string;
  bullish: number;
  bearish: number;
  fullMark: number;
}

/**
 * Build radar data with two layers:
 *   - bullish: positive scores (or 0 if axis is bearish)
 *   - bearish: |negative scores| (or 0 if axis is bullish)
 * The two polygons fill different colors. A neutral axis shows 0 in both,
 * a strongly bullish axis shows high in green and 0 in red, etc.
 *
 * Axes are presented N/E/S/W with semantic groupings — money on the
 * vertical (smart money + fundamentals), market structure on the
 * horizontal (dealer + technical).
 */
function buildRadarData(c: ConvictionCompass): RadarPoint[] {
  const axes = [
    { axis: "Smart Money", score: c.smartMoneyFlow.score },
    { axis: "Dealer Positioning", score: c.dealerPositioning.score },
    { axis: "Technical Momentum", score: c.technicalMomentum.score },
    { axis: "Fundamentals", score: c.fundamentalQuality.score },
  ];
  return axes.map(a => ({
    axis: a.axis,
    bullish: a.score > 0 ? a.score : 0,
    bearish: a.score < 0 ? Math.abs(a.score) : 0,
    fullMark: 100,
  }));
}

function CompassRadar({ compass }: { compass: ConvictionCompass }) {
  const data = buildRadarData(compass);
  return (
    <div className="w-full h-[360px] bg-card border border-card-border rounded-xl p-4">
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart cx="50%" cy="50%" outerRadius="75%" data={data}>
          <PolarGrid stroke="rgba(148, 163, 184, 0.2)" />
          <PolarAngleAxis dataKey="axis" tick={{ fill: "#cbd5e1", fontSize: 12, fontWeight: 600 }} />
          <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fill: "#64748b", fontSize: 10 }} />
          <Radar
            name="Bullish"
            dataKey="bullish"
            stroke="#34d399"
            fill="#34d399"
            fillOpacity={0.35}
          />
          <Radar
            name="Bearish"
            dataKey="bearish"
            stroke="#f87171"
            fill="#f87171"
            fillOpacity={0.25}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Confluence gauge ────────────────────────────────────────────────────────

function ConfluenceGauge({ confluence, alignment }: { confluence: number; alignment: number }) {
  const absConf = Math.abs(confluence);
  const isBull = confluence > 0;
  const color = isBull ? "#34d399" : confluence < 0 ? "#f87171" : "#fbbf24";
  // Filled bar from center outward
  const pctFromCenter = absConf / 100;

  return (
    <div className="bg-card border border-card-border rounded-xl p-5 flex flex-col items-center gap-3">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">Confluence</div>
      <div className="text-5xl font-bold tabular-nums" style={{ color }}>
        {confluence > 0 ? "+" : ""}{confluence}
      </div>
      <div className="text-xs text-muted-foreground">on a -100 to +100 scale</div>
      {/* Bidirectional bar */}
      <div className="w-full h-3 relative rounded-full overflow-hidden bg-muted/30 mt-2">
        <div className="absolute inset-y-0 left-1/2 w-px bg-muted-foreground/40" />
        {confluence !== 0 && (
          <div
            className="absolute inset-y-0 transition-all"
            style={{
              backgroundColor: color,
              left: isBull ? "50%" : `${50 - pctFromCenter * 50}%`,
              width: `${pctFromCenter * 50}%`,
            }}
          />
        )}
      </div>
      <div className="text-xs text-muted-foreground mt-1">
        Axis alignment: <span className="text-foreground font-semibold">{Math.round(alignment * 100)}%</span>
      </div>
    </div>
  );
}

// ─── Axis card ────────────────────────────────────────────────────────────────

function AxisCard({ title, axis, icon }: { title: string; axis: AxisScore; icon: React.ReactNode }) {
  const tone = axis.score >= 15 ? "bullish" : axis.score <= -15 ? "bearish" : "neutral";
  const dot = tone === "bullish" ? "bg-green-400" : tone === "bearish" ? "bg-red-400" : "bg-yellow-400";
  return (
    <div className="bg-card border border-card-border rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          {icon}
          {title}
        </div>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${dot}`} />
          <span className={`text-xl font-bold tabular-nums ${scoreColor(axis.score)}`}>
            {axis.score > 0 ? "+" : ""}{axis.score}
          </span>
        </div>
      </div>
      {axis.weight === 0 && (
        <div className="text-xs italic text-muted-foreground">No data — axis unscored.</div>
      )}
      <div className="space-y-1.5 overflow-hidden">
        {axis.components.map((c, i) => (
          <div key={i} className="flex items-center justify-between text-xs gap-2">
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              {dirIcon(c.direction)}
              <span className="text-muted-foreground truncate">{c.label}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-muted-foreground tabular-nums w-14 text-right truncate" title={c.value === null ? "" : String(c.value)}>
                {c.value === null ? "—" : fmtNum(c.value)}
              </span>
              <span className={`tabular-nums font-semibold w-10 text-right ${scoreColor(c.contribution)}`}>
                {c.contribution > 0 ? "+" : ""}{c.contribution}
              </span>
            </div>
          </div>
        ))}
      </div>
      {axis.notes.length > 0 && (
        <div className="text-[11px] text-amber-400/80 border-t border-card-border pt-2 space-y-0.5">
          {axis.notes.map((n, i) => (
            <div key={i}>• {n}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function ConvictionPage() {
  const { activeTicker } = useTicker();

  const { data: compass, isLoading, error } = useQuery<ConvictionCompass>({
    queryKey: ["/api/conviction", activeTicker],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/conviction/${activeTicker}`);
      return res.json();
    },
    enabled: !!activeTicker,
    staleTime: 5 * 60 * 1000,
  });

  if (!activeTicker) {
    return (
      <div data-testid="conviction-page" className="max-w-5xl mx-auto px-3 sm:px-4 py-4 sm:py-6">
        <div className="text-center py-24 text-muted-foreground">
          <Compass className="h-16 w-16 mx-auto mb-4 opacity-20" />
          <p className="text-lg font-medium">Search a ticker for a Conviction Compass reading</p>
          <Disclaimer />
          <p className="text-sm mt-1 opacity-60">
            Combines smart money flow, dealer positioning, technical momentum, and fundamental quality
            into a single signal. Highest conviction = all four agree.
          </p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto px-3 sm:px-4 py-4 sm:py-6">
        <div className="flex flex-col items-center gap-3 py-24">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Building Conviction Compass for {activeTicker}…</p>
        </div>
      </div>
    );
  }

  if (error || !compass) {
    return (
      <div className="max-w-5xl mx-auto px-3 sm:px-4 py-4 sm:py-6">
        <div className="bg-card border border-red-500/30 rounded-xl p-6 text-center">
          <p className="text-red-400 font-semibold">Could not build Conviction Compass</p>
          <p className="text-xs text-muted-foreground mt-2">{(error as any)?.message || "Try refreshing."}</p>
        </div>
      </div>
    );
  }

  const verdictMeta = VERDICT_COPY[compass.verdict];

  return (
    <div data-testid="conviction-page" className="max-w-5xl mx-auto px-3 sm:px-4 py-4 sm:py-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Compass className="h-5 w-5 text-primary" />
            Conviction Compass — <span className="font-mono">{compass.ticker}</span>
          </h1>
          <p className="text-xs text-muted-foreground">
            One signal from four independent data streams. High conviction requires agreement.
          </p>
          <Disclaimer />
        </div>
        <div className="text-xs text-muted-foreground self-end">
          Confidence:{" "}
          <span className={`font-semibold ${
            compass.confidence === "HIGH" ? "text-green-400"
              : compass.confidence === "MODERATE" ? "text-yellow-400"
              : "text-red-400"
          }`}>{compass.confidence}</span>
        </div>
      </div>

      {/* Verdict pill */}
      <div className={`rounded-xl border p-5 ${verdictToneClasses(verdictMeta.tone)}`}>
        <div className="text-xs uppercase tracking-wider opacity-80">Verdict</div>
        <div className="text-2xl font-bold mt-1">{verdictMeta.label}</div>
        <div className="text-sm mt-2 opacity-90">{verdictMeta.sub}</div>
      </div>

      {/* Radar + confluence side-by-side */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2">
          <CompassRadar compass={compass} />
        </div>
        <div>
          <ConfluenceGauge confluence={compass.confluence} alignment={compass.alignment} />
        </div>
      </div>

      {/* Axis breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <AxisCard
          title="Smart Money Flow"
          axis={compass.smartMoneyFlow}
          icon={<Building2 className="h-4 w-4 text-primary" />}
        />
        <AxisCard
          title="Dealer Positioning"
          axis={compass.dealerPositioning}
          icon={<Activity className="h-4 w-4 text-primary" />}
        />
        <AxisCard
          title="Technical Momentum"
          axis={compass.technicalMomentum}
          icon={<LineChart className="h-4 w-4 text-primary" />}
        />
        <AxisCard
          title="Fundamental Quality"
          axis={compass.fundamentalQuality}
          icon={<BarChart3 className="h-4 w-4 text-primary" />}
        />
      </div>

      {/* Methodology */}
      <HelpBlock title="How the Conviction Compass works">
        <p>
          Most "composite" trading indicators stack technical signals on top of each other —
          MACD + RSI + Bollinger + ATR. That's still one category of signal:
          price/volume momentum. When all four agree, you've confirmed momentum, but you
          still don't know whether smart money agrees, whether dealers are positioned for
          the move, or whether the fundamentals support it.
        </p>
        <p className="mt-2">
          The Conviction Compass uses <strong className="text-foreground">four orthogonal
          signal categories</strong> instead. When they agree, the signal is much stronger
          than four correlated indicators agreeing.
        </p>
        <ul className="list-disc pl-5 mt-2 space-y-1">
          <li><strong className="text-foreground">Smart Money Flow</strong> — institutional
            QoQ position changes (13F-derived) plus insider transaction count (Form 4
            buys minus sells over the trailing 180 days).</li>
          <li><strong className="text-foreground">Dealer Positioning</strong> — gamma
            exposure regime, distance from gamma walls, and put/call open interest skew
            from the live options chain. Tells you what market makers must do as price moves.</li>
          <li><strong className="text-foreground">Technical Momentum</strong> — RSI(14),
            MACD histogram, EMA(9/21/50) stack alignment, and Bollinger %B from a 1-year
            daily chart.</li>
          <li><strong className="text-foreground">Fundamental Quality</strong> — the
            existing 8-factor verdict score remapped from 0–10 to ±100.</li>
        </ul>
        <p className="mt-2">
          Each axis is independently scored from −100 (strongly bearish) to +100 (strongly
          bullish). The center confluence number is the magnitude-weighted average,
          penalized when axes disagree in sign — divergent setups score near zero
          regardless of how extreme any single axis is.
        </p>
        <p className="mt-2">
          <strong className="text-foreground">Why "ALL ALIGNED" is the strongest setup:</strong>
          {" "}independent data streams agreeing is much harder to fake than correlated TA
          signals. Smart money can't manipulate analyst consensus, gamma exposure, AND
          your moving averages simultaneously.
        </p>
      </HelpBlock>
    </div>
  );
}
