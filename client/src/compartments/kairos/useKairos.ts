/**
 * Canonical hook for the KAIROS compartment.
 *
 * KAIROS is the second experimental auto-trader (after HERMES). Runs the
 * HTF + BBTC strategies natively in Python on superotter, reached via
 * the same `/api/<name>/*` proxy pattern HERMES uses.
 *
 * Every consumer (full view, future widget, alert preview) reads through
 * this hook. Never raw `fetch()` to the KAIROS API.
 *
 * Provider note: bot lives on the internal LAN at 10.209.32.8:8082 and
 * is reached through Stockotter's Express proxy at `/api/kairos/*`.
 * When the bot isn't running, every query returns an error — handled
 * gracefully by surfaces with an "offline" pill.
 */
import { useQuery } from "@tanstack/react-query";

const KAIROS_API = "/api/kairos";

// ─── Response shapes (mirror HERMES naming for consistency) ───────────────────

export interface KairosStatus {
  status: string;             // "online" | "offline"
  mode: "paper" | "live";
  watchlist: string[];
  open_positions: KairosPosition[];
  strategy_version: string;   // bumps when goal.yaml or strategies change
  /** Last heartbeat timestamp (ISO 8601) */
  last_heartbeat?: string;
}

export interface KairosPosition {
  symbol: string;
  entry_strategy: "HTF" | "BBTC" | "BOTH";
  entry_price: number;
  current_price: number;
  shares: number;
  entry_time: string;
  stop_price: number;
  target_price?: number;
  unrealized_pnl_pct: number;
  unrealized_pnl_dollars: number;
}

export interface KairosTrade {
  id: string;
  symbol: string;
  entry_strategy: "HTF" | "BBTC" | "BOTH";
  direction: "long" | "short";
  entry_price: number;
  exit_price: number;
  shares: number;
  entry_time: string;
  exit_time: string;
  pnl_pct: number;
  pnl_dollars: number;
  exit_reason: string;        // "TARGET" | "STOP" | "TRAIL" | "TIME"
}

export interface KairosEquity {
  /** Equity-curve samples, ordered oldest → newest. */
  equity: number[];
  /** Matching timestamps. */
  timestamps: string[];
}

export interface KairosGoal {
  starting_equity: number;
  position_size_pct: number;
  watchlist_refresh_hours: number;
  loop_interval_minutes: number;
  target_return_30d?: number;
  max_drawdown?: number;
  min_sharpe?: number;
}

export interface KairosWatchlistRow {
  ticker: string;
  htf_state: "armed" | "fired" | "expired" | "none";
  bbtc_state: "BUY" | "HOLD" | "SELL" | "STOP_HIT" | "none";
  current_price?: number;
  current_rsi?: number;
  last_evaluated?: string;
}

// ─── Internal fetch helper ─────────────────────────────────────────────────────

async function kairosFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${KAIROS_API}${path}`, { credentials: "include" });
  if (!res.ok) throw new Error(`KAIROS ${path} → ${res.status}`);
  return res.json();
}

// ─── The canonical hook ────────────────────────────────────────────────────────

export function useKairos() {
  const status = useQuery<KairosStatus>({
    queryKey: ["kairos", "status"],
    queryFn: () => kairosFetch<KairosStatus>("/api/status"),
    refetchInterval: 15_000,
    retry: 1,
  });
  const trades = useQuery<KairosTrade[]>({
    queryKey: ["kairos", "trades"],
    queryFn: () => kairosFetch<KairosTrade[]>("/api/trades"),
    refetchInterval: 30_000,
    retry: 1,
  });
  const equity = useQuery<KairosEquity>({
    queryKey: ["kairos", "equity"],
    queryFn: () => kairosFetch<KairosEquity>("/api/equity"),
    refetchInterval: 60_000,
    retry: 1,
  });
  const goal = useQuery<KairosGoal>({
    queryKey: ["kairos", "goal"],
    queryFn: () => kairosFetch<KairosGoal>("/api/goal"),
    refetchInterval: 5 * 60_000,
    retry: 1,
  });
  const watchlist = useQuery<KairosWatchlistRow[]>({
    queryKey: ["kairos", "watchlist"],
    queryFn: () => kairosFetch<KairosWatchlistRow[]>("/api/watchlist"),
    refetchInterval: 30_000,
    retry: 1,
  });

  const offline = !!status.error && !!trades.error;

  return { status, trades, equity, goal, watchlist, offline };
}

// ─── Pure helpers (no React, no fetch) ─────────────────────────────────────────

/** Total % gain from the first equity sample to the last. Returns 0 for empty input. */
export function equityTotalPct(eq: number[] | undefined): number {
  if (!eq || eq.length < 2) return 0;
  const start = eq[0];
  const end = eq[eq.length - 1];
  if (!start) return 0;
  return ((end - start) / start) * 100;
}

/** Win rate from a list of trades. */
export function winRatePct(trades: KairosTrade[] | undefined): number {
  if (!trades || trades.length === 0) return 0;
  const wins = trades.filter(t => t.pnl_pct > 0).length;
  return (wins / trades.length) * 100;
}
