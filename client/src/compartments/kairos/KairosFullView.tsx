/**
 * KAIROS full view — page UI for /kairos.
 *
 * Sections:
 *   1. Header strip — status pill (online/offline), equity / win-rate stats
 *   2. Watchlist table — each ticker with HTF + BBTC state + current price
 *   3. Open positions — symbol, entry strategy tag, P/L, stop/target
 *   4. Trade log — recent closed trades with exit reason
 *
 * Bot offline state (Milestone 1, before Python bot is deployed): the
 * `useKairos` hook returns `offline = true`, header shows "OFFLINE" pill,
 * sections show their empty-state placeholders. Layout is the final shape;
 * just nothing in it yet.
 */
import { useMemo } from "react";
import {
  Activity, Loader2, AlertCircle, CircleDot, Wallet, Percent, Award,
  TrendingUp, TrendingDown, Minus, DollarSign, PiggyBank,
} from "lucide-react";
import { LineChart, Line, ResponsiveContainer } from "recharts";
import {
  useKairos, equityTotalPct, winRatePct,
  equityDollars, currentEquityDollars, totalPnlDollars, DEFAULT_STARTING_EQUITY,
  type KairosStatus, type KairosTrade, type KairosWatchlistRow, type KairosEquity,
} from "./useKairos";

export function KairosFullView() {
  const K = useKairos();
  const startingEquity = K.goal.data?.starting_equity ?? DEFAULT_STARTING_EQUITY;
  return (
    <div className="space-y-4">
      <AccountCard
        equity={K.equity.data}
        startingEquity={startingEquity}
        startingFromGoal={typeof K.goal.data?.starting_equity === "number"}
        loading={K.equity.isLoading}
        fetching={K.equity.isFetching}
      />
      <HeaderStrip
        status={K.status.data}
        equity={K.equity.data?.equity}
        startingEquity={startingEquity}
        trades={K.trades.data}
        loading={K.status.isLoading}
        offline={K.offline}
      />
      <WatchlistSection rows={K.watchlist.data} loading={K.watchlist.isLoading} offline={K.offline} />
      <PositionsSection status={K.status.data} offline={K.offline} />
      <TradesSection trades={K.trades.data} loading={K.trades.isLoading} offline={K.offline} />
    </div>
  );
}

// ─── Account card (warm-and-fuzzy dollar amounts) ─────────────────────────────

function AccountCard({
  equity, startingEquity, startingFromGoal, loading, fetching,
}: {
  equity: KairosEquity | undefined;
  startingEquity: number;
  startingFromGoal: boolean;
  loading: boolean;
  fetching: boolean;
}) {
  const current = currentEquityDollars(equity?.equity, startingEquity);
  const pnlDollars = totalPnlDollars(equity?.equity, startingEquity);
  const pnlPct = equityTotalPct(equity?.equity);
  const isUp = pnlDollars >= 0;
  const pnlColor = isUp ? "text-bull-light" : "text-bear-light";

  return (
    <section className="bg-card border border-card-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
          <Wallet className="h-4 w-4 text-primary" /> Account
        </h2>
        {fetching && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      </div>

      {loading ? (
        <SkeletonRow />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-lg border border-card-border/60 bg-background/40 p-3">
            <div className="flex items-center gap-1 mb-1">
              <PiggyBank className="h-3 w-3 text-muted-foreground" />
              <span className="text-mini font-semibold text-muted-foreground uppercase tracking-wider">Starting</span>
            </div>
            <p className="text-xl font-bold tabular-nums font-mono text-foreground">
              ${startingEquity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            {!startingFromGoal && (
              <p className="text-mini text-muted-foreground mt-0.5">
                Default — add <code className="font-mono">starting_equity: 10000</code> to goal.yaml on the bot to change.
              </p>
            )}
          </div>

          <div className="rounded-lg border border-card-border/60 bg-background/40 p-3">
            <div className="flex items-center gap-1 mb-1">
              <DollarSign className={`h-3 w-3 ${pnlColor}`} />
              <span className="text-mini font-semibold text-muted-foreground uppercase tracking-wider">Current value</span>
            </div>
            <p className={`text-xl font-bold tabular-nums font-mono ${pnlColor}`}>
              ${current.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </div>

          <div className="rounded-lg border border-card-border/60 bg-background/40 p-3">
            <div className="flex items-center gap-1 mb-1">
              <TrendingUp className={`h-3 w-3 ${pnlColor}`} />
              <span className="text-mini font-semibold text-muted-foreground uppercase tracking-wider">Total P/L</span>
            </div>
            <p className={`text-xl font-bold tabular-nums font-mono ${pnlColor}`}>
              {isUp ? "+" : ""}${Math.abs(pnlDollars).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            <p className={`text-2xs font-mono tabular-nums mt-0.5 ${pnlColor}`}>
              {isUp ? "+" : ""}{pnlPct.toFixed(2)}%
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

// ─── Header strip ─────────────────────────────────────────────────────────────

function HeaderStrip({ status, equity, startingEquity, trades, loading, offline }: {
  status: KairosStatus | undefined;
  equity: number[] | undefined;
  startingEquity: number;
  trades: KairosTrade[] | undefined;
  loading: boolean;
  offline: boolean;
}) {
  const totalPct = equityTotalPct(equity);
  const winRate = winRatePct(trades);
  const tradeCount = trades?.length ?? 0;

  const sparkData = useMemo(
    () => equityDollars(equity, startingEquity).map((v, i) => ({ i, v })),
    [equity, startingEquity]
  );

  return (
    <section className="bg-card border border-card-border rounded-xl p-4">
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" /> Engine
        </h2>
        <StatusPill state={status?.status} offline={offline} loading={loading} />
        {status?.mode && (
          <span className="px-1.5 py-0.5 rounded text-mini font-semibold uppercase bg-watch/15 text-watch-light">
            {status.mode === "paper" ? "Paper" : "Live"}
          </span>
        )}
        {status?.strategy_version && (
          <span className="text-2xs text-muted-foreground">
            Strategy v<span className="font-mono text-foreground">{status.strategy_version}</span>
          </span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3">
        <Stat
          icon={<Award className="h-3 w-3" />}
          label="Win rate"
          value={tradeCount > 0 ? `${winRate.toFixed(0)}%` : "—"}
          color="text-foreground"
          sub={tradeCount > 0 ? `${tradeCount} trades` : undefined}
        />
        <Stat
          icon={<CircleDot className="h-3 w-3" />}
          label="Open positions"
          value={String(status?.open_positions?.length ?? 0)}
          color="text-foreground"
        />
        <Stat
          icon={<Percent className="h-3 w-3" />}
          label="Watchlist"
          value={String(status?.watchlist?.length ?? 0)}
          color="text-foreground"
          sub="tickers"
        />
      </div>

      {sparkData.length >= 2 && (
        <div className="h-16 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={sparkData} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
              <Line
                type="monotone"
                dataKey="v"
                stroke={totalPct >= 0 ? "rgb(var(--signal-bull-light))" : "rgb(var(--signal-bear-light))"}
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {offline && (
        <div className="mt-3 flex items-start gap-2 text-xs text-muted-foreground border border-card-border/60 bg-muted/20 rounded-lg p-3">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-watch-light" />
          <span>
            <strong className="text-foreground">Bot not deployed yet.</strong> The KAIROS Python service is queued for Milestone 2 (HTF + BBTC strategy ports + Docker on superotter). This page is the final UI shape — data will fill in once the bot comes online.
          </span>
        </div>
      )}
    </section>
  );
}

// ─── Watchlist section ────────────────────────────────────────────────────────

function WatchlistSection({ rows, loading, offline }: {
  rows: KairosWatchlistRow[] | undefined;
  loading: boolean;
  offline: boolean;
}) {
  return (
    <section className="bg-card border border-card-border rounded-xl p-4">
      <h3 className="text-sm font-bold text-foreground mb-3">Watchlist</h3>
      {loading ? (
        <SkeletonRow />
      ) : offline || !rows || rows.length === 0 ? (
        <EmptyState text="Auto-populated from HTF setups once the bot connects." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr className="border-b border-card-border/40">
                <th className="text-left py-1.5 px-2 font-semibold">Ticker</th>
                <th className="text-right py-1.5 px-2 font-semibold">Price</th>
                <th className="text-right py-1.5 px-2 font-semibold">RSI</th>
                <th className="text-center py-1.5 px-2 font-semibold">HTF</th>
                <th className="text-center py-1.5 px-2 font-semibold">BBTC</th>
                <th className="text-right py-1.5 px-2 font-semibold hidden md:table-cell">Last eval</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.ticker} className="border-b border-card-border/20">
                  <td className="py-1.5 px-2 font-mono font-bold text-foreground">{r.ticker}</td>
                  <td className="py-1.5 px-2 text-right font-mono text-foreground">
                    {r.current_price != null ? `$${r.current_price.toFixed(2)}` : "—"}
                  </td>
                  <td className="py-1.5 px-2 text-right font-mono text-foreground">
                    {r.current_rsi != null ? r.current_rsi.toFixed(1) : "—"}
                  </td>
                  <td className="py-1.5 px-2 text-center">
                    <StateBadge state={r.htf_state} />
                  </td>
                  <td className="py-1.5 px-2 text-center">
                    <StateBadge state={r.bbtc_state} />
                  </td>
                  <td className="py-1.5 px-2 text-right text-muted-foreground hidden md:table-cell">
                    {r.last_evaluated ? new Date(r.last_evaluated).toLocaleTimeString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ─── Positions section ────────────────────────────────────────────────────────

function PositionsSection({ status, offline }: {
  status: KairosStatus | undefined;
  offline: boolean;
}) {
  const positions = status?.open_positions ?? [];
  return (
    <section className="bg-card border border-card-border rounded-xl p-4">
      <h3 className="text-sm font-bold text-foreground mb-3">Open positions</h3>
      {offline || positions.length === 0 ? (
        <EmptyState text={offline ? "Open positions will appear when bot is live." : "No positions open — bot waiting for entry triggers."} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr className="border-b border-card-border/40">
                <th className="text-left py-1.5 px-2 font-semibold">Ticker</th>
                <th className="text-center py-1.5 px-2 font-semibold">Trigger</th>
                <th className="text-right py-1.5 px-2 font-semibold">Entry</th>
                <th className="text-right py-1.5 px-2 font-semibold">Current</th>
                <th className="text-right py-1.5 px-2 font-semibold">P/L %</th>
                <th className="text-right py-1.5 px-2 font-semibold">P/L $</th>
                <th className="text-right py-1.5 px-2 font-semibold hidden md:table-cell">Stop</th>
                <th className="text-right py-1.5 px-2 font-semibold hidden md:table-cell">Target</th>
              </tr>
            </thead>
            <tbody>
              {positions.map(p => (
                <tr key={`${p.symbol}-${p.entry_time}`} className="border-b border-card-border/20">
                  <td className="py-1.5 px-2 font-mono font-bold text-foreground">{p.symbol}</td>
                  <td className="py-1.5 px-2 text-center">
                    <ConvictionBadge tag={p.entry_strategy} />
                  </td>
                  <td className="py-1.5 px-2 text-right font-mono text-foreground">${p.entry_price.toFixed(2)}</td>
                  <td className="py-1.5 px-2 text-right font-mono text-foreground">${p.current_price.toFixed(2)}</td>
                  <td className={`py-1.5 px-2 text-right font-mono font-bold ${p.unrealized_pnl_pct >= 0 ? "text-bull-light" : "text-bear-light"}`}>
                    {p.unrealized_pnl_pct >= 0 ? "+" : ""}{p.unrealized_pnl_pct.toFixed(2)}%
                  </td>
                  <td className={`py-1.5 px-2 text-right font-mono ${p.unrealized_pnl_dollars >= 0 ? "text-bull-light" : "text-bear-light"}`}>
                    {p.unrealized_pnl_dollars >= 0 ? "+" : ""}${p.unrealized_pnl_dollars.toFixed(2)}
                  </td>
                  <td className="py-1.5 px-2 text-right font-mono text-muted-foreground hidden md:table-cell">${p.stop_price.toFixed(2)}</td>
                  <td className="py-1.5 px-2 text-right font-mono text-muted-foreground hidden md:table-cell">{p.target_price != null ? `$${p.target_price.toFixed(2)}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ─── Trades section ───────────────────────────────────────────────────────────

function TradesSection({ trades, loading, offline }: {
  trades: KairosTrade[] | undefined;
  loading: boolean;
  offline: boolean;
}) {
  return (
    <section className="bg-card border border-card-border rounded-xl p-4">
      <h3 className="text-sm font-bold text-foreground mb-3">Recent trades</h3>
      {loading ? (
        <SkeletonRow />
      ) : offline || !trades || trades.length === 0 ? (
        <EmptyState text="Trade log will populate once the bot starts paper-trading." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr className="border-b border-card-border/40">
                <th className="text-left py-1.5 px-2 font-semibold">Ticker</th>
                <th className="text-center py-1.5 px-2 font-semibold">Trigger</th>
                <th className="text-right py-1.5 px-2 font-semibold">Entry</th>
                <th className="text-right py-1.5 px-2 font-semibold">Exit</th>
                <th className="text-right py-1.5 px-2 font-semibold">P/L %</th>
                <th className="text-right py-1.5 px-2 font-semibold">P/L $</th>
                <th className="text-center py-1.5 px-2 font-semibold">Reason</th>
              </tr>
            </thead>
            <tbody>
              {trades.slice(0, 20).map(t => (
                <tr key={t.id} className="border-b border-card-border/20">
                  <td className="py-1.5 px-2 font-mono font-bold text-foreground">{t.symbol}</td>
                  <td className="py-1.5 px-2 text-center">
                    <ConvictionBadge tag={t.entry_strategy} />
                  </td>
                  <td className="py-1.5 px-2 text-right font-mono text-foreground">${t.entry_price.toFixed(2)}</td>
                  <td className="py-1.5 px-2 text-right font-mono text-foreground">${t.exit_price.toFixed(2)}</td>
                  <td className={`py-1.5 px-2 text-right font-mono font-bold ${t.pnl_pct >= 0 ? "text-bull-light" : "text-bear-light"}`}>
                    {t.pnl_pct >= 0 ? "+" : ""}{t.pnl_pct.toFixed(2)}%
                  </td>
                  <td className={`py-1.5 px-2 text-right font-mono ${t.pnl_dollars >= 0 ? "text-bull-light" : "text-bear-light"}`}>
                    {t.pnl_dollars >= 0 ? "+" : ""}${t.pnl_dollars.toFixed(2)}
                  </td>
                  <td className="py-1.5 px-2 text-center text-mini text-muted-foreground">{t.exit_reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ─── Reusable primitives ──────────────────────────────────────────────────────

function StatusPill({ state, offline, loading }: { state: string | undefined; offline: boolean; loading: boolean }) {
  if (loading) {
    return <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-mini font-bold uppercase bg-muted/30 text-muted-foreground"><Loader2 className="h-2.5 w-2.5 animate-spin" /> loading</span>;
  }
  if (offline || !state || state.toLowerCase() !== "online") {
    return <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-mini font-bold uppercase bg-bear/15 text-bear-light"><span className="h-1 w-1 rounded-full bg-bear-light" /> offline</span>;
  }
  return <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-mini font-bold uppercase bg-bull/15 text-bull-light"><span className="h-1 w-1 rounded-full bg-bull-light" /> {state}</span>;
}

function ConvictionBadge({ tag }: { tag: "HTF" | "BBTC" | "BOTH" }) {
  const cls =
    tag === "BOTH" ? "bg-bull/20 text-bull-light"
    : tag === "HTF" ? "bg-primary/15 text-primary"
    : "bg-watch/15 text-watch-light";
  return <span className={`px-1.5 py-0.5 rounded text-mini font-bold ${cls}`}>{tag}</span>;
}

function StateBadge({ state }: { state: string }) {
  const cls =
    state === "fired" || state === "BUY" ? "bg-bull/15 text-bull-light"
    : state === "armed" || state === "HOLD" ? "bg-watch/15 text-watch-light"
    : state === "STOP_HIT" || state === "SELL" || state === "expired" ? "bg-bear/15 text-bear-light"
    : "text-muted-foreground";
  if (state === "none") return <Minus className="inline h-3 w-3 text-muted-foreground" />;
  return <span className={`px-1.5 py-0.5 rounded text-mini font-bold ${cls}`}>{state}</span>;
}

function Stat({ icon, label, value, color, sub }: {
  icon: React.ReactNode; label: string; value: string; color: string; sub?: string;
}) {
  return (
    <div className="bg-muted/30 border border-card-border/50 rounded-lg p-2">
      <div className="flex items-center gap-1 mb-0.5">
        <span className={`${color} opacity-70`}>{icon}</span>
        <span className="text-mini font-semibold text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>
      <span className={`text-sm font-bold tabular-nums font-mono ${color}`}>{value}</span>
      {sub && <span className="block text-mini text-muted-foreground">{sub}</span>}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <p className="text-2xs text-muted-foreground italic px-2 py-4">{text}</p>
  );
}

function SkeletonRow() {
  return (
    <div className="space-y-2">
      <div className="h-4 bg-muted/40 rounded animate-pulse" />
      <div className="h-4 bg-muted/30 rounded animate-pulse" />
      <div className="h-4 bg-muted/20 rounded animate-pulse" />
    </div>
  );
}

// Imports satisfied — TrendingUp/Down kept for future spark direction indicator.
void TrendingUp; void TrendingDown;
