/**
 * One-shot capital-preservation re-grade for the two high-win-rate pattern
 * strategies that have no committed OOS artifact yet: Rounding Bottom + Pipe Bottom.
 *
 * Runs the SAME computation as the /api/diag/strategy-*-pnl endpoints, but standalone
 * (no server needed). Needs FMP access (your .env at repo root). Prints each strategy's
 * aggregate (win rate, profit factor, R-multiple, max drawdown, avg trade, total P&L)
 * so it can be graded against the "don't lose money" bar.
 *
 *   npx tsx scripts/regrade-patterns.ts
 */
import dotenv from "dotenv";
dotenv.config();

import { getHtfUniverse } from "../server/signals/universe/htf-universe";
import { runGenericStrategyPnL } from "../server/diag/strategy-generic-pnl";
import { scanPipeBottom } from "../server/signals/strategies/pipe-bottom";
import { scanRoundingBottom } from "../server/signals/strategies/rounding-bottom";

async function main() {
  const u = await getHtfUniverse();
  const symbols = [...u.tickers]
    .sort((a, b) => (b.volume || 0) - (a.volume || 0))
    .slice(0, 500)
    .map(r => r.symbol.toUpperCase());

  console.log(`Universe: ${symbols.length} names ($5-75 HTF). Running 2 patterns over ~10y — a few minutes.\n`);

  const cfgs = [
    { id: "rounding-bottom", label: "Rounding Bottom", timeframe: "daily" as const,  scan: scanRoundingBottom as any, trailMaPeriod: 20 },
    { id: "pipe-bottom",     label: "Pipe Bottom",     timeframe: "weekly" as const, scan: scanPipeBottom as any,     trailMaPeriod: 10 },
  ];

  for (const cfg of cfgs) {
    try {
      const r = await runGenericStrategyPnL(cfg, symbols, 3650, 1750, false, 70);
      console.log(`===== ${cfg.label} =====`);
      console.log(JSON.stringify(r.aggregate, null, 2));
      console.log("");
    } catch (e: any) {
      console.log(`===== ${cfg.label}: ERROR — ${e?.message} =====\n`);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
