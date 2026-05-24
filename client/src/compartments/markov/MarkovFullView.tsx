/**
 * Full-page view for the Markov compartment.
 *
 * All Markov state and any future backend calls flow through `useMarkov()`
 * (the one canonical hook). When the Python service is deployed, the hook
 * exposes `runBacktest`; this view will wire results in without changing
 * the page chrome.
 */
import { useState } from "react";
import { FlaskConical, Play, AlertTriangle, Info } from "lucide-react";
import { HelpBlock, Example } from "@/components/HelpBlock";
import { useMarkov, DEFAULT_PARAMS, type MarkovParams } from "./useMarkov";

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

      <HelpBlock title="How the model works" defaultOpen>
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
    </div>
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
