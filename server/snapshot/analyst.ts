/**
 * Analyst data adapter.
 *
 * Provider chain: FMP (primary) → no fallback. EDGAR doesn't aggregate analyst
 * consensus, the legacy recommendationTrend was fragile, and Polygon doesn't have
 * it on the Stocks Starter tier. FMP is currently the only viable source.
 */

import type { CompanyAnalyst, FieldHealth } from "./types";
import { tryProviders } from "./fallback";
import { fmpGet } from "../data/providers/fmp.client";

const ANALYST_TTL_MS = 6 * 60 * 60 * 1000; // 6h

function num(v: any): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function consensusFromString(raw: string | null | undefined): CompanyAnalyst["consensus"] {
  const s = String(raw || "").toLowerCase().trim();
  if (s.includes("strong") && s.includes("buy")) return "STRONG BUY";
  if (s === "buy" || s.includes("outperform") || s.includes("overweight")) return "BUY";
  if (s === "hold" || s.includes("neutral") || s.includes("equal")) return "HOLD";
  if (s.includes("strong") && s.includes("sell")) return "STRONG SELL";
  if (s === "sell" || s.includes("underperform") || s.includes("underweight")) return "SELL";
  return null;
}

export async function getAnalystSnapshot(ticker: string): Promise<FieldHealth<CompanyAnalyst>> {
  const T = ticker.toUpperCase();
  return tryProviders<CompanyAnalyst>(
    [
      {
        source: "fmp",
        fetch: async () => {
          const [targets, grades] = await Promise.all([
            fmpGet<any[]>("/price-target-consensus", { symbol: T }),
            fmpGet<any[]>("/grades-consensus", { symbol: T }),
          ]);
          const t = Array.isArray(targets) && targets.length ? targets[0] : {};
          const g = Array.isArray(grades) && grades.length ? grades[0] : {};

          const strongBuy = Number(g.strongBuy) || 0;
          const buy = Number(g.buy) || 0;
          const hold = Number(g.hold) || 0;
          const sell = Number(g.sell) || 0;
          const strongSell = Number(g.strongSell) || 0;
          const total = strongBuy + buy + hold + sell + strongSell;

          const targetMean = num(t.targetConsensus) ?? num(t.targetMedian);
          const targetHigh = num(t.targetHigh);
          const targetLow = num(t.targetLow);

          if (total === 0 && targetMean === null) return null;

          return {
            consensus: consensusFromString(g.consensus),
            strongBuy, buy, hold, sell, strongSell,
            analystCount: total,
            targetMean: targetMean !== null && targetMean > 0 ? targetMean : null,
            targetHigh: targetHigh !== null && targetHigh > 0 ? targetHigh : null,
            targetLow: targetLow !== null && targetLow > 0 ? targetLow : null,
          };
        },
      },
    ],
    {
      ttlMs: ANALYST_TTL_MS,
      isEmpty: (a) => a.analystCount === 0 && a.targetMean === null,
    },
  );
}
