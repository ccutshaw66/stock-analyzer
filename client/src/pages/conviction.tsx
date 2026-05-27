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
import {
  SIGNAL_BULL_RADAR,
  SIGNAL_BEAR_LIGHT,
  COLOR_GRAY_NEUTRAL,
  COLOR_GRAY_NEUTRAL_LIGHT,
  ACCENT_AMBER,
  OVERLAY_SLATE_20,
} from "@/lib/design-tokens";
import { apiRequest } from "@/lib/queryClient";
import { API_DIAG_CONVICTION_BACKTEST } from "@shared/api/endpoints";
import { useTicker } from "@/contexts/TickerContext";
import { HelpBlock } from "@/components/HelpBlock";
import { PageTemplate } from "@/components/PageTemplate";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
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
  if (tone === "bull") return "bg-bull/15 text-bull-light border-bull/30";
  if (tone === "bear") return "bg-bear/15 text-bear-light border-bear/30";
  return "bg-watch/15 text-watch-light border-watch/30";
}

function dirIcon(direction: AxisComponent["direction"]) {
  if (direction === "bullish") return <TrendingUp className="h-3.5 w-3.5 text-bull-light" />;
  if (direction === "bearish") return <TrendingDown className="h-3.5 w-3.5 text-bear-light" />;
  return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
}

function scoreColor(score: number): string {
  if (score >= 50) return "text-bull-light";
  if (score >= 15) return "text-bull-light/80";
  if (score <= -50) return "text-bear-light";
  if (score <= -15) return "text-bear-light/80";
  return "text-watch-light/80";
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
          <PolarGrid stroke={OVERLAY_SLATE_20} />
          <PolarAngleAxis dataKey="axis" tick={{ fill: COLOR_GRAY_NEUTRAL_LIGHT, fontSize: 12, fontWeight: 600 }} />
          <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fill: COLOR_GRAY_NEUTRAL, fontSize: 10 }} />
          <Radar
            name="Bullish"
            dataKey="bullish"
            stroke={SIGNAL_BULL_RADAR}
            fill={SIGNAL_BULL_RADAR}
            fillOpacity={0.35}
          />
          <Radar
            name="Bearish"
            dataKey="bearish"
            stroke={SIGNAL_BEAR_LIGHT}
            fill={SIGNAL_BEAR_LIGHT}
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
  const color = isBull ? SIGNAL_BULL_RADAR : confluence < 0 ? SIGNAL_BEAR_LIGHT : ACCENT_AMBER;
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
  const dot = tone === "bullish" ? "bg-bull-light" : tone === "bearish" ? "bg-bear-light" : "bg-watch-light";
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
        <div className="text-2xs text-amber-400/80 border-t border-card-border pt-2 space-y-0.5">
          {axis.notes.map((n, i) => (
            <div key={i}>• {n}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Backtest panel ──────────────────────────────────────────────────────────
//
// Live forward-tracking stats. We snapshot the compass for ~100 megacaps
// every weekday at market close, then fill in 1d/5d/30d/90d forward
// returns as each window completes. This panel renders the running
// per-verdict averages compared against SPY over the same dates.
//
// In the early days the dataset is small and most cells will be null —
// we show "still collecting" rather than misleading numbers under N=10.

interface VerdictStats {
  verdict: string;
  count: number;
  avgReturn1d: number | null;
  avgReturn5d: number | null;
  avgReturn30d: number | null;
  avgReturn90d: number | null;
  winRate30d: number | null;
}
interface BacktestData {
  totalSnapshots: number;
  earliestDate: string | null;
  latestDate: string | null;
  byVerdict: VerdictStats[];
  spy: { avgReturn1d: number | null; avgReturn5d: number | null; avgReturn30d: number | null; avgReturn90d: number | null };
  pendingForwardReturns: { d1: number; d5: number; d30: number; d90: number };
}

const VERDICT_DISPLAY_ORDER: string[] = [
  "ALL_ALIGNED_BULLISH", "MOSTLY_BULLISH", "WEAK_SIGNAL", "DIVERGENT", "MOSTLY_BEARISH", "ALL_ALIGNED_BEARISH",
];

const MIN_SAMPLES_FOR_DISPLAY = 5;

function fmtPct(n: number | null, samples: number): string {
  if (n === null || samples < MIN_SAMPLES_FOR_DISPLAY) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function pctTone(n: number | null, samples: number): string {
  if (n === null || samples < MIN_SAMPLES_FOR_DISPLAY) return "text-muted-foreground";
  if (n > 0.5) return "text-bull-light";
  if (n < -0.5) return "text-bear-light";
  return "text-watch-light/80";
}

function BacktestPanel() {
  const { data, isLoading } = useQuery<BacktestData>({
    queryKey: [API_DIAG_CONVICTION_BACKTEST],
    queryFn: async () => {
      const res = await apiRequest("GET", API_DIAG_CONVICTION_BACKTEST);
      return res.json();
    },
    staleTime: 15 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="bg-card border border-card-border rounded-xl p-5">
        <div className="text-xs text-muted-foreground">Loading forward-tracking results…</div>
      </div>
    );
  }

  if (!data || data.totalSnapshots === 0) {
    return (
      <div className="bg-card border border-card-border rounded-xl p-5 space-y-2">
        <div className="text-sm font-semibold text-foreground">Live Forward-Tracking</div>
        <p className="text-xs text-muted-foreground">
          Daily snapshots of every tracked ticker's compass start collecting at market close
          today, then we fill in 1d/5d/30d/90d forward returns as each window closes.
          Results appear here once we have at least {MIN_SAMPLES_FOR_DISPLAY} datapoints
          per verdict class — meaningful stats land in 1–2 weeks.
        </p>
      </div>
    );
  }

  const verdictRows = VERDICT_DISPLAY_ORDER
    .map(v => data.byVerdict.find(r => r.verdict === v))
    .filter((r): r is VerdictStats => !!r);

  return (
    <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="text-sm font-semibold text-foreground">Live Forward-Tracking</div>
          <div className="text-2xs text-muted-foreground">
            Real performance of each verdict class since tracking started.
            Averaged across all tickers in the tracked universe (~100 megacaps).
          </div>
        </div>
        <div className="text-2xs text-muted-foreground text-right">
          {data.totalSnapshots.toLocaleString()} snapshots
          {data.earliestDate && data.latestDate && (
            <> · {data.earliestDate} → {data.latestDate}</>
          )}
        </div>
      </div>

      {(() => {
        type Row = {
          verdict: string;
          count: number | null;
          avgReturn1d: number | null;
          avgReturn5d: number | null;
          avgReturn30d: number | null;
          avgReturn90d: number | null;
          winRate30d: number | null;
          isBaseline?: boolean;
        };
        const rows: Row[] = [
          ...verdictRows.map(r => ({ ...r, isBaseline: false } as Row)),
          {
            verdict: "SPY (baseline)",
            count: null,
            avgReturn1d: data.spy.avgReturn1d,
            avgReturn5d: data.spy.avgReturn5d,
            avgReturn30d: data.spy.avgReturn30d,
            avgReturn90d: data.spy.avgReturn90d,
            winRate30d: null,
            isBaseline: true,
          },
        ];
        const samples = (r: Row) => r.isBaseline ? MIN_SAMPLES_FOR_DISPLAY : (r.count ?? 0);
        return (
          <DataTable<Row>
            columns={[
              { key: "verdict", header: "Verdict", sortValue: r => r.verdict, accessor: r => (
                <span className={`font-mono text-2xs ${r.isBaseline ? "text-muted-foreground italic" : "text-foreground"}`}>{r.verdict.replace(/_/g, " ")}</span>
              )},
              { key: "count", header: "N", type: "number", sortValue: r => r.count ?? -1, accessor: r => <span className="text-muted-foreground">{r.count ?? "—"}</span> },
              { key: "r1d", header: "1d", type: "number", sortValue: r => r.avgReturn1d ?? Number.NEGATIVE_INFINITY, accessor: r => (
                <span className={`font-semibold ${pctTone(r.avgReturn1d, samples(r))}`}>{fmtPct(r.avgReturn1d, samples(r))}</span>
              )},
              { key: "r5d", header: "5d", type: "number", sortValue: r => r.avgReturn5d ?? Number.NEGATIVE_INFINITY, accessor: r => (
                <span className={`font-semibold ${pctTone(r.avgReturn5d, samples(r))}`}>{fmtPct(r.avgReturn5d, samples(r))}</span>
              )},
              { key: "r30d", header: "30d", type: "number", sortValue: r => r.avgReturn30d ?? Number.NEGATIVE_INFINITY, accessor: r => (
                <span className={`font-semibold ${pctTone(r.avgReturn30d, samples(r))}`}>{fmtPct(r.avgReturn30d, samples(r))}</span>
              )},
              { key: "r90d", header: "90d", type: "number", sortValue: r => r.avgReturn90d ?? Number.NEGATIVE_INFINITY, accessor: r => (
                <span className={`font-semibold ${pctTone(r.avgReturn90d, samples(r))}`}>{fmtPct(r.avgReturn90d, samples(r))}</span>
              )},
              { key: "win30", header: "Win 30d", type: "number", sortValue: r => r.winRate30d ?? -1, accessor: r => (
                <span className="text-muted-foreground">{r.winRate30d !== null && (r.count ?? 0) >= MIN_SAMPLES_FOR_DISPLAY ? `${(r.winRate30d * 100).toFixed(0)}%` : "—"}</span>
              )},
            ]}
            data={rows}
            getRowKey={r => r.verdict}
            rowClassName={r => r.isBaseline ? "border-t-2 border-card-border" : ""}
            dense
          />
        );
      })()}

      {(data.pendingForwardReturns.d30 > 0 || data.pendingForwardReturns.d90 > 0) && (
        <div className="text-2xs text-amber-400/80">
          Pending forward returns: {data.pendingForwardReturns.d1} 1d · {data.pendingForwardReturns.d5} 5d · {data.pendingForwardReturns.d30} 30d · {data.pendingForwardReturns.d90} 90d.
          Filled in once each window closes.
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

  const verdictMeta = compass ? VERDICT_COPY[compass.verdict] : null;

  const subtitle = !activeTicker
    ? "One signal from four independent data streams. High conviction requires agreement."
    : isLoading
      ? `Building reading for ${activeTicker}…`
      : compass
        ? `${compass.ticker} — one signal from four independent data streams.`
        : `${activeTicker} — one signal from four independent data streams.`;

  const headerRight = compass ? (
    <div className="text-xs text-muted-foreground">
      Confidence:{" "}
      <span className={`font-semibold ${
        compass.confidence === "HIGH" ? "text-bull-light"
          : compass.confidence === "MODERATE" ? "text-watch-light"
          : "text-bear-light"
      }`}>{compass.confidence}</span>
    </div>
  ) : undefined;

  return (
    <PageTemplate
      className="max-w-5xl mx-auto px-3 sm:px-4 py-4 sm:py-6 space-y-5"
      icon={Compass}
      title="Conviction Compass"
      subtitle={subtitle}
      headerRight={headerRight}
      howItWorksTitle="How the Conviction Compass works"
      howItWorks={
        <>
          <p>The Compass fuses <strong className="text-foreground">four independent signal categories</strong> into a single reading. Because each axis pulls from a different data stream, agreement across axes is much stronger evidence than agreement across, say, four technical indicators that all read the same price.</p>
          <p><strong className="text-foreground">Smart Money Flow</strong> — institutional buying/selling and insider activity (13F + Form 4).</p>
          <p><strong className="text-foreground">Dealer Positioning</strong> — gamma exposure and dealer hedging direction (options chain).</p>
          <p><strong className="text-foreground">Technical Momentum</strong> — trend, RSI, and breakout structure (price/volume).</p>
          <p><strong className="text-foreground">Fundamental Quality</strong> — earnings, balance sheet, and growth (financial statements).</p>
          <p className="mt-2"><strong className="text-foreground">Reading the radar:</strong> distance from the center is magnitude; color is direction. When all four extend the same way, conviction is HIGH. When they fight, confidence drops to MODERATE or LOW.</p>
        </>
      }
    >
      {!activeTicker ? (
        <div className="text-center py-16 text-muted-foreground">
          <Compass className="h-16 w-16 mx-auto mb-4 opacity-20" />
          <p className="text-lg font-medium">Search a ticker for a Conviction Compass reading</p>
          <p className="text-sm mt-1 opacity-60">
            Combines smart money flow, dealer positioning, technical momentum, and fundamental quality
            into a single signal. Highest conviction = all four agree.
          </p>
        </div>
      ) : isLoading ? (
        <div className="flex flex-col items-center gap-3 py-24">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Building Conviction Compass for {activeTicker}…</p>
        </div>
      ) : error || !compass || !verdictMeta ? (
        <div className="bg-card border border-bear/30 rounded-xl p-6 text-center">
          <p className="text-bear-light font-semibold">Could not build Conviction Compass</p>
          <p className="text-xs text-muted-foreground mt-2">{(error as any)?.message || "Try refreshing."}</p>
        </div>
      ) : (
        <>
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

          {/* Live forward-tracking results */}
          <BacktestPanel />

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
        </>
      )}
    </PageTemplate>
  );
}
