/**
 * Rounding Bottom — capital-preservation validation at REALISTIC $7K-account sizing.
 *
 * The original validate-rounding-bottom.ts sized every trade at a flat $1,750 notional.
 * That's the 25%-of-$7K POSITION cap, not the 2% RISK cap — so its dollar P&L and the
 * −$22K drawdown are on a fixed notional, not on what the shipped 2%-risk engine
 * (server/signals/risk/position-sizing.ts) would actually trade on a $7K account.
 *
 * This version sizes EACH trade the way the live engine does, then reports the true
 * per-$7K-account dollar expectancy + worst-case drawdown:
 *   sharesByRisk     = floor(maxRisk$ / (entry - stop))     // ≤2% account risk
 *   sharesByPosition = floor(maxPosition$ / entry)          // ≤25% in one name
 *   shares           = min(both)  → realNotional = shares × entry
 *   real $ P&L       = (backtest returnPct) × realNotional   (costs on real notional)
 *
 * Rate metrics (win rate, profit factor, expectancy-R, ticker breadth) are
 * size-independent and identical to the flat-$1,750 run — only the $ figures change.
 *
 *   npx tsx scripts/validate-rounding-bottom-risksized.ts
 */
import dotenv from "dotenv"; dotenv.config();
import { getHtfUniverse } from "../server/signals/universe/htf-universe";
import { runGenericStrategyPnL } from "../server/diag/strategy-generic-pnl";
import { scanRoundingBottom } from "../server/signals/strategies/rounding-bottom";
import { DEFAULT_ACCOUNT_CONFIG, maxRiskPerTrade, maxPositionSize } from "../server/signals/risk/position-sizing";

const FLAT_POS = 1750;        // the notional the backtest computed pnlDollar on
const COST_BPS = 20;          // round-trip base cost (commission+impact), bps
const SPREAD_DOLLARS = 0.10;  // assumed full spread, price-scaled

const CFG = DEFAULT_ACCOUNT_CONFIG;            // capital 7000, 2% risk, 25% position
const MAX_RISK = maxRiskPerTrade(CFG);         // $140
const MAX_POS = maxPositionSize(CFG);          // $1,750

type T = {
  symbol: string; entryDate: string; entryPrice: number; stopPrice: number;
  shares: number; realNotional: number; realRiskDollar: number; pnlNet: number; retPct: number;
};

function maxDrawdownDollar(pnls: number[]): number {
  let eq = 0, peak = 0, mdd = 0;
  for (const p of pnls) { eq += p; peak = Math.max(peak, eq); mdd = Math.min(mdd, eq - peak); }
  return Math.round(mdd);
}

function grade(ts: T[]) {
  const n = ts.length; if (!n) return null;
  const wins = ts.filter(t => t.pnlNet > 0);
  const losses = ts.filter(t => t.pnlNet <= 0);
  const gw = wins.reduce((a, t) => a + t.pnlNet, 0);
  const gl = Math.abs(losses.reduce((a, t) => a + t.pnlNet, 0));
  const total = ts.reduce((a, t) => a + t.pnlNet, 0);
  const Rs = ts.map(t => (t.realRiskDollar > 0 ? t.pnlNet / t.realRiskDollar : 0));
  let mcl = 0, cur = 0; for (const t of ts) { if (t.pnlNet <= 0) { cur++; mcl = Math.max(mcl, cur); } else cur = 0; }
  const byTk: Record<string, number> = {}; for (const t of ts) byTk[t.symbol] = (byTk[t.symbol] || 0) + t.pnlNet;
  const tks = Object.values(byTk); const posTk = tks.filter(x => x > 0).length;
  const worstLoss = Math.round(Math.min(0, ...ts.map(t => t.pnlNet)));
  const avgRisk = ts.reduce((a, t) => a + t.realRiskDollar, 0) / n;
  return {
    trades: n,
    winRatePct: +(wins.length / n * 100).toFixed(1),
    expectancyDollarAfterCosts: +(total / n).toFixed(2),
    expectancyR: +(Rs.reduce((a, x) => a + x, 0) / n).toFixed(3),
    profitFactor: gl > 0 ? +(gw / gl).toFixed(2) : null,
    pctLosers: +(losses.length / n * 100).toFixed(1),
    maxConsecutiveLosses: mcl,
    avgRiskDollarPerTrade: +avgRisk.toFixed(0),
    worstSingleTradeDollar: worstLoss,
    maxDrawdownDollar: maxDrawdownDollar(ts.map(t => t.pnlNet)),
    maxDrawdownPctOfAccount: +(Math.abs(maxDrawdownDollar(ts.map(t => t.pnlNet))) / CFG.capital * 100).toFixed(0),
    totalNetPnLDollar: Math.round(total),
    tickersPositivePct: tks.length ? +(posTk / tks.length * 100).toFixed(0) : 0,
  };
}

async function main() {
  const u = await getHtfUniverse();
  const symbols = [...u.tickers].sort((a, b) => (b.volume || 0) - (a.volume || 0)).slice(0, 500).map(r => r.symbol.toUpperCase());
  const cfg = { id: "rounding-bottom", label: "Rounding Bottom", timeframe: "daily" as const, scan: scanRoundingBottom as any, trailMaPeriod: 20 };
  const r = await runGenericStrategyPnL(cfg, symbols, 3650, FLAT_POS, true, 70);

  const trades: T[] = [];
  for (const tk of (r.perTicker as any[])) {
    for (const tr of (tk.trades || [])) {
      if (tr.isOpen) continue;
      const entry = tr.entryPrice, stop = tr.stopPrice;
      const riskPerShare = entry - stop;
      if (!(entry > 0) || !(riskPerShare > 0)) continue;       // skip degenerate stops
      const sharesByRisk = Math.floor(MAX_RISK / riskPerShare);
      const sharesByPosition = Math.floor(MAX_POS / entry);
      const shares = Math.max(0, Math.min(sharesByRisk, sharesByPosition));
      if (shares <= 0) continue;                               // too pricey/wide to size on $7K
      const realNotional = shares * entry;
      const realRiskDollar = shares * riskPerShare;
      const retPct = tr.blendedReturnPct / 100;                // backtest return fraction
      const costFrac = COST_BPS / 10000 + SPREAD_DOLLARS / entry;
      const pnlNet = retPct * realNotional - costFrac * realNotional;
      const ed = typeof tr.entryDate === "string" ? tr.entryDate : new Date(tr.entryDate).toISOString().slice(0, 10);
      trades.push({ symbol: tk.symbol, entryDate: ed, entryPrice: entry, stopPrice: stop, shares, realNotional, realRiskDollar, pnlNet, retPct });
    }
  }
  trades.sort((a, b) => a.entryDate.localeCompare(b.entryDate));
  const split = Math.floor(trades.length * 0.65);
  const out: any = {
    strategy: "rounding-bottom (RISK-SIZED to $7K account)",
    account: CFG.capital, maxRiskPerTradeDollar: MAX_RISK, maxPositionDollar: MAX_POS,
    costBps: COST_BPS, spreadDollars: SPREAD_DOLLARS,
    totalClosedTrades: trades.length, oosSplitDate: trades[split]?.entryDate,
    ALL: grade(trades), IS: grade(trades.slice(0, split)), OOS: grade(trades.slice(split)),
  };
  const o = out.OOS;
  out.verdict = (o && o.expectancyDollarAfterCosts > 0 && o.winRatePct >= 55 && o.tickersPositivePct >= 55)
    ? "CAPITAL-PRESERVING (GO)" : "NEEDS REVIEW";
  out.note = "Each trade sized by the live 2%-risk / 25%-position engine on a $7K account. Worst single trade ≈ one 2% risk unit; maxDrawdownDollar is what a $7K account taking EVERY signal would have ridden through (real trading caps simultaneous positions, so true DD is lower).";
  console.log(JSON.stringify(out, null, 2));
}
main().catch(e => { console.error(e); process.exit(1); });
