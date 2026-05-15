/**
 * Canonical client-side hooks for the Trade Tracker compartment.
 *
 * Any consumer (full-page Trade Tracker, dashboard widget, future analytics
 * tile) calls these — never raw fetch to `/api/trades*`. Query keys match
 * those used by `client/src/pages/trade-tracker.tsx` so cache invalidation
 * from the existing page's mutations automatically refreshes any widget
 * built on these hooks.
 *
 * Per-trade math (P/L, position aggregation) lives in `shared/pnl/` and
 * is consumed by both server endpoints and any widget rendering individual
 * trade rows.
 */
import { useQuery } from "@tanstack/react-query";
import type { Trade } from "@shared/schema";

export interface TradesSummary {
  totalTrades: number;
  openTrades: number;
  totalProfit: number;
  totalWins: number;
  winRate: number;
  openPL: number;
  cashBalance?: number;
  openPositionMarketValue?: number;
  totalPortfolioValue?: number;
  allocated: number;
  allocatedPct: number;
  byType: Record<string, { profit: number; loss: number; count: number; wins: number; investment: number }>;
  equityCurve: { date: string; value: number }[];
  behaviorCounts: Record<string, number>;
  settings: unknown;
}

export function useTrades() {
  return useQuery<Trade[]>({ queryKey: ["/api/trades"] });
}

export function useTradesSummary() {
  return useQuery<TradesSummary>({ queryKey: ["/api/trades/summary"] });
}
