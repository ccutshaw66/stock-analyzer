/**
 * Full-page view for the Markov compartment.
 *
 * All Markov state and any future backend calls flow through `useMarkov()`
 * (the one canonical hook). When the Python service is deployed, the hook
 * exposes `runBacktest`; this view will wire results in without changing
 * the page chrome.
 */
import { useState, useMemo } from "react";
import {
  FlaskConical, Play, AlertTriangle, Info, BarChart3, TrendingUp,
  Activity, Loader2,
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, Legend,
} from "recharts";
import { HelpBlock, Example } from "@/components/HelpBlock";
import {
  useMarkov, DEFAULT_PARAMS,
  type MarkovParams, type MarkovBacktestResult, type MarkovPerformance,
} from "./useMarkov";
import { DataTable, type DataTableColumn } from "@/components/DataTable";

export function MarkovFullView() {
  const M = useMarkov();
  const [params, setParams] = useState<MarkovParams>(DEFAULT_PARAMS);
  const update = <K extends keyof MarkovParams>(k: K, v: MarkovParams[K]) =>
    setParams((p) => ({ ...p, [k]: v }));

  return (
    <div className="space-y-4">
      <ExperimentalBanner />

      {!M.connected && (
        <div className="border border-amber-500/30 bg-amber-500/5 rounded-lg p-3 flex items-start gap-2 text-xs text-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Awaiting Python service deployment.</p>
            <p className="opacity-80 mt-0.5">
              The strategy code is checked in at{" "}
              <code className="text-[10px] bg-amber-500/10 px-1 py-0.5 rounded">
                python/markov_trading_v2.py
              </code>
              . To go live, deploy it as an HTTP service (Railway works — same
              pattern as HERMES), then set <code>MARKOV_API</code> inside
              the compartment's hook. See <code>python/README.md</code> for the
              expected request shape.
            </p>
          </div>
        </div>
      )}

      <HelpBlock title="How the model works">
        <p>
          The Hidden Markov Model treats the market as moving between a small
          number of unobservable <strong>regimes</strong> (calm bull, choppy
          range, drawdown, etc.). It infers them from each day's
          (return, realized-vol, momentum) and learns a transition matrix.
        </p>
        <p>
          Each day, we predict the next regime's expected return and vol from
          the transition matrix, then size the position to hit a target
          annualized vol (<strong>vol targeting</strong>). Transaction costs
          and a minimum hold prevent flip-flopping.
        </p>
        <Example type="neutral">
          With 3 states, target vol 10%, and a 2-day min hold, SPY 2010–today
          typically produces a strategy with lower drawdown than buy &amp; hold
          and a Sharpe above 1, at the cost of underperforming in strong
          trending years where it sizes down through vol spikes.
        </Example>
      </HelpBlock>

      <section className="bg-card border border-card-border rounded-xl p-4">
        <h2 className="text-sm font-bold text-foreground flex items-center gap-2 mb-3">
          <Info className="h-4 w-4 text-primary" /> Backtest Parameters
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <TextField label="Ticker" value={params.ticker} onChange={(v) => update("ticker", v.toUpperCase())} placeholder="SPY" mono />
          <TextField label="Start date" type="date" value={params.start} onChange={(v) => update("start", v)} />
          <TextField label="End date (blank = today)" type="date" value={params.end} onChange={(v) => update("end", v)} />
          <NumField label="HMM states" value={params.states} step={1} min={2} max={6}
            onChange={(v) => update("states", Math.round(v))} hint="Number of regimes (2–6 reasonable)" />
          <NumField label="Train fraction" value={params.trainFrac} step={0.05} min={0.2} max={0.9}
            onChange={(v) => update("trainFrac", v)} hint="Share of history used to fit the HMM" />
          <NumField label="Target vol (annual)" value={params.targetVol} step={0.01} min={0.02} max={0.5}
            onChange={(v) => update("targetVol", v)} hint="e.g. 0.10 = 10% target annualized vol" />
          <NumField label="Transaction cost (bps)" value={params.costBps} step={0.5} min={0} max={50}
            onChange={(v) => update("costBps", v)} hint="Round-trip cost per unit of turnover" />
          <NumField label="Min hold (days)" value={params.minHoldDays} step={1} min={1} max={20}
            onChange={(v) => update("minHoldDays", Math.round(v))} hint="Suppresses noise / over-trading" />
          <label className="flex items-center gap-2 px-3 py-2 mt-5 rounded-md bg-background border border-card-border cursor-pointer text-sm text-foreground">
            <input type="checkbox" checked={params.allowShort}
              onChange={(e) => update("allowShort", e.target.checked)}
              className="h-4 w-4 accent-primary" />
            Allow short positions
          </label>
        </div>

        <button
          disabled={!M.connected || M.runBacktest.isPending}
          onClick={() => M.runBacktest.mutate(params)}
          title={M.connected ? undefined : "Service not deployed yet"}
          className="mt-4 flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          data-testid="button-markov-run"
        >
          <Play className="h-3.5 w-3.5" />
          {M.runBacktest.isPending ? "Running…" : "Run Backtest"}
        </button>
        {M.runBacktest.error && (
          <p className="text-[11px] text-red-400 mt-2">{M.runBacktest.error.message}</p>
        )}
      </section>

      {/* ── Backtest results — only renders after a successful run ─────────── */}
      {M.runBacktest.isPending && (
        <section className="bg-card border border-card-border rounded-xl p-4 flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span>Running backtest — fetching price history from FMP and fitting the HMM…</span>
        </section>
      )}

      {M.runBacktest.data && !M.runBacktest.isPending && (
        <BacktestResults result={M.runBacktest.data} />
      )}

      {!M.runBacktest.data && !M.runBacktest.isPending && !M.runBacktest.error && (
        <section className="bg-card border border-card-border rounded-xl p-4">
          <h2 className="text-sm font-bold text-foreground flex items-center gap-2 mb-3">
            <FlaskConical className="h-4 w-4 text-primary" /> Expected output
          </h2>
          <ul className="text-xs text-muted-foreground space-y-1.5 list-disc list-inside">
            <li><strong>Regime table</strong> — per-state mean return and volatility (in original units), so each regime is readable as "bull / chop / drawdown".</li>
            <li><strong>OOS performance</strong> — CAGR, Sharpe, Sortino, max drawdown, hit rate. Reported three ways: net of costs, gross, and buy &amp; hold for the same window.</li>
            <li><strong>Equity curve</strong> — strategy vs buy &amp; hold.</li>
            <li><strong>Position trace</strong> — sized position over time, including shorts when enabled.</li>
          </ul>
        </section>
      )}
    </div>
  );
}

// ─── Backtest results ──────────────────────────────────────────────────────────

function BacktestResults({ result }: { result: MarkovBacktestResult }) {
  return (
    <>
      <RegimeStatsCard stats={result.regime_stats} />
      <PerformanceCard performance={result.performance} />
      <EquityCurveCard equity={result.equity_curve} />
      <PositionTraceCard positions={result.positions} />
    </>
  );
}

function RegimeStatsCard({ stats }: { stats: MarkovBacktestResult["regime_stats"] }) {
  // Label each state by sign of expected return so it reads as "bull / chop / drawdown".
  const labeled = stats.map((s) => ({
    ...s,
    label: s.mean_return > 0.0005 ? "bullish" : s.mean_return < -0.0005 ? "drawdown" : "chop",
  }));
  return (
    <section className="bg-card border border-card-border rounded-xl p-4">
      <h2 className="text-sm font-bold text-foreground flex items-center gap-2 mb-3">
        <Activity className="h-4 w-4 text-primary" /> Regime stats (training)
      </h2>
      <DataTable<typeof labeled[number]>
        columns={[
          { key: "state", header: "State", sortValue: s => s.state, accessor: s => <span className="font-mono font-bold">{s.state}</span> },
          { key: "label", header: "Read as", sortValue: s => s.label, accessor: s => (
            <span className={`inline-flex px-1.5 py-0.5 rounded text-mini font-bold uppercase ${
              s.label === "bullish" ? "bg-bull/15 text-bull-light"
              : s.label === "drawdown" ? "bg-bear/15 text-bear-light"
              : "bg-watch/15 text-watch-light"
            }`}>{s.label}</span>
          )},
          { key: "mean_return", header: "Mean daily return", type: "number", sortValue: s => s.mean_return, accessor: s => (
            <span className={s.mean_return >= 0 ? "text-bull-light" : "text-bear-light"}>{(s.mean_return * 100).toFixed(3)}%</span>
          )},
          { key: "volatility", header: "Daily volatility", type: "number", sortValue: s => s.volatility, accessor: s => `${(s.volatility * 100).toFixed(3)}%` },
        ]}
        data={labeled}
        getRowKey={s => s.state}
        dense
      />
    </section>
  );
}

function PerformanceCard({ performance }: { performance: MarkovBacktestResult["performance"] }) {
  const rows: { key: keyof MarkovPerformance; label: string; pct: boolean }[] = [
    { key: "cagr",         label: "CAGR",          pct: true  },
    { key: "sharpe",       label: "Sharpe",        pct: false },
    { key: "sortino",      label: "Sortino",       pct: false },
    { key: "max_drawdown", label: "Max drawdown",  pct: true  },
    { key: "hit_rate",     label: "Hit rate",      pct: true  },
  ];

  const cols: { key: keyof MarkovBacktestResult["performance"]; label: string; tone: string }[] = [
    { key: "net",   label: "Net (after costs)", tone: "text-foreground font-bold" },
    { key: "gross", label: "Gross",             tone: "text-muted-foreground" },
    { key: "bh",    label: "Buy & Hold",        tone: "text-muted-foreground" },
  ];

  const fmt = (v: number, pct: boolean) =>
    pct ? `${(v * 100).toFixed(2)}%` : v.toFixed(2);

  // Color the net row based on whether it beats buy & hold.
  const colorize = (v: number, bh: number, isReturn: boolean) => {
    if (!isReturn) return "";
    return v > bh ? "text-green-400" : v < bh ? "text-red-400" : "";
  };

  return (
    <section className="bg-card border border-card-border rounded-xl p-4">
      <h2 className="text-sm font-bold text-foreground flex items-center gap-2 mb-3">
        <BarChart3 className="h-4 w-4 text-primary" /> Out-of-sample performance
      </h2>
      <DataTable<typeof rows[number]>
        columns={[
          { key: "metric", header: "Metric", sortValue: r => r.label, accessor: r => <span className="font-semibold">{r.label}</span> },
          ...cols.map(c => ({
            key: c.key,
            header: c.label,
            type: "number" as const,
            sortValue: (r: typeof rows[number]) => performance[c.key][r.key],
            accessor: (r: typeof rows[number]) => {
              const isReturn = r.key === "cagr" || r.key === "hit_rate";
              const v = performance[c.key][r.key];
              const bhVal = performance.bh[r.key];
              const extra = c.key === "net" ? colorize(v, bhVal, isReturn) : "";
              return <span className={`${c.tone} ${extra}`}>{fmt(v, r.pct)}</span>;
            },
          } as DataTableColumn<typeof rows[number]>)),
        ]}
        data={rows}
        getRowKey={r => r.key}
        dense
      />
      <p className="text-[10px] text-muted-foreground/70 mt-2 italic">
        Net = after transaction costs you set. Gross = before costs. Buy &amp; Hold = same window, no strategy.
        Green/red on the Net column shows whether the strategy beat buy &amp; hold on that metric.
      </p>
    </section>
  );
}

function EquityCurveCard({ equity }: { equity: MarkovBacktestResult["equity_curve"] }) {
  const data = useMemo(() => equity, [equity]);
  const end = data[data.length - 1];
  const stratPct = end ? (end.strategy - 1) * 100 : 0;
  const bhPct = end ? (end.bh - 1) * 100 : 0;

  return (
    <section className="bg-card border border-card-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" /> Equity curve
        </h2>
        <div className="flex items-center gap-3 text-[11px] tabular-nums">
          <span><span className="inline-block h-2 w-2 rounded-full bg-purple-400 mr-1.5"></span>Strategy: {stratPct >= 0 ? "+" : ""}{stratPct.toFixed(1)}%</span>
          <span><span className="inline-block h-2 w-2 rounded-full bg-gray-400 mr-1.5"></span>B&amp;H: {bhPct >= 0 ? "+" : ""}{bhPct.toFixed(1)}%</span>
        </div>
      </div>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              tickLine={false} axisLine={{ stroke: "hsl(var(--card-border))" }}
              minTickGap={50} />
            <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              tickLine={false} axisLine={{ stroke: "hsl(var(--card-border))" }}
              tickFormatter={(v) => v.toFixed(2)} width={50} />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--card-border))",
                borderRadius: 6, fontSize: 11,
              }}
              formatter={(value: number, name: string) => [
                value.toFixed(3),
                name === "strategy" ? "Strategy" : "Buy & Hold",
              ]} />
            <Line type="monotone" dataKey="strategy" stroke="#a78bfa" strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="bh" stroke="#9ca3af" strokeWidth={1.5} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function PositionTraceCard({ positions }: { positions: MarkovBacktestResult["positions"] }) {
  return (
    <section className="bg-card border border-card-border rounded-xl p-4">
      <h2 className="text-sm font-bold text-foreground flex items-center gap-2 mb-3">
        <Activity className="h-4 w-4 text-primary" /> Position trace
      </h2>
      <p className="text-[10px] text-muted-foreground/70 mb-3 italic">
        Vol-targeted position size over time. Positive = long, negative = short (when allowed). Flat lines = min-hold filter holding the position steady.
      </p>
      <div className="h-48 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={positions} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              tickLine={false} axisLine={{ stroke: "hsl(var(--card-border))" }}
              minTickGap={50} />
            <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              tickLine={false} axisLine={{ stroke: "hsl(var(--card-border))" }}
              tickFormatter={(v) => v.toFixed(2)} width={50} />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--card-border))",
                borderRadius: 6, fontSize: 11,
              }}
              formatter={(value: number) => [value.toFixed(3), "Position"]} />
            <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="2 2" />
            <Line type="monotone" dataKey="position" stroke="#60a5fa" strokeWidth={1.5} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function ExperimentalBanner() {
  return (
    <div className="flex items-start gap-2 px-3 py-2 bg-purple-500/5 border border-purple-500/30 rounded-lg text-[11px] text-purple-200 leading-relaxed">
      <FlaskConical className="h-3.5 w-3.5 mt-0.5 shrink-0 text-purple-400" />
      <span>
        <strong>Experimental.</strong> Research backtester — not a live signal
        and not financial advice. OOS performance is a posterior fit and won't
        match forward results.
      </span>
    </div>
  );
}

function TextField({
  label, value, onChange, type = "text", placeholder, mono = false,
}: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; placeholder?: string; mono?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <input type={type} value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`mt-1 w-full h-9 px-3 text-sm bg-background border border-card-border rounded-md text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 ${mono ? "font-mono" : ""}`} />
    </label>
  );
}

function NumField({
  label, value, step, min, max, onChange, hint,
}: {
  label: string; value: number; step: number; min: number; max: number;
  onChange: (v: number) => void; hint?: string;
}) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <input type="number" value={value} step={step} min={min} max={max}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="mt-1 w-full h-9 px-3 text-sm bg-background border border-card-border rounded-md font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50" />
      {hint && <span className="block mt-1 text-[10px] text-muted-foreground/70">{hint}</span>}
    </label>
  );
}
