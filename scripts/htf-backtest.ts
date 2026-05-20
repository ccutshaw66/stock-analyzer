/**
 * CLI HTF backtester.
 *
 * Usage:
 *   npx tsx scripts/htf-backtest.ts AAPL TSLA RKLB
 *   npx tsx scripts/htf-backtest.ts --min-score 70 AAPL,TSLA,RKLB
 *
 * Prints the same per-symbol + aggregate stats that the Python CLI emits.
 */

import { backtestSymbol, type HtfBacktestResult, type HtfBacktestSummary } from "../server/compartments/htf-scanner/backtest";

function parseArgs(argv: string[]): { symbols: string[]; minScore: number } {
  const out = { symbols: [] as string[], minScore: 0 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--min-score") {
      out.minScore = Number(argv[++i] || 0);
      continue;
    }
    out.symbols.push(...a.split(",").map(s => s.trim().toUpperCase()).filter(Boolean));
  }
  return out;
}

function fmtSummary(s: HtfBacktestSummary | { nTrades: 0 }, label: string): string {
  if (s.nTrades === 0) return `  ${label}: no trades`;
  return [
    `  ${label}: ${s.nTrades} trades`,
    `    win_rate ${s.winRatePct}%`,
    `    avg_return ${s.avgReturnPct >= 0 ? "+" : ""}${s.avgReturnPct}%`,
    `    profit_factor ${s.profitFactor}`,
    `    expectancy/trade ${s.expectancyPerTradePct >= 0 ? "+" : ""}${s.expectancyPerTradePct}%`,
    `    avg_hold ${s.avgHoldDays}d  avg_dd ${s.avgDrawdownPct}%`,
    `    stops ${s.stopOuts}  trails ${s.trailExits}`,
    `    best ${s.bestTrade >= 0 ? "+" : ""}${s.bestTrade}%  worst ${s.worstTrade >= 0 ? "+" : ""}${s.worstTrade}%`,
  ].join("\n");
}

async function main() {
  const { symbols, minScore } = parseArgs(process.argv.slice(2));
  if (symbols.length === 0) {
    console.error("Usage: tsx scripts/htf-backtest.ts [--min-score N] SYM1 SYM2 …");
    process.exit(1);
  }

  console.log("=".repeat(70));
  console.log(`HTF BACKTEST  (min_score=${minScore})`);
  console.log("=".repeat(70));

  const allResults: HtfBacktestResult[] = [];
  for (const sym of symbols) {
    try {
      const r = await backtestSymbol(sym, minScore);
      allResults.push(r);
      if (r.trades.length === 0) {
        console.log(`  ${sym.padEnd(6)} no setups found`);
        continue;
      }
      const summary = r.summary;
      if ("avgReturnPct" in summary) {
        console.log(`  ${sym.padEnd(6)} ${r.trades.length} trades, avg ${summary.avgReturnPct >= 0 ? "+" : ""}${summary.avgReturnPct}%`);
      }
    } catch (err: any) {
      console.log(`  ${sym.padEnd(6)} ERROR: ${err?.message || err}`);
    }
  }

  const allTrades = allResults.flatMap(r => r.trades);
  console.log("\n" + "=".repeat(70));
  console.log(`AGGREGATE  (${allTrades.length} trades across ${allResults.length} symbols)`);
  console.log("=".repeat(70));

  // Inline aggregate using the same summary shape
  const { backtestSymbol: _ignore, ...rest } = await import("../server/compartments/htf-scanner/backtest");
  // Re-summarize across the union by recreating an HtfBacktestResult-like shape
  const aggregate: HtfBacktestResult = {
    symbol: "ALL",
    trades: allTrades,
    summary: (() => {
      const s = aggregateSummary(allTrades);
      return s;
    })(),
    byScoreBucket: [],
  };
  console.log(fmtSummary(aggregate.summary, "ALL"));

  console.log("\n" + "=".repeat(70));
  console.log("INDIVIDUAL TRADES");
  console.log("=".repeat(70));
  const header = `  ${"SYM".padEnd(6)} ${"ENTRY".padEnd(11)} ${"EXIT".padEnd(11)} ${"DAYS".padStart(4)} ${"ENTRY$".padStart(8)} ${"EXIT$".padStart(8)} ${"RET%".padStart(7)} ${"DD%".padStart(6)} ${"RSN".padEnd(11)} ${"Q".padStart(3)}`;
  console.log(header);
  for (const t of allTrades) {
    console.log(
      `  ${t.symbol.padEnd(6)} ${t.entryDate.padEnd(11)} ${t.exitDate.padEnd(11)} ${String(t.holdingDays).padStart(4)} ` +
        `${t.entryPrice.toFixed(2).padStart(8)} ${t.exitPrice.toFixed(2).padStart(8)} ` +
        `${(t.blendedReturnPct >= 0 ? "+" : "") + t.blendedReturnPct.toFixed(1).padStart(6)} ` +
        `${t.maxDrawdownPct.toFixed(1).padStart(6)} ${t.exitReason.padEnd(11)} ` +
        `${String(t.qualityScore).padStart(3)}`,
    );
  }
}

function aggregateSummary(trades: any[]): HtfBacktestSummary | { nTrades: 0 } {
  if (trades.length === 0) return { nTrades: 0 };
  const returns = trades.map(t => t.blendedReturnPct);
  const wins = returns.filter((r: number) => r > 0);
  const losses = returns.filter((r: number) => r <= 0);
  const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
  const winSum = sum(wins);
  const lossSum = sum(losses);
  const mean = (arr: number[]) => sum(arr) / arr.length;
  const med = (arr: number[]) => {
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const winRate = (wins.length / returns.length) * 100;
  const avgWin = wins.length ? mean(wins) : 0;
  const avgLoss = losses.length ? mean(losses) : 0;
  return {
    nTrades: trades.length,
    winRatePct: r1(winRate),
    avgReturnPct: r2(mean(returns)),
    medianReturnPct: r2(med(returns)),
    avgWinPct: r2(avgWin),
    avgLossPct: r2(avgLoss),
    profitFactor: losses.length && lossSum !== 0 ? r2(Math.abs(winSum / lossSum)) : Infinity,
    expectancyPerTradePct: r2((winRate / 100) * avgWin + (1 - winRate / 100) * avgLoss),
    avgHoldDays: r1(mean(trades.map(t => t.holdingDays))),
    avgDrawdownPct: r2(mean(trades.map(t => t.maxDrawdownPct))),
    stopOuts: trades.filter(t => t.exitReason === "stop").length,
    trailExits: trades.filter(t => t.exitReason === "trail_20ma").length,
    bestTrade: r2(Math.max(...returns)),
    worstTrade: r2(Math.min(...returns)),
  };
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
