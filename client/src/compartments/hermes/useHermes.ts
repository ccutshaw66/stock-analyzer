/**
 * Canonical client-side data hook for the HERMES compartment.
 *
 * Every consumer (full-page HERMES dashboard, dashboard widget, future
 * alert preview, etc.) reads through this hook — never raw `fetch()` to
 * the Railway endpoints. One source of truth per the compartment contract.
 *
 * The HERMES backend is a standalone FastAPI service on Railway (archived
 * in `python/hermes/`). The base URL is the only hard-coded vendor detail
 * here; everything else is shape-typed.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export const HERMES_API = "https://hermes-dashboard-production-d0ee.up.railway.app";

// ─── Shapes ────────────────────────────────────────────────────────────────────

export interface HermesStatus {
  status: string;
  assets: string[];
  positions: unknown[];
  volatilities: Record<string, number>;
  position_sizes: Record<string, number>;
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

/** Total % gain from the first equity sample to the last. Returns 0 for empty input. */
export function equityTotalPct(eq: number[] | undefined): number {
  if (!eq || eq.length < 2) return 0;
  const start = eq[0];
  const end = eq[eq.length - 1];
  if (!start) return 0;
  return ((end - start) / start) * 100;
}
