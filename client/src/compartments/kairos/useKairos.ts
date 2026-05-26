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
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

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
  /**
   * Starting paper-trading capital, in dollars. Read from goal.yaml on the
   * KAIROS VM. Optional so the UI doesn't break when the bot is offline or
   * the field is removed — the page falls back to DEFAULT_STARTING_EQUITY.
   */
  starting_equity?: number;
  /** Fraction of equity per trade (0.02 = 2%). */
  position_size_pct?: number;
  watchlist_refresh_hours?: number;
  loop_interval_minutes?: number;
  /** Minimum HTF quality score the bot will act on (0-100). */
  min_score?: number;
  /** Target 30-day return as decimal (0.05 = 5%). */
  target_return_30d?: number;
  /** Max drawdown guardrail as decimal (0.10 = 10%). */
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

// ─── Internal fetch helpers ────────────────────────────────────────────────────

async function kairosFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${KAIROS_API}${path}`, { credentials: "include" });
  if (!res.ok) throw new Error(`KAIROS ${path} → ${res.status}`);
  return res.json();
}

async function kairosPut<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${KAIROS_API}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = "";
    try { detail = JSON.stringify(await res.json()); } catch { /* ignore */ }
    throw new Error(`KAIROS PUT ${path} → ${res.status} ${detail}`);
  }
  return res.json();
}

// ─── The canonical hook ────────────────────────────────────────────────────────

export function useKairos() {
  const qc = useQueryClient();

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

  /**
   * Patch goal.yaml on the bot. Bot's loop hot-reloads goal.yaml each tick,
   * so changes land within at most `loop_interval_minutes` minutes.
   * Send only the fields you want to change; the server merges.
   */
  const updateGoal = useMutation({
    mutationFn: (patch: Partial<KairosGoal>) =>
      kairosPut<KairosGoal>("/api/goal", patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["kairos", "goal"] }),
  });

  const offline = !!status.error && !!trades.error;

  return { status, trades, equity, goal, watchlist, updateGoal, offline };
}

// ─── Pure helpers (no React, no fetch) ─────────────────────────────────────────

/**
 * Default starting capital when goal.yaml hasn't set one. Same value HERMES
 * uses — keeps dollar UI alive even if the bot is offline.
 */
export const DEFAULT_STARTING_EQUITY = 10_000;

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

/**
 * Convert the relative equity series (indexed at first sample) to absolute
 * dollar values by multiplying by the configured starting equity. Mirrors
 * the HERMES helper so both bots compute the same way.
 */
export function equityDollars(eq: number[] | undefined, startingEquity: number): number[] {
  if (!eq || eq.length === 0) return [];
  const base = eq[0] || startingEquity;
  return eq.map((v) => Number(((v / base) * startingEquity).toFixed(2)));
}

/** Current account value in dollars (last equity sample × starting / first). */
export function currentEquityDollars(eq: number[] | undefined, startingEquity: number): number {
  if (!eq || eq.length === 0) return startingEquity;
  const base = eq[0] || startingEquity;
  const last = eq[eq.length - 1];
  return Number(((last / base) * startingEquity).toFixed(2));
}

/** Total dollar P/L since starting (current − starting). */
export function totalPnlDollars(eq: number[] | undefined, startingEquity: number): number {
  return Number((currentEquityDollars(eq, startingEquity) - startingEquity).toFixed(2));
}

/** Sum of (entry_price × shares) across all open positions — capital locked up. */
export function totalInvestedDollars(positions: KairosPosition[] | undefined): number {
  if (!positions || positions.length === 0) return 0;
  return Number(
    positions.reduce((sum, p) => sum + (p.entry_price ?? 0) * (p.shares ?? 0), 0).toFixed(2)
  );
}

/** Sum of unrealized P/L $ across all open positions. */
export function totalUnrealizedPnlDollars(positions: KairosPosition[] | undefined): number {
  if (!positions || positions.length === 0) return 0;
  return Number(
    positions.reduce((sum, p) => sum + (p.unrealized_pnl_dollars ?? 0), 0).toFixed(2)
  );
}
