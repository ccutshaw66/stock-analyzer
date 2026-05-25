/**
 * Full-page view for the HERMES compartment.
 *
 * Reads ALL data via `useHermes()` (the one canonical hook). No raw
 * `fetch()` to the Railway API lives below this layer — that's the
 * compartment contract.
 *
 * Rendered by `pages/hermes.tsx`, which wraps it in `<PageTemplate>` so
 * the page chrome (icon + title + subtitle) auto-resolves from the page
 * registry (universal-structure rule, 2026-05-15).
 */
import { useState, useMemo, useEffect } from "react";
import {
  Activity, TrendingUp, AlertTriangle, RefreshCw, Save, Loader2,
  FlaskConical, CircleDot, ArrowUpRight, ArrowDownRight, Settings,
  Plus, X, Target,
} from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { HelpBlock, Example } from "@/components/HelpBlock";
import {
  useHermes, HERMES_API, equityTotalPct,
  type HermesStatus, type HermesStats, type HermesTrade,
  type HermesEquity, type HermesGoal, type AssetParams,
} from "./useHermes";

export function HermesFullView() {
  const H = useHermes();

  return (
    <div className="space-y-4">
      <ExperimentalBanner />

      <div className="flex items-center justify-end">
        <button
          onClick={H.refresh}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md bg-muted hover:bg-muted/80 text-foreground transition-colors"
          data-testid="button-hermes-refresh"
        >
          <RefreshCw className="h-3 w-3" />
          Refresh
        </button>
      </div>

      {H.offline && (
        <div className="border border-red-500/30 bg-red-500/5 rounded-lg p-3 flex items-start gap-2 text-xs text-red-300">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Cannot reach HERMES backend.</p>
            <p className="opacity-80 mt-0.5">
              {HERMES_API} is unreachable from this browser. If the dashboard
              is up, this is likely a CORS issue — the Railway service needs
              to allow this origin.
            </p>
          </div>
        </div>
      )}

      <StatusCard status={H.status.data} loading={H.status.isLoading} error={H.status.error} fetching={H.status.isFetching} />
      <StatsCard stats={H.stats.data} loading={H.stats.isLoading} error={H.stats.error} fetching={H.stats.isFetching} />
      <EquityCurve equity={H.equity.data} loading={H.equity.isLoading} error={H.equity.error} fetching={H.equity.isFetching} />
      <ManageAssets
        assets={H.status.data?.assets ?? []}
        addAsset={(p) => H.addAsset.mutate(p)}
        removeAsset={(s) => H.removeAsset.mutate(s)}
        addPending={H.addAsset.isPending}
        removePending={H.removeAsset.isPending}
        removeTarget={H.removeAsset.variables ?? null}
        addError={H.addAsset.error}
        removeError={H.removeAsset.error}
      />
      <StrategyEditor
        assets={H.status.data?.assets ?? []}
        onSave={(asset, params) => H.updateStrategy.mutate({ asset, params })}
        pending={H.updateStrategy.isPending}
        pendingAsset={H.updateStrategy.variables?.asset ?? null}
        error={H.updateStrategy.error}
      />
      <GoalSettings
        goal={H.goal.data}
        fetching={H.goal.isFetching}
        onSave={(p) => H.updateGoal.mutate(p)}
        pending={H.updateGoal.isPending}
        error={H.updateGoal.error}
      />
      <TradesTable trades={H.trades.data} loading={H.trades.isLoading} error={H.trades.error} fetching={H.trades.isFetching} />
    </div>
  );
}

// ─── Banner ────────────────────────────────────────────────────────────────────

function ExperimentalBanner() {
  return (
    <div className="flex items-start gap-2 px-3 py-2 bg-purple-500/5 border border-purple-500/30 rounded-lg text-[11px] text-purple-200 leading-relaxed">
      <FlaskConical className="h-3.5 w-3.5 mt-0.5 shrink-0 text-purple-400" />
      <span>
        <strong>Experimental.</strong> HERMES is a research auto-trader running
        outside Stock Otter on Railway. The numbers here come from that service
        in real time — they are not paper trades, not backtests, and may change
        without warning. Use at your own risk.
      </span>
    </div>
  );
}

// ─── Status ────────────────────────────────────────────────────────────────────

function StatusCard({
  status, loading, error, fetching,
}: { status: HermesStatus | undefined; loading: boolean; error: unknown; fetching: boolean }) {
  return (
    <section className="bg-card border border-card-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" /> Engine Status
        </h2>
        {fetching && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      </div>

      {loading ? (
        <SkeletonRow />
      ) : error || !status ? (
        <p className="text-xs text-muted-foreground">No status available.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <StatusPill state={status.status} />
            <span className="text-[11px] text-muted-foreground">
              Strategy version <span className="font-mono text-foreground">{status.strategy_version}</span>
            </span>
            <span className="text-[11px] text-muted-foreground">
              {status.assets.length} assets · {status.positions.length} open positions
            </span>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {status.assets.map((a) => {
              const vol = status.volatilities[a];
              const size = status.position_sizes[a];
              const rsi = status.rsi_values?.[a];
              const hasPosition = status.positions.includes(a as unknown as never);
              const rsiColor =
                rsi == null ? "text-muted-foreground"
                : rsi < 30 ? "text-bull-light"
                : rsi > 70 ? "text-bear-light"
                : "text-foreground";
              return (
                <div key={a} className="rounded-lg border border-card-border/60 bg-background/40 p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold text-sm text-foreground">{a}</span>
                    <div className="flex items-center gap-1.5">
                      {hasPosition && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-bull-light/15 text-bull-light">
                          Open
                        </span>
                      )}
                      <CircleDot className="h-3 w-3 text-bull-light" />
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                    <div>
                      <p className="text-muted-foreground">RSI</p>
                      <p className={`tabular-nums font-semibold ${rsiColor}`}>
                        {rsi != null ? rsi.toFixed(1) : "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Volatility</p>
                      <p className="tabular-nums font-semibold text-foreground">
                        {vol != null ? (vol * 100).toFixed(1) + "%" : "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Size</p>
                      <p className="tabular-nums font-semibold text-foreground">
                        {size != null ? (size * 100).toFixed(1) + "%" : "—"}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

function StatusPill({ state }: { state: string }) {
  const isOnline = state?.toLowerCase() === "online";
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
        isOnline ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${isOnline ? "bg-green-400" : "bg-red-400"}`} />
      {state || "unknown"}
    </span>
  );
}

// ─── Stats ─────────────────────────────────────────────────────────────────────

function StatsCard({
  stats, loading, error, fetching,
}: { stats: HermesStats | undefined; loading: boolean; error: unknown; fetching: boolean }) {
  return (
    <section className="bg-card border border-card-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" /> Performance
        </h2>
        {fetching && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      </div>

      {loading ? (
        <SkeletonRow />
      ) : error || !stats ? (
        <p className="text-xs text-muted-foreground">No stats available.</p>
      ) : (
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-5">
          <StatTile label="Total trades" value={stats.total_trades.toString()} />
          <StatTile label="Win rate" value={stats.win_rate.toFixed(1) + "%"}
            tone={stats.win_rate >= 50 ? "good" : "bad"} />
          <StatTile label="Total P/L"
            value={(stats.total_pnl >= 0 ? "+" : "") + stats.total_pnl.toFixed(2) + "%"}
            tone={stats.total_pnl >= 0 ? "good" : "bad"} />
          <StatTile label="Sharpe" value={stats.sharpe.toFixed(2)}
            tone={stats.sharpe >= 1 ? "good" : stats.sharpe >= 0 ? "neutral" : "bad"} />
          <StatTile label="Max drawdown" value={stats.max_drawdown.toFixed(2) + "%"} tone="bad" />
        </div>
      )}
    </section>
  );
}

function StatTile({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "good" | "bad" | "neutral" }) {
  const color =
    tone === "good" ? "text-green-400" : tone === "bad" ? "text-red-400" : "text-foreground";
  return (
    <div className="rounded-lg border border-card-border/60 bg-background/40 p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-1 text-lg font-bold tabular-nums ${color}`}>{value}</p>
    </div>
  );
}

// ─── Equity Curve ──────────────────────────────────────────────────────────────

function EquityCurve({
  equity, loading, error, fetching,
}: { equity: HermesEquity | undefined; loading: boolean; error: unknown; fetching: boolean }) {
  const data = useMemo(
    () => (equity?.equity ?? []).map((v, i) => ({ i, equity: v })),
    [equity]
  );
  const totalPct = equityTotalPct(equity?.equity);

  return (
    <section className="bg-card border border-card-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" /> Equity Curve
        </h2>
        <div className="flex items-center gap-3">
          {data.length > 0 && (
            <span className={`text-[11px] font-bold tabular-nums ${totalPct >= 0 ? "text-green-400" : "text-red-400"}`}>
              {totalPct >= 0 ? "+" : ""}
              {totalPct.toFixed(2)}%
            </span>
          )}
          {fetching && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        </div>
      </div>

      {loading ? (
        <SkeletonRow />
      ) : error || data.length === 0 ? (
        <p className="text-xs text-muted-foreground">No equity history yet.</p>
      ) : (
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
              <XAxis dataKey="i" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false} axisLine={{ stroke: "hsl(var(--card-border))" }} />
              <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false} axisLine={{ stroke: "hsl(var(--card-border))" }}
                tickFormatter={(v) => v.toFixed(2)} width={50} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--card-border))",
                  borderRadius: 6, fontSize: 11,
                }}
                labelFormatter={(label) => `Trade ${label}`}
                formatter={(value: number) => [value.toFixed(2), "Equity"]} />
              <Line type="monotone" dataKey="equity" stroke="#a78bfa" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}

// ─── Manage Assets ─────────────────────────────────────────────────────────────

function ManageAssets({
  assets, addAsset, removeAsset, addPending, removePending, removeTarget, addError, removeError,
}: {
  assets: string[];
  addAsset: (p: { symbol: string; threshold: number; stop_loss_pct: number }) => void;
  removeAsset: (s: string) => void;
  addPending: boolean;
  removePending: boolean;
  removeTarget: string | null;
  addError: unknown;
  removeError: unknown;
}) {
  const [symbol, setSymbol] = useState("");
  const [threshold, setThreshold] = useState(30);
  const [stopLossPct, setStopLossPct] = useState(2);

  const submit = () => {
    const s = symbol.trim().toUpperCase();
    if (!s) return;
    addAsset({ symbol: s, threshold, stop_loss_pct: stopLossPct });
    setSymbol("");
  };

  return (
    <section className="bg-card border border-card-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
          <Settings className="h-4 w-4 text-primary" /> Manage Assets
        </h2>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px_120px_auto] gap-2 items-end">
        <label className="block">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Symbol</span>
          <input type="text" value={symbol} onChange={(e) => setSymbol(e.target.value)}
            placeholder="SPY, QQQ, BTC"
            className="mt-1 w-full h-9 px-3 text-sm bg-background border border-card-border rounded-md font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
            data-testid="input-asset-symbol" />
        </label>
        <NumberField label="RSI Threshold" value={threshold} step={1} min={0} max={100} onChange={setThreshold} />
        <NumberField label="Stop Loss %" value={stopLossPct} step={0.25} min={0} max={50} onChange={setStopLossPct} />
        <button onClick={submit} disabled={addPending || !symbol.trim()}
          className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-semibold bg-green-500/15 text-green-400 hover:bg-green-500/25 disabled:opacity-50 transition-colors"
          data-testid="button-add-asset">
          {addPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
          Add Asset
        </button>
      </div>
      {addError instanceof Error && <p className="text-[11px] text-red-400 mt-2">{addError.message}</p>}

      <div className="mt-3 space-y-1">
        {assets.length === 0 ? (
          <p className="text-xs text-muted-foreground">No assets connected.</p>
        ) : (
          assets.map((a) => (
            <div key={a}
              className="flex items-center justify-between rounded-md border border-card-border/60 bg-background/40 px-3 py-2"
              data-testid={`asset-row-${a.replace("/", "-")}`}>
              <span className="font-mono font-bold text-sm text-foreground">{a}</span>
              <button
                onClick={() => { if (confirm(`Remove ${a} from HERMES?`)) removeAsset(a); }}
                disabled={removePending}
                className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold bg-red-500/15 text-red-400 hover:bg-red-500/25 disabled:opacity-50 transition-colors"
                data-testid={`button-remove-${a.replace("/", "-")}`}>
                {removePending && removeTarget === a ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                Remove
              </button>
            </div>
          ))
        )}
      </div>
      {removeError instanceof Error && <p className="text-[11px] text-red-400 mt-2">{removeError.message}</p>}
    </section>
  );
}

// ─── Strategy Editor ───────────────────────────────────────────────────────────

function StrategyEditor({
  assets, onSave, pending, pendingAsset, error,
}: {
  assets: string[];
  onSave: (asset: string, params: AssetParams) => void;
  pending: boolean;
  pendingAsset: string | null;
  error: unknown;
}) {
  const [drafts, setDrafts] = useState<Record<string, AssetParams>>({});
  const [savedAsset, setSavedAsset] = useState<string | null>(null);

  const getDraft = (asset: string): AssetParams =>
    drafts[asset] ?? { threshold: 0.5, stop_loss_pct: 2.0 };

  const updateDraft = (asset: string, patch: Partial<AssetParams>) => {
    setDrafts((d) => ({ ...d, [asset]: { ...getDraft(asset), ...patch } }));
  };

  const save = (asset: string) => {
    onSave(asset, getDraft(asset));
    setSavedAsset(asset);
    setTimeout(() => setSavedAsset((s) => (s === asset ? null : s)), 2500);
  };

  return (
    <section className="bg-card border border-card-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
          <Settings className="h-4 w-4 text-primary" /> Strategy Parameters
        </h2>
      </div>

      <HelpBlock title="What these numbers mean">
        <p>
          <strong>Threshold</strong> — the signal score at which HERMES enters
          a trade. Higher = more selective, fewer trades. Lower = more trades,
          more noise.
        </p>
        <p>
          <strong>Stop loss %</strong> — automatic exit if a position moves
          against you by this percentage of entry price.
        </p>
        <Example type="good">
          Set BTC/USD threshold to 0.6 and stop loss to 3% → HERMES only opens
          BTC positions on strong signals, with a 3% protective stop.
        </Example>
      </HelpBlock>

      {assets.length === 0 ? (
        <p className="text-xs text-muted-foreground mt-3">
          No assets reported. Connect to the engine first.
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {assets.map((asset) => {
            const draft = getDraft(asset);
            const isSaving = pending && pendingAsset === asset;
            const wasSaved = savedAsset === asset;
            return (
              <div key={asset}
                className="rounded-lg border border-card-border/60 bg-background/40 p-3 grid grid-cols-1 sm:grid-cols-[120px_1fr_1fr_auto] gap-3 items-end">
                <div>
                  <span className="font-mono font-bold text-sm text-foreground">{asset}</span>
                </div>
                <NumberField label="Threshold" value={draft.threshold} step={0.05} min={0} max={1}
                  onChange={(v) => updateDraft(asset, { threshold: v })} />
                <NumberField label="Stop loss (%)" value={draft.stop_loss_pct} step={0.25} min={0} max={50}
                  onChange={(v) => updateDraft(asset, { stop_loss_pct: v })} />
                <button onClick={() => save(asset)} disabled={isSaving}
                  className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-semibold transition-colors ${
                    wasSaved
                      ? "bg-green-500/15 text-green-400"
                      : "bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  }`}
                  data-testid={`button-save-${asset.replace("/", "-")}`}>
                  {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                  {wasSaved ? "Saved" : "Save"}
                </button>
              </div>
            );
          })}
          {error instanceof Error && <p className="text-[11px] text-red-400">{error.message}</p>}
        </div>
      )}
    </section>
  );
}

// ─── Goal Settings ─────────────────────────────────────────────────────────────

function GoalSettings({
  goal, fetching, onSave, pending, error,
}: {
  goal: HermesGoal | undefined;
  fetching: boolean;
  onSave: (p: { target_return_30d: number; max_drawdown: number; min_sharpe: number }) => void;
  pending: boolean;
  error: unknown;
}) {
  const [targetReturn, setTargetReturn] = useState(5);
  const [maxDrawdown, setMaxDrawdown] = useState(8);
  const [minSharpe, setMinSharpe] = useState(1.2);
  const [saved, setSaved] = useState(false);

  // Hydrate inputs from server values. Server stores returns as decimals
  // (0.05 = 5%); we render them as percent in the UI.
  useEffect(() => {
    if (!goal) return;
    if (typeof goal.target_return_30d === "number") setTargetReturn(goal.target_return_30d * 100);
    if (typeof goal.max_drawdown === "number") setMaxDrawdown(goal.max_drawdown * 100);
    if (typeof goal.min_sharpe === "number") setMinSharpe(goal.min_sharpe);
  }, [goal]);

  const save = () => {
    onSave({
      target_return_30d: targetReturn / 100,
      max_drawdown: maxDrawdown / 100,
      min_sharpe: minSharpe,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <section className="bg-card border border-card-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" /> Goal Settings
        </h2>
        {fetching && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      </div>

      <HelpBlock title="What these targets do">
        <p>
          HERMES uses these as portfolio-level guardrails. If realized drawdown
          breaches the limit or 30-day return lags target, the reflection step
          (<code className="font-mono text-[11px]">reflect.py</code>) tightens
          thresholds on the next strategy update.
        </p>
        <Example type="good">
          5% / 30d target with an 8% max drawdown and Sharpe ≥ 1.2 → moderate
          risk-on. Lower the drawdown to tighten risk; raise target return to
          push HERMES toward more aggressive entries.
        </Example>
      </HelpBlock>

      <div className="mt-3 grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_auto] gap-3 items-end">
        <NumberField label="Target Return (30d) %" value={targetReturn} step={0.5} min={0} max={100} onChange={setTargetReturn} />
        <NumberField label="Max Drawdown %" value={maxDrawdown} step={0.5} min={0} max={100} onChange={setMaxDrawdown} />
        <NumberField label="Min Sharpe" value={minSharpe} step={0.1} min={-5} max={10} onChange={setMinSharpe} />
        <button onClick={save} disabled={pending}
          className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-semibold transition-colors ${
            saved ? "bg-green-500/15 text-green-400" : "bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          }`}
          data-testid="button-save-goals">
          {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          {saved ? "Saved" : "Save Goals"}
        </button>
      </div>
      {error instanceof Error && <p className="text-[11px] text-red-400 mt-2">{error.message}</p>}
    </section>
  );
}

// ─── Trades ────────────────────────────────────────────────────────────────────

function TradesTable({
  trades, loading, error, fetching,
}: { trades: HermesTrade[] | undefined; loading: boolean; error: unknown; fetching: boolean }) {
  const sorted = useMemo(() => {
    const list = trades ?? [];
    return [...list].sort((a, b) => (b.exit_time || "").localeCompare(a.exit_time || ""));
  }, [trades]);

  return (
    <section className="bg-card border border-card-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" /> Recent Trades
        </h2>
        {fetching && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      </div>

      {loading ? (
        <SkeletonRow />
      ) : error ? (
        <p className="text-xs text-muted-foreground">No trades available.</p>
      ) : sorted.length === 0 ? (
        <p className="text-xs text-muted-foreground">No trades yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-2 pr-3 font-semibold">ID</th>
                <th className="py-2 pr-3 font-semibold">Asset</th>
                <th className="py-2 pr-3 font-semibold">Side</th>
                <th className="py-2 pr-3 font-semibold text-right">Entry</th>
                <th className="py-2 pr-3 font-semibold text-right">Exit</th>
                <th className="py-2 pr-3 font-semibold text-right">P/L %</th>
                <th className="py-2 pr-3 font-semibold">Exit time</th>
              </tr>
            </thead>
            <tbody>
              {sorted.slice(0, 50).map((t) => {
                const isWin = t.pnl_pct >= 0;
                return (
                  <tr key={t.id} className="border-t border-card-border/40">
                    <td className="py-2 pr-3 font-mono text-muted-foreground">{t.id}</td>
                    <td className="py-2 pr-3 font-mono font-bold text-foreground">{t.asset}</td>
                    <td className="py-2 pr-3">
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                          t.direction === "long" ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"
                        }`}>
                        {t.direction === "long" ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                        {t.direction}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-foreground">{t.entry_price.toLocaleString()}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-foreground">{t.exit_price.toLocaleString()}</td>
                    <td className={`py-2 pr-3 text-right tabular-nums font-bold ${isWin ? "text-green-400" : "text-red-400"}`}>
                      {isWin ? "+" : ""}
                      {t.pnl_pct.toFixed(2)}%
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground tabular-nums">
                      {t.exit_time ? new Date(t.exit_time).toLocaleString() : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ─── Shared bits ───────────────────────────────────────────────────────────────

function NumberField({
  label, value, step, min, max, onChange,
}: { label: string; value: number; step: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <input type="number" value={value} step={step} min={min} max={max}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="mt-1 w-full h-9 px-3 text-sm bg-background border border-card-border rounded-md font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50" />
    </label>
  );
}

function SkeletonRow() {
  return (
    <div className="animate-pulse space-y-2">
      <div className="h-4 w-1/3 bg-muted rounded" />
      <div className="h-3 w-1/2 bg-muted/70 rounded" />
    </div>
  );
}
