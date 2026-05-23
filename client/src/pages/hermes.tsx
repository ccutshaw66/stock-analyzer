import { useState, useMemo } from "react";
import {
  useQuery, useMutation, useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import {
  Bot, Activity, TrendingUp, AlertTriangle,
  RefreshCw, Save, Loader2, FlaskConical, CircleDot,
  ArrowUpRight, ArrowDownRight, Settings,
} from "lucide-react";
import { Disclaimer } from "@/components/Disclaimer";
import { HelpBlock, Example } from "@/components/HelpBlock";

const HERMES_API = "https://hermes-dashboard-production-d0ee.up.railway.app";

interface HermesStatus {
  status: string;
  assets: string[];
  positions: any[];
  volatilities: Record<string, number>;
  position_sizes: Record<string, number>;
  strategy_version: string;
}

interface HermesStats {
  total_trades: number;
  win_rate: number;
  total_pnl: number;
  sharpe: number;
  max_drawdown: number;
}

interface HermesTrade {
  id: string;
  asset: string;
  direction: "long" | "short";
  entry_price: number;
  exit_price: number;
  pnl_pct: number;
  exit_time: string;
}

async function hermesFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${HERMES_API}${path}`);
  if (!res.ok) throw new Error(`HERMES ${path} → ${res.status}`);
  return res.json();
}

export default function HermesPage() {
  const qc = useQueryClient();

  const statusQ = useQuery<HermesStatus>({
    queryKey: ["hermes", "status"],
    queryFn: () => hermesFetch<HermesStatus>("/api/status"),
    refetchInterval: 15_000,
    retry: 1,
  });
  const statsQ = useQuery<HermesStats>({
    queryKey: ["hermes", "stats"],
    queryFn: () => hermesFetch<HermesStats>("/api/stats"),
    refetchInterval: 30_000,
    retry: 1,
  });
  const tradesQ = useQuery<HermesTrade[]>({
    queryKey: ["hermes", "trades"],
    queryFn: () => hermesFetch<HermesTrade[]>("/api/trades"),
    refetchInterval: 30_000,
    retry: 1,
  });

  const offline =
    !!statusQ.error && !!statsQ.error && !!tradesQ.error;

  return (
    <div className="p-3 sm:p-6 space-y-4 max-w-7xl mx-auto">
      <ExperimentalBanner />

      <header className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-lg bg-purple-500/15 flex items-center justify-center shrink-0">
          <Bot className="h-5 w-5 text-purple-400" />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-foreground flex items-center gap-2">
            HERMES
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 uppercase tracking-wider">
              Auto Trader
            </span>
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Live connection to the HERMES strategy engine on Railway. Read live
            status / stats / trades and adjust thresholds per asset.
          </p>
        </div>
        <button
          onClick={() => {
            qc.invalidateQueries({ queryKey: ["hermes"] });
          }}
          className="ml-auto shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md bg-muted hover:bg-muted/80 text-foreground transition-colors"
          data-testid="button-hermes-refresh"
        >
          <RefreshCw className="h-3 w-3" />
          Refresh
        </button>
      </header>

      {offline && (
        <div className="border border-red-500/30 bg-red-500/5 rounded-lg p-3 flex items-start gap-2 text-xs text-red-300">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Cannot reach HERMES backend.</p>
            <p className="opacity-80 mt-0.5">
              {HERMES_API} is unreachable from this browser. If the dashboard is
              up, this is likely a CORS issue — the Railway service needs to
              allow this origin.
            </p>
          </div>
        </div>
      )}

      <StatusCard q={statusQ} />
      <StatsCard q={statsQ} />
      <StrategyEditor status={statusQ.data} />
      <TradesTable q={tradesQ} />

      <Disclaimer />
    </div>
  );
}

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

function StatusCard({ q }: { q: UseQueryResult<HermesStatus, Error> }) {
  return (
    <section className="bg-card border border-card-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" /> Engine Status
        </h2>
        {q.isFetching && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      </div>

      {q.isLoading ? (
        <SkeletonRow />
      ) : q.error || !q.data ? (
        <p className="text-xs text-muted-foreground">No status available.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <StatusPill state={q.data.status} />
            <span className="text-[11px] text-muted-foreground">
              Strategy version <span className="font-mono text-foreground">{q.data.strategy_version}</span>
            </span>
            <span className="text-[11px] text-muted-foreground">
              {q.data.assets.length} assets · {q.data.positions.length} open positions
            </span>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {q.data.assets.map((a) => {
              const vol = q.data!.volatilities[a];
              const size = q.data!.position_sizes[a];
              return (
                <div key={a} className="rounded-lg border border-card-border/60 bg-background/40 p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold text-sm text-foreground">{a}</span>
                    <CircleDot className="h-3 w-3 text-green-400" />
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                    <div>
                      <p className="text-muted-foreground">Volatility</p>
                      <p className="tabular-nums font-semibold text-foreground">
                        {vol != null ? (vol * 100).toFixed(1) + "%" : "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Position size</p>
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

function StatsCard({ q }: { q: UseQueryResult<HermesStats, Error> }) {
  return (
    <section className="bg-card border border-card-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" /> Performance
        </h2>
        {q.isFetching && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      </div>

      {q.isLoading ? (
        <SkeletonRow />
      ) : q.error || !q.data ? (
        <p className="text-xs text-muted-foreground">No stats available.</p>
      ) : (
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-5">
          <StatTile label="Total trades" value={q.data.total_trades.toString()} />
          <StatTile
            label="Win rate"
            value={q.data.win_rate.toFixed(1) + "%"}
            tone={q.data.win_rate >= 50 ? "good" : "bad"}
          />
          <StatTile
            label="Total P/L"
            value={(q.data.total_pnl >= 0 ? "+" : "") + q.data.total_pnl.toFixed(2) + "%"}
            tone={q.data.total_pnl >= 0 ? "good" : "bad"}
          />
          <StatTile
            label="Sharpe"
            value={q.data.sharpe.toFixed(2)}
            tone={q.data.sharpe >= 1 ? "good" : q.data.sharpe >= 0 ? "neutral" : "bad"}
          />
          <StatTile
            label="Max drawdown"
            value={q.data.max_drawdown.toFixed(2) + "%"}
            tone="bad"
          />
        </div>
      )}
    </section>
  );
}

function StatTile({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "good" | "bad" | "neutral";
}) {
  const color =
    tone === "good" ? "text-green-400" : tone === "bad" ? "text-red-400" : "text-foreground";
  return (
    <div className="rounded-lg border border-card-border/60 bg-background/40 p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-1 text-lg font-bold tabular-nums ${color}`}>{value}</p>
    </div>
  );
}

// ─── Strategy Editor ───────────────────────────────────────────────────────────

interface AssetParams {
  threshold: number;
  stop_loss_pct: number;
}

function StrategyEditor({ status }: { status: HermesStatus | undefined }) {
  const assets = status?.assets ?? [];
  const [drafts, setDrafts] = useState<Record<string, AssetParams>>({});
  const [savedAsset, setSavedAsset] = useState<string | null>(null);

  const getDraft = (asset: string): AssetParams =>
    drafts[asset] ?? { threshold: 0.5, stop_loss_pct: 2.0 };

  const updateDraft = (asset: string, patch: Partial<AssetParams>) => {
    setDrafts((d) => ({ ...d, [asset]: { ...getDraft(asset), ...patch } }));
  };

  const mut = useMutation({
    mutationFn: async ({ asset, params }: { asset: string; params: AssetParams }) => {
      const res = await fetch(`${HERMES_API}/api/strategy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assets: { [asset]: params } }),
      });
      if (!res.ok) throw new Error(`Strategy update failed: ${res.status}`);
      return asset;
    },
    onSuccess: (asset) => {
      setSavedAsset(asset);
      setTimeout(() => setSavedAsset((s) => (s === asset ? null : s)), 2500);
    },
  });

  return (
    <section className="bg-card border border-card-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
          <Settings className="h-4 w-4 text-primary" /> Strategy Parameters
        </h2>
      </div>

      <HelpBlock title="What these numbers mean">
        <p>
          <strong>Threshold</strong> — the signal score at which HERMES enters a
          trade. Higher = more selective, fewer trades. Lower = more trades,
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
            const isSaving = mut.isPending && mut.variables?.asset === asset;
            const wasSaved = savedAsset === asset;
            return (
              <div
                key={asset}
                className="rounded-lg border border-card-border/60 bg-background/40 p-3 grid grid-cols-1 sm:grid-cols-[120px_1fr_1fr_auto] gap-3 items-end"
              >
                <div>
                  <span className="font-mono font-bold text-sm text-foreground">{asset}</span>
                </div>
                <NumberField
                  label="Threshold"
                  value={draft.threshold}
                  step={0.05}
                  min={0}
                  max={1}
                  onChange={(v) => updateDraft(asset, { threshold: v })}
                />
                <NumberField
                  label="Stop loss (%)"
                  value={draft.stop_loss_pct}
                  step={0.25}
                  min={0}
                  max={50}
                  onChange={(v) => updateDraft(asset, { stop_loss_pct: v })}
                />
                <button
                  onClick={() => mut.mutate({ asset, params: draft })}
                  disabled={isSaving}
                  className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-semibold transition-colors ${
                    wasSaved
                      ? "bg-green-500/15 text-green-400"
                      : "bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  }`}
                  data-testid={`button-save-${asset.replace("/", "-")}`}
                >
                  {isSaving ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Save className="h-3 w-3" />
                  )}
                  {wasSaved ? "Saved" : "Save"}
                </button>
              </div>
            );
          })}
          {mut.error && (
            <p className="text-[11px] text-red-400">
              {(mut.error as Error).message}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function NumberField({
  label,
  value,
  step,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="mt-1 w-full h-9 px-3 text-sm bg-background border border-card-border rounded-md font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
      />
    </label>
  );
}

// ─── Trades ────────────────────────────────────────────────────────────────────

function TradesTable({ q }: { q: UseQueryResult<HermesTrade[], Error> }) {
  const trades = useMemo(() => {
    const list = q.data ?? [];
    return [...list].sort((a, b) => (b.exit_time || "").localeCompare(a.exit_time || ""));
  }, [q.data]);

  return (
    <section className="bg-card border border-card-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" /> Recent Trades
        </h2>
        {q.isFetching && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      </div>

      {q.isLoading ? (
        <SkeletonRow />
      ) : q.error ? (
        <p className="text-xs text-muted-foreground">No trades available.</p>
      ) : trades.length === 0 ? (
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
              {trades.slice(0, 50).map((t) => {
                const isWin = t.pnl_pct >= 0;
                return (
                  <tr key={t.id} className="border-t border-card-border/40">
                    <td className="py-2 pr-3 font-mono text-muted-foreground">{t.id}</td>
                    <td className="py-2 pr-3 font-mono font-bold text-foreground">{t.asset}</td>
                    <td className="py-2 pr-3">
                      <span
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                          t.direction === "long"
                            ? "bg-green-500/15 text-green-400"
                            : "bg-red-500/15 text-red-400"
                        }`}
                      >
                        {t.direction === "long" ? (
                          <ArrowUpRight className="h-3 w-3" />
                        ) : (
                          <ArrowDownRight className="h-3 w-3" />
                        )}
                        {t.direction}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-foreground">
                      {t.entry_price.toLocaleString()}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-foreground">
                      {t.exit_price.toLocaleString()}
                    </td>
                    <td
                      className={`py-2 pr-3 text-right tabular-nums font-bold ${
                        isWin ? "text-green-400" : "text-red-400"
                      }`}
                    >
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

function SkeletonRow() {
  return (
    <div className="animate-pulse space-y-2">
      <div className="h-4 w-1/3 bg-muted rounded" />
      <div className="h-3 w-1/2 bg-muted/70 rounded" />
    </div>
  );
}
