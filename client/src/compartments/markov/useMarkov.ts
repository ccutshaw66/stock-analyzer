/**
 * Canonical client-side data hook for the Markov compartment.
 *
 * The Python service isn't deployed yet — when it is, set `MARKOV_API`
 * below to the Railway URL. Until then the hook returns `connected: false`
 * and the backtest mutation is a no-op shaped for the future contract.
 *
 * Expected backend (see `python/README.md`):
 *   POST /api/backtest
 *   body: { ticker, start, end, states, train_frac, target_vol,
 *           cost_bps, min_hold_days, allow_short }
 *   → { regime_stats, performance: { net, gross, bh }, equity_curve, positions }
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";

/** Base URL once deployed. Null until then. */
export const MARKOV_API: string | null = null;

export interface MarkovParams {
  ticker: string;
  start: string;
  end: string;
  states: number;
  trainFrac: number;
  targetVol: number;
  costBps: number;
  minHoldDays: number;
  allowShort: boolean;
}

export interface MarkovPerformance {
  cagr: number;
  sharpe: number;
  sortino: number;
  max_drawdown: number;
  hit_rate: number;
}

export interface MarkovBacktestResult {
  regime_stats: { state: number; mean_return: number; volatility: number }[];
  performance: { net: MarkovPerformance; gross: MarkovPerformance; bh: MarkovPerformance };
  equity_curve: { date: string; strategy: number; bh: number }[];
  positions: { date: string; position: number }[];
}

export const DEFAULT_PARAMS: MarkovParams = {
  ticker: "SPY",
  start: "2010-01-01",
  end: "",
  states: 3,
  trainFrac: 0.6,
  targetVol: 0.1,
  costBps: 3.0,
  minHoldDays: 2,
  allowShort: true,
};

/** Canonical Markov hook. Pages, widgets, and any future surface read through this. */
export function useMarkov() {
  const qc = useQueryClient();
  const connected = MARKOV_API !== null;

  const runBacktest = useMutation<MarkovBacktestResult, Error, MarkovParams>({
    mutationFn: async (params) => {
      if (!MARKOV_API) {
        throw new Error("Markov service is not deployed yet — set MARKOV_API in useMarkov.ts.");
      }
      const res = await fetch(`${MARKOV_API}/api/backtest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: params.ticker,
          start: params.start,
          end: params.end || undefined,
          states: params.states,
          train_frac: params.trainFrac,
          target_vol: params.targetVol,
          cost_bps: params.costBps,
          min_hold_days: params.minHoldDays,
          allow_short: params.allowShort,
        }),
      });
      if (!res.ok) throw new Error(`Markov backtest failed: ${res.status}`);
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["markov"] }),
  });

  return { connected, runBacktest };
}
