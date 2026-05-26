/**
 * Canonical client-side data hook for the HERMES compartment.
 *
 * Every consumer (full-page HERMES dashboard, dashboard widget, future
 * alert preview, etc.) reads through this hook — never raw `fetch()` to
 * the upstream HERMES endpoints. One source of truth per the compartment contract.
 *
 * As of 2026-05-24 HERMES is self-hosted on Chris's internal network and
 * reached through the Stockotter Express proxy at `/api/hermes/*` (see
 * `server/hermes-proxy.ts`). HERMES itself is NOT publicly exposed — the
 * proxy is the only entry, inherits Stockotter's auth wall, and runs over
 * the LAN to the HERMES VM. Was previously a Railway URL — see
 * `CHANGES.md` for the migration history.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// Relative path — same-origin call to Stockotter's Express proxy. The
// proxy strips this prefix and forwards the rest to the internal HERMES URL.
export const HERMES_API = "/api/hermes";

// ─── Shapes ────────────────────────────────────────────────────────────────────

export interface HermesStatus {
  status: string;
  assets: string[];
  positions: unknown[];
  volatilities: Record<string, number>;
  position_sizes: Record<string, number>;
  // RSI per asset, written by the bot's loop every iteration (loop.py
  // patched 2026-05-25). Optional because older HERMES builds may not
  // emit this field — UI handles missing values gracefully.
  rsi_values?: Record<string, number>;
  strategy_version: string;
}

export interface HermesStats {
  total_trades: number;
  win_rate: number;
  total_pnl: number;
  sharpe: number;
  max_drawdown: number;
}

export interface HermesTrade {
  id: string;
  asset: string;
  direction: "long" | "short";
  entry_price: number;
  exit_price: number;
  pnl_pct: number;
  exit_time: string;
}

export interface HermesEquity {
  equity: number[];
}

export interface HermesGoal {
  target_return_30d?: number;
  max_drawdown?: number;
  min_sharpe?: number;
  /**
   * Starting paper-trading capital, in dollars. Read from goal.yaml on the
   * HERMES VM (add `starting_equity: 10000` to that file). Used purely for
   * UI display — multiplies the relative equity index returned by /api/equity
   * (which starts at 100 and compounds pnl_pct from trades). When undefined,
   * the UI falls back to a $10,000 default so dollar amounts always render.
   */
  starting_equity?: number;
  assets?: { symbol: string; target_return_30d?: number; max_drawdown?: number; min_sharpe?: number }[];
}

export interface AssetParams {
  threshold: number;
  stop_loss_pct: number;
}

// ─── Internal fetch helper ─────────────────────────────────────────────────────

async function hermesFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${HERMES_API}${path}`);
  if (!res.ok) throw new Error(`HERMES ${path} → ${res.status}`);
  return res.json();
}

async function hermesPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${HERMES_API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HERMES POST ${path} → ${res.status}`);
  return res.json();
}

// ─── The canonical hook ────────────────────────────────────────────────────────

/**
 * Reads every piece of HERMES state and exposes every mutation in one place.
 * Pages and widgets compose what they need from this — they never reach past
 * it to call HERMES_API themselves.
 */
export function useHermes() {
  const qc = useQueryClient();

  const status = useQuery<HermesStatus>({
    queryKey: ["hermes", "status"],
    queryFn: () => hermesFetch<HermesStatus>("/api/status"),
    refetchInterval: 15_000,
    retry: 1,
  });
  const stats = useQuery<HermesStats>({
    queryKey: ["hermes", "stats"],
    queryFn: () => hermesFetch<HermesStats>("/api/stats"),
    refetchInterval: 30_000,
    retry: 1,
  });
  const trades = useQuery<HermesTrade[]>({
    queryKey: ["hermes", "trades"],
    queryFn: () => hermesFetch<HermesTrade[]>("/api/trades"),
    refetchInterval: 30_000,
    retry: 1,
  });
  const equity = useQuery<HermesEquity>({
    queryKey: ["hermes", "equity"],
    queryFn: () => hermesFetch<HermesEquity>("/api/equity"),
    refetchInterval: 30_000,
    retry: 1,
  });
  const goal = useQuery<HermesGoal>({
    queryKey: ["hermes", "goal"],
    queryFn: () => hermesFetch<HermesGoal>("/api/goal"),
    refetchInterval: 60_000,
    retry: 1,
  });

  const updateStrategy = useMutation({
    mutationFn: ({ asset, params }: { asset: string; params: AssetParams }) =>
      hermesPost("/api/strategy", { assets: { [asset]: params } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hermes"] }),
  });

  const addAsset = useMutation({
    mutationFn: (payload: { symbol: string; threshold: number; stop_loss_pct: number }) =>
      hermesPost("/api/asset/add", payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hermes"] }),
  });

  const removeAsset = useMutation({
    mutationFn: (symbol: string) => hermesPost("/api/asset/remove", { symbol }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hermes"] }),
  });

  const updateGoal = useMutation({
    mutationFn: (payload: { target_return_30d: number; max_drawdown: number; min_sharpe: number }) =>
      hermesPost("/api/goal", payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hermes", "goal"] }),
  });

  const offline = !!status.error && !!stats.error && !!trades.error;

  return {
    status, stats, trades, equity, goal,
    updateStrategy, addAsset, removeAsset, updateGoal,
    offline,
    refresh: () => qc.invalidateQueries({ queryKey: ["hermes"] }),
  };
}

// ─── Pure derived helpers (no React, no fetch) ─────────────────────────────────

/** Default starting capital when goal.yaml hasn't set one. Keeps dollar UI alive. */
export const DEFAULT_STARTING_EQUITY = 10_000;

/** Total % gain from the first equity sample to the last. Returns 0 for empty input. */
export function equityTotalPct(eq: number[] | undefined): number {
  if (!eq || eq.length < 2) return 0;
  const start = eq[0];
  const end = eq[eq.length - 1];
  if (!start) return 0;
  return ((end - start) / start) * 100;
}

/**
 * Convert the relative equity series (starts at 100, compounds pnl_pct) to
 * absolute dollar values. The bot's /api/equity returns the relative series
 * to stay decoupled from any specific starting capital — the UI multiplies
 * by `starting_equity` (from goal.yaml, default $10K) to surface dollars.
 */
export function equityDollars(eq: number[] | undefined, startingEquity: number): number[] {
  if (!eq || eq.length === 0) return [];
  const base = eq[0] || 100;
  return eq.map((v) => Number(((v / base) * startingEquity).toFixed(2)));
}

/** Current account value in dollars (last equity sample × starting). */
export function currentEquityDollars(eq: number[] | undefined, startingEquity: number): number {
  if (!eq || eq.length === 0) return startingEquity;
  const base = eq[0] || 100;
  const last = eq[eq.length - 1];
  return Number(((last / base) * startingEquity).toFixed(2));
}

/** Total dollar P/L since starting (current − starting). */
export function totalPnlDollars(eq: number[] | undefined, startingEquity: number): number {
  return Number((currentEquityDollars(eq, startingEquity) - startingEquity).toFixed(2));
}
