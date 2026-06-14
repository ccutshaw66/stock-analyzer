/**
 * Final capital-preservation validation for Rounding Bottom.
 * Reuses the SAME trade engine (runGenericStrategyPnL, detail=on), then adds what the
 * basket aggregate doesn't: an out-of-sample split, max drawdown, trading costs
 * (price-scaled spread), expectancy in $ and R, % losers, max consecutive losses,
 * and per-ticker breadth. Applies the "don't lose money" gate.
 *
 *   npx tsx scripts/validate-rounding-bottom.ts
 */
import dotenv from "dotenv"; dotenv.config();
import { getHtfUniverse } from "../server/signals/universe/htf-universe";
import { runGenericStrategyPnL } from "../server/diag/strategy-generic-pnl";
import { scanRoundingBottom } from "../server/signals/strategies/rounding-bottom";

const POS = 1750;             // $ per trade (matches the diag default)
const COST_BPS = 20;          // round-trip base cost (commission+impact), bps
const SPREAD_DOLLARS = 0.10;  // assumed full spread, price-scaled (O'Neil: a $5 name bleeds far more than a $50 name)

type T = { symbol: string; entryDate: string; entryPrice: number; stopPrice: number; pnlNet: number };

function maxDrawdownDollar(pnls: number[]): number {
  let eq = 0, peak = 0, mdd = 0;
  for (const p of pnls) { eq += p; peak = Math.max(peak, eq); mdd = Math.min(mdd, eq - peak); }
  return Math.round(mdd); // most negative peak-to-trough, in $
}

function grade(ts: T[]) {
  const n = ts.length; if (!n) return null;
  const wins = ts.filter(t => t.pnlNet > 0);
  const losses = ts.filter(t => t.pnlNet <= 0);
  const gw = wins.reduce((a, t) => a + t.pnlNet, 0);
  const gl = Math.abs(losses.reduce((a, t) => a + t.pnlNet, 0));
  const total = ts.reduce((a, t) => a + t.pnlNet, 0);
  const Rs = ts.map(t => { const risk = (t.entryPrice - t.stopPrice) / t.entryPrice * POS; return risk > 0 ? t.pnlNet / risk : 0; });
  let mcl = 0, cur = 0; for (const t of ts) { if (t.pnlNet <= 0) { cur++; mcl = Math.max(mcl, cur); } else cur = 0; }
  const byTk: Record<string, number> = {}; for (const t of ts) byTk[t.symbol] = (byTk[t.symbol] || 0) + t.pnlNet;
  const tks = Object.values(byTk); const posTk = tks.filter(x => x > 0).length;
  return {
    trades: n,
    winRatePct: +(wins.length / n * 100).toFixed(1),
    expectancyDollarAfterCosts: +(total / n).toFixed(2),
    expectancyR: +(Rs.reduce((a, x) => a + x, 0) / n).toFixed(3),
    profitFactor: gl > 0 ? +(gw / gl).toFixed(2) : null,
    pctLosers: +(losses.length / n * 100).toFixed(1),
    maxConsecutiveLosses: mcl,
    maxDrawdownDollar: maxDrawdownDollar(ts.map(t => t.pnlNet)),
    totalNetPnLDollar: Math.round(total),
    tickersPositivePct: tks.length ? +(posTk / tks.length * 100).toFixed(0) : 0,
  };
}

async function main() {
  const u = await getHtfUniverse();
  const symbols = [...u.tickers].sort((a, b) => (b.volume || 0) - (a.volume || 0)).slice(0, 500).map(r => r.symbol.toUpperCase());
  const cfg = { id: "rounding-bottom", label: "Rounding Bottom", timeframe: "daily" as const, scan: scanRoundingBottom as any, trailMaPeriod: 20 };
  const r = await runGenericStrategyPnL(cfg, symbols, 3650, POS, true, 70);

  const trades: T[] = [];
  for (const tk of (r.perTicker as any[])) {
    for (const tr of (tk.trades || [])) {
      if (tr.isOpen) continue;
      const ed = typeof tr.entryDate === "string" ? tr.entryDate : new Date(tr.entryDate).toISOString().slice(0, 10);
      const costFrac = COST_BPS / 10000 + (tr.entryPrice > 0 ? SPREAD_DOLLARS / tr.entryPrice : 0);
      trades.push({
        symbol: tk.symbol, entryDate: ed,
        entryPrice: tr.entryPrice, stopPrice: tr.stopPrice,
        pnlNet: tr.pnlDollar - costFrac * POS,
      });
    }
  }
  trades.sort((a, b) => a.entryDate.localeCompare(b.entryDate));
  const split = Math.floor(trades.length * 0.65);
  const out: any = {
    strategy: "rounding-bottom", positionSizeDollar: POS, costBps: COST_BPS, spreadDollars: SPREAD_DOLLARS,
    totalClosedTrades: trades.length, oosSplitDate: trades[split]?.entryDate,
    ALL: grade(trades), IS: grade(trades.slice(0, split)), OOS: grade(trades.slice(split)),
  };
  const o = out.OOS;
  out.verdict = (o && o.expectancyDollarAfterCosts > 0 && o.winRatePct >= 55 && o.tickersPositivePct >= 55)
    ? "CAPITAL-PRESERVING (GO)" : "NEEDS REVIEW";
  out.note = "Gate: OOS expectancy>0 after costs AND win rate>=55% AND >=55% of tickers positive. Eyeball maxDrawdownDollar vs your account size (want it well under ~account/4).";
  console.log(JSON.stringify(out, null, 2));
}
main().catch(e => { console.error(e); process.exit(1); });
