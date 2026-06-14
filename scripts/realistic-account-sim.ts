/**
 * Realistic small-account simulator for Rounding Bottom — what a $7K account ACTUALLY does.
 *
 * Not a validation (already proven: 68.6% OOS win rate, PF 1.47). This answers the only
 * question that matters for trading it for real: start $7,000 → where do you end up, and
 * what's the worst drawdown along the way — on a FOCUSED basket, FULLY invested, with
 * sane per-name size.
 *
 * Realistic rules baked in:
 *   • Account = $7,000, compounding.
 *   • Basket = best-20 names, chosen HONESTLY: ranked on the in-sample first half of history,
 *     then traded only in the out-of-sample second half (no hindsight cheating).
 *   • Position SIZE = 10% of current equity per name (~$700). With ~8% stops that's ~0.8%
 *     RISK per trade — well under the 2% rule. (Size ≠ risk: the stop makes a 10% position
 *     only risk 0.8%.)
 *   • Up to 10 names at once; hold cash when fewer signals are live. Never use margin.
 *   • Costs: 20bps round-trip + $0.10 price-scaled spread, on the real notional.
 *
 *   npx tsx scripts/realistic-account-sim.ts
 */
import dotenv from "dotenv"; dotenv.config();
import { getHtfUniverse } from "../server/signals/universe/htf-universe";
import { runGenericStrategyPnL } from "../server/diag/strategy-generic-pnl";
import { scanRoundingBottom } from "../server/signals/strategies/rounding-bottom";

const CAPITAL = 7000;
const POSITION_PCT = 0.10;     // 10% of equity per name
const MAX_NAMES = 10;          // up to 10 concurrent positions
const BASKET_SIZE = 20;        // best-20 names
const COST_BPS = 20;           // round-trip base cost, bps
const SPREAD_DOLLARS = 0.10;   // price-scaled spread
const FLAT_POS = 1750;         // notional the backtest's pnlDollar/returnPct was computed on (unused except via return%)

type Trade = {
  symbol: string; entryDate: string; exitDate: string;
  entryPrice: number; stopPrice: number; retPct: number; // retPct = fraction (blendedReturnPct/100)
};

function simulate(trades: Trade[], label: string) {
  // Event-loop portfolio walk, date-ordered by entry. Close finished positions before each new entry.
  const byEntry = [...trades].sort((a, b) => a.entryDate.localeCompare(b.entryDate));
  let cash = CAPITAL;
  let equity = CAPITAL;                                  // realized equity (cash + cost-basis of open)
  type Open = { exitDate: string; notional: number; retPct: number; entryPrice: number };
  const open: Open[] = [];
  const curve: number[] = [CAPITAL];                    // realized-equity samples at each close
  let taken = 0, skipped = 0, wins = 0, losses = 0;
  let maxConcurrent = 0;
  let sumPnl = 0, worst = 0;
  let investedDays = 0, totalDays = 0;                  // rough "% time invested" via open-count at events
  let riskMax = 0;                                       // largest per-trade risk as % of equity (sanity)

  function closeOne(p: Open) {
    const costFrac = COST_BPS / 10000 + (p.entryPrice > 0 ? SPREAD_DOLLARS / p.entryPrice : 0);
    const pnl = p.notional * p.retPct - costFrac * p.notional;
    cash += p.notional + pnl;
    equity = cash + open.reduce((a, o) => a + o.notional, 0);
    sumPnl += pnl; worst = Math.min(worst, pnl);
    if (pnl > 0) wins++; else losses++;
    curve.push(equity);
  }

  for (const t of byEntry) {
    // 1) Close any open positions that have exited on/before this entry date.
    for (let i = open.length - 1; i >= 0; i--) {
      if (open[i].exitDate <= t.entryDate) { closeOne(open[i]); open.splice(i, 1); }
    }
    equity = cash + open.reduce((a, o) => a + o.notional, 0);
    // 2) Try to open this trade.
    const want = equity * POSITION_PCT;
    totalDays++; if (open.length > 0) investedDays++;
    if (open.length >= MAX_NAMES || cash < want || want <= 0) { skipped++; continue; }
    const notional = Math.min(want, cash);
    cash -= notional;
    open.push({ exitDate: t.exitDate, notional, retPct: t.retPct, entryPrice: t.entryPrice });
    taken++;
    maxConcurrent = Math.max(maxConcurrent, open.length);
    const riskFrac = t.entryPrice > 0 ? (t.entryPrice - t.stopPrice) / t.entryPrice : 0;
    riskMax = Math.max(riskMax, (notional * riskFrac) / Math.max(equity, 1));
  }
  // Close any stragglers in exit-date order.
  open.sort((a, b) => a.exitDate.localeCompare(b.exitDate));
  while (open.length) closeOne(open.shift()!);

  // Max drawdown on the realized equity curve.
  let peak = curve[0], mddDollar = 0, mddPct = 0;
  for (const e of curve) { peak = Math.max(peak, e); const dd = e - peak; if (dd < mddDollar) { mddDollar = dd; mddPct = dd / peak; } }

  const endBal = cash;
  const totalRetPct = (endBal / CAPITAL - 1) * 100;
  const firstDate = byEntry[0]?.entryDate, lastDate = byEntry[byEntry.length - 1]?.exitDate;
  const years = firstDate && lastDate ? Math.max(0.25, (Date.parse(lastDate) - Date.parse(firstDate)) / (365.25 * 864e5)) : 1;
  const cagr = (Math.pow(endBal / CAPITAL, 1 / years) - 1) * 100;

  return {
    label,
    startBalance: CAPITAL,
    endingBalance: Math.round(endBal),
    totalReturnPct: +totalRetPct.toFixed(1),
    cagrPct: +cagr.toFixed(1),
    years: +years.toFixed(1),
    maxDrawdownDollar: Math.round(mddDollar),
    maxDrawdownPct: +(mddPct * 100).toFixed(1),
    tradesTaken: taken,
    signalsSkipped_noRoom: skipped,
    winRatePct: taken ? +(wins / (wins + losses) * 100).toFixed(1) : 0,
    avgTradeDollar: taken ? +(sumPnl / taken).toFixed(2) : 0,
    worstTradeDollar: Math.round(worst),
    maxConcurrentNames: maxConcurrent,
    pctTimeInvested: totalDays ? +(investedDays / totalDays * 100).toFixed(0) : 0,
    maxPerTradeRiskPctOfAccount: +(riskMax * 100).toFixed(2),
  };
}

async function main() {
  const u = await getHtfUniverse();
  const symbols = [...u.tickers].sort((a, b) => (b.volume || 0) - (a.volume || 0)).slice(0, 500).map(r => r.symbol.toUpperCase());
  const cfg = { id: "rounding-bottom", label: "Rounding Bottom", timeframe: "daily" as const, scan: scanRoundingBottom as any, trailMaPeriod: 20 };
  const r = await runGenericStrategyPnL(cfg, symbols, 3650, FLAT_POS, true, 70);

  // Flatten closed trades.
  const all: Trade[] = [];
  for (const tk of (r.perTicker as any[])) {
    for (const tr of (tk.trades || [])) {
      if (tr.isOpen) continue;
      const ed = String(tr.entryDate).slice(0, 10);
      const xd = String(tr.exitDate).slice(0, 10);
      if (!ed || !xd) continue;
      all.push({ symbol: tk.symbol, entryDate: ed, exitDate: xd, entryPrice: tr.entryPrice, stopPrice: tr.stopPrice, retPct: tr.blendedReturnPct / 100 });
    }
  }
  all.sort((a, b) => a.entryDate.localeCompare(b.entryDate));
  if (!all.length) { console.log("No trades."); return; }

  // Split ~55/45 by entry date. Rank tickers by IS net P&L → best-20. Trade them OOS.
  const split = Math.floor(all.length * 0.55);
  const isHalf = all.slice(0, split), oosHalf = all.slice(split);
  const isPnlByTk: Record<string, number> = {};
  for (const t of isHalf) isPnlByTk[t.symbol] = (isPnlByTk[t.symbol] || 0) + t.retPct; // size-independent rank
  const best20 = Object.entries(isPnlByTk).sort((a, b) => b[1] - a[1]).slice(0, BASKET_SIZE).map(([s]) => s);
  const best20Set = new Set(best20);
  const oosBasketTrades = oosHalf.filter(t => best20Set.has(t.symbol));

  // Upper-bound context: best-20 over ALL history (names known in advance).
  const allPnlByTk: Record<string, number> = {};
  for (const t of all) allPnlByTk[t.symbol] = (allPnlByTk[t.symbol] || 0) + t.retPct;
  const best20All = new Set(Object.entries(allPnlByTk).sort((a, b) => b[1] - a[1]).slice(0, BASKET_SIZE).map(([s]) => s));
  const allBasketTrades = all.filter(t => best20All.has(t.symbol));

  const honest = simulate(oosBasketTrades, "HONEST — best-20 picked on first half, traded out-of-sample");
  const upper = simulate(allBasketTrades, "UPPER BOUND — best-20 over all history (names known in advance)");

  console.log(JSON.stringify({
    account: CAPITAL, positionSizePct: POSITION_PCT * 100, maxNames: MAX_NAMES, basketSize: BASKET_SIZE,
    basket_honest_OOS: best20,
    results: [honest, upper],
    note: "RISK per trade is maxPerTradeRiskPctOfAccount (~under 1%); the 10% is POSITION SIZE, not risk. " +
          "Drawdown is on the realized-equity curve (between closes) — slightly optimistic vs daily marks. " +
          "signalsSkipped_noRoom = signals you'd pass on because all 10 slots/cash were full (concentration working).",
  }, null, 2));
}
main().catch(e => { console.error(e); process.exit(1); });
