/**
 * TREND-RIDE PAPER BOT — a deterministic, adjustable stock paper-trader you can watch.
 *
 * Trades the OOS-validated BBTC Trend-Ride (server/diag/bbtc-ema-sweep.ts):
 *   ENTRY  — BBTC's validated long entry (EMA9>EMA21 & close>EMA50, ADX>=20,
 *            RSI<65, SMA200 regime).
 *   EXIT   — a SIGNIFICANT break of the trend: `breakConfirmBars` consecutive
 *            closes below EMA(`exitEmaPeriod`, default 168). No fast ATR trail.
 *   STOP   — entry-bar catastrophe stop (2.5×ATR), the only hard floor.
 * Signals come straight from `computeBBTC({exitMode:"trendRide"})` — single
 * source of truth, identical to the validation.
 *
 * Paper only, NO broker, NO real money. Fills simulated at the daily close
 * (stop fills at the stop level). Small-account realism: a fixed % of equity
 * per position with a hard cap on concurrent positions, so when more names fire
 * than you have slots, the bot takes the first ones — same constraint a $7-10K
 * account hits. Equity is realized-only; open trades show an unrealized mark.
 *
 * Unlike options, stocks have full history, so on first run the bot SEEDS from
 * real trades over the last `seedMonths` months — you see real entries/exits/$
 * from day one — then continues forward each day (the true paper-forward test).
 *
 * Persistence: gitignored data/trend-ride-bot/{config,state}.json (survives redeploys).
 */
import fs from "fs";
import path from "path";
import { fmpGet } from "./data/providers/fmp.client";
import { computeBBTC } from "./signals/strategies/bbtc";
import { getHtfUniverse } from "./signals/universe/htf-universe";
import {
  RSI_PERIOD, ATR_PERIOD, EMA_FAST, EMA_MID, EMA_SLOW,
  TREND_RIDE_EMA, TREND_RIDE_CONFIRM_BARS,
} from "@shared/indicators/constants";

export interface BotConfig {
  startingEquity: number;
  positionPct: number;      // fraction of equity per position
  maxPositions: number;     // concurrent-position cap (small-account realism)
  exitEmaPeriod: number;    // trend line (default 168)
  breakConfirmBars: number; // consecutive closes below = a break (default 2)
  seedMonths: number;       // how far back to seed real trades on first run
  universeSize: number;     // top-N names by volume from the $5-75 universe
}
const DEFAULT_CONFIG: BotConfig = {
  startingEquity: 10000, positionPct: 0.2, maxPositions: 5,
  exitEmaPeriod: TREND_RIDE_EMA, breakConfirmBars: TREND_RIDE_CONFIRM_BARS,
  seedMonths: 18, universeSize: 120,
};

interface OpenPos { id: string; ticker: string; entryDate: string; entryPrice: number; shares: number; sizeDollars: number; hardStop: number; markPrice?: number; unrealPnl$?: number; unrealPnlPct?: number; }
interface ClosedTrade { id: string; ticker: string; entryDate: string; entryPrice: number; shares: number; exitDate: string; exitPrice: number; pnl$: number; pnlPct: number; exitReason: "trend-break" | "stop"; holdDays: number; }

interface BotState {
  startedAt: string;
  equity: number;
  openPositions: OpenPos[];
  closedTrades: ClosedTrade[];
  equityCurve: { date: string; equity: number }[];
  processedThrough: string | null; // last trading date processed
  universeSize: number;
  lastRun: string | null;
  running: boolean;
}

const DIR = path.resolve(process.cwd(), "data", "trend-ride-bot");
const CONFIG_FILE = path.join(DIR, "config.json");
const STATE_FILE = path.join(DIR, "state.json");
function ensureDir() { try { fs.mkdirSync(DIR, { recursive: true }); } catch {} }

export function getConfig(): BotConfig {
  try { return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) }; } catch { return { ...DEFAULT_CONFIG }; }
}
function saveConfig(c: BotConfig) { ensureDir(); const tmp = `${CONFIG_FILE}.tmp`; fs.writeFileSync(tmp, JSON.stringify(c, null, 2)); fs.renameSync(tmp, CONFIG_FILE); }

function freshState(cfg: BotConfig): BotState {
  return { startedAt: new Date().toISOString(), equity: cfg.startingEquity, openPositions: [], closedTrades: [], equityCurve: [], processedThrough: null, universeSize: 0, lastRun: null, running: false };
}
function getState(): BotState {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch { return freshState(getConfig()); }
}
function saveState(s: BotState) { ensureDir(); const tmp = `${STATE_FILE}.tmp`; fs.writeFileSync(tmp, JSON.stringify(s, null, 2)); fs.renameSync(tmp, STATE_FILE); }

export function updateConfig(partial: Partial<BotConfig>): BotConfig {
  const c = { ...getConfig(), ...partial };
  c.startingEquity = Math.max(500, Math.min(10_000_000, +c.startingEquity || DEFAULT_CONFIG.startingEquity));
  c.positionPct = Math.max(0.02, Math.min(1, +c.positionPct || DEFAULT_CONFIG.positionPct));
  c.maxPositions = Math.max(1, Math.min(50, Math.round(+c.maxPositions || DEFAULT_CONFIG.maxPositions)));
  c.exitEmaPeriod = Math.max(20, Math.min(300, Math.round(+c.exitEmaPeriod || DEFAULT_CONFIG.exitEmaPeriod)));
  c.breakConfirmBars = Math.max(1, Math.min(5, Math.round(+c.breakConfirmBars || DEFAULT_CONFIG.breakConfirmBars)));
  c.seedMonths = Math.max(0, Math.min(60, Math.round(Number.isFinite(+c.seedMonths) ? +c.seedMonths : DEFAULT_CONFIG.seedMonths)));
  c.universeSize = Math.max(10, Math.min(300, Math.round(+c.universeSize || DEFAULT_CONFIG.universeSize)));
  saveConfig(c);
  return c;
}
export function resetBot(): BotState { const s = freshState(getConfig()); saveState(s); return s; }

// ─── Indicator helpers (same math as the live path / validation) ────────────
function computeEMA(d: number[], p: number): number[] { const o = new Array(d.length).fill(NaN); if (d.length < p) return o; let s = 0; for (let i = 0; i < p; i++) s += d[i]; o[p - 1] = s / p; const k = 2 / (p + 1); for (let i = p; i < d.length; i++) o[i] = d[i] * k + o[i - 1] * (1 - k); return o; }
function computeATR(h: number[], l: number[], c: number[], p: number): number[] { const tr = new Array(c.length).fill(NaN); for (let i = 1; i < c.length; i++) tr[i] = Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])); const a = new Array(c.length).fill(NaN); if (c.length <= p) return a; let s = 0; for (let i = 1; i <= p; i++) s += tr[i]; a[p] = s / p; for (let i = p + 1; i < c.length; i++) a[i] = (a[i - 1] * (p - 1) + tr[i]) / p; return a; }
function computeRSI(c: number[], p: number): number[] { const r = new Array(c.length).fill(NaN); if (c.length <= p) return r; let g = 0, l = 0; for (let i = 1; i <= p; i++) { const ch = c[i] - c[i - 1]; if (ch > 0) g += ch; else l -= ch; } let ag = g / p, al = l / p; r[p] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); for (let i = p + 1; i < c.length; i++) { const ch = c[i] - c[i - 1]; ag = (ag * (p - 1) + (ch > 0 ? ch : 0)) / p; al = (al * (p - 1) + (ch < 0 ? -ch : 0)) / p; r[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); } return r; }

interface NameSignals { ticker: string; dates: string[]; close: number[]; sig: (string | null)[]; side: (string | null)[]; atr: number[]; }

async function loadNameSignals(symbol: string, cfg: BotConfig): Promise<NameSignals | null> {
  try {
    const to = new Date().toISOString().slice(0, 10);
    // enough history for EMA168/SMA200 warmup + the seed window
    const days = Math.round(cfg.seedMonths * 31) + 420;
    const from = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
    const data: any = await fmpGet("/historical-price-eod/full", { symbol, from, to });
    const arr: any[] = Array.isArray(data) ? data : (data?.historical || []);
    if (arr.length < 220) return null;
    const s = [...arr].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const dates: string[] = [], close: number[] = [], high: number[] = [], low: number[] = [];
    for (const r of s) { const c = Number(r.close); if (!Number.isFinite(c)) continue; dates.push(String(r.date)); close.push(c); high.push(Number(r.high)); low.push(Number(r.low)); }
    const rsi = computeRSI(close, RSI_PERIOD);
    const ema9 = computeEMA(close, EMA_FAST), ema21 = computeEMA(close, EMA_MID), ema50 = computeEMA(close, EMA_SLOW);
    const atr = computeATR(high, low, close, ATR_PERIOD);
    const bbtc = computeBBTC({ closes: close, highs: high, lows: low, ema9, ema21, ema50, atr14: atr, rsi14: rsi, exitMode: "trendRide", exitEmaPeriod: cfg.exitEmaPeriod, breakConfirmBars: cfg.breakConfirmBars });
    return { ticker: symbol, dates, close, sig: bbtc.signals as any, side: bbtc.signalSides as any, atr };
  } catch { return null; }
}

/**
 * Run the portfolio simulation forward. On first run (processedThrough null)
 * it seeds from `seedMonths` ago; afterwards it only processes new dates.
 */
export async function runBot(): Promise<{ processedDays: number; openedTrades: number; closedTrades: number }> {
  const cfg = getConfig();
  const state = getState();
  if (state.running) return { processedDays: 0, openedTrades: 0, closedTrades: 0 };
  state.running = true; saveState(state);
  try {
    const uni = await getHtfUniverse();
    const names = [...uni.tickers].sort((a, b) => (b.volume - a.volume) || a.symbol.localeCompare(b.symbol)).slice(0, cfg.universeSize).map(t => t.symbol);
    state.universeSize = names.length;

    // Load every name's signal series (batched, polite to FMP).
    const loaded: NameSignals[] = [];
    const BATCH = 12;
    for (let i = 0; i < names.length; i += BATCH) {
      const res = await Promise.allSettled(names.slice(i, i + BATCH).map(s => loadNameSignals(s, cfg)));
      for (const r of res) if (r.status === "fulfilled" && r.value) loaded.push(r.value);
      if (i + BATCH < names.length) await new Promise(r => setTimeout(r, 150));
    }

    // Per-name date->index for O(1) lookups.
    const idx = new Map<string, Map<string, number>>();
    for (const n of loaded) { const m = new Map<string, number>(); n.dates.forEach((d, i) => m.set(d, i)); idx.set(n.ticker, m); }

    // Trading-date axis = union of all names' dates.
    const allDates = Array.from(new Set(loaded.flatMap(n => n.dates))).sort();
    const seedFrom = new Date(Date.now() - cfg.seedMonths * 31 * 864e5).toISOString().slice(0, 10);
    const startDate = state.processedThrough ?? seedFrom;
    const toProcess = allDates.filter(d => d > startDate);

    let opened = 0, closed = 0;
    for (const d of toProcess) {
      // 1) manage open positions — exit on the name's trendRide SELL/STOP_HIT at d.
      const stillOpen: OpenPos[] = [];
      for (const p of state.openPositions) {
        const m = idx.get(p.ticker); const n = loaded.find(x => x.ticker === p.ticker);
        const i = m?.get(d);
        if (!n || i === undefined) { stillOpen.push(p); continue; }
        const sg = n.sig[i], sd = n.side[i];
        if ((sg === "SELL" || sg === "STOP_HIT") && sd === "LONG") {
          const exitPrice = sg === "STOP_HIT" ? Math.min(n.close[i], p.hardStop) : n.close[i];
          const pnl$ = p.shares * (exitPrice - p.entryPrice);
          state.equity += pnl$;
          const holdDays = i - (idx.get(p.ticker)!.get(p.entryDate) ?? i);
          state.closedTrades.push({ id: p.id, ticker: p.ticker, entryDate: p.entryDate, entryPrice: p.entryPrice, shares: p.shares, exitDate: d, exitPrice: +exitPrice.toFixed(2), pnl$: Math.round(pnl$), pnlPct: +((exitPrice - p.entryPrice) / p.entryPrice * 100).toFixed(2), exitReason: sg === "STOP_HIT" ? "stop" : "trend-break", holdDays });
          closed++;
        } else {
          p.markPrice = n.close[i]; p.unrealPnl$ = Math.round(p.shares * (n.close[i] - p.entryPrice)); p.unrealPnlPct = +((n.close[i] - p.entryPrice) / p.entryPrice * 100).toFixed(2);
          stillOpen.push(p);
        }
      }
      state.openPositions = stillOpen;

      // 2) open new positions on BUY signals (respect maxPositions; one per name).
      const held = new Set(state.openPositions.map(p => p.ticker));
      for (const n of loaded) {
        if (state.openPositions.length >= cfg.maxPositions) break;
        const i = idx.get(n.ticker)?.get(d);
        if (i === undefined) continue;
        if (!((n.sig[i] === "BUY" || n.sig[i] === "ADD_LONG") && n.side[i] === "LONG")) continue;
        if (held.has(n.ticker)) continue;
        const entryPrice = n.close[i];
        const sizeDollars = state.equity * cfg.positionPct;
        const shares = Math.floor(sizeDollars / entryPrice);
        if (shares < 1) continue;
        const entryATR = Number.isFinite(n.atr[i]) ? n.atr[i] : 0;
        state.openPositions.push({ id: `${n.ticker}-${d}`, ticker: n.ticker, entryDate: d, entryPrice: +entryPrice.toFixed(2), shares, sizeDollars: Math.round(shares * entryPrice), hardStop: +(entryPrice - 2.5 * entryATR).toFixed(2) });
        held.add(n.ticker); opened++;
      }

      // 3) record MARK-TO-MARKET equity for the day (realized + open marks),
      //    weekly-thinned to bound the curve. Realized-only would understate a
      //    trend-rider badly — it cuts losers fast but holds winners open for
      //    a year+, so the open marks ARE most of the account value.
      const dow = new Date(d + "T00:00:00Z").getUTCDay();
      if (dow === 5 || d === toProcess[toProcess.length - 1]) {
        const openMark = state.openPositions.reduce((a, p) => a + (p.unrealPnl$ || 0), 0);
        state.equityCurve.push({ date: d, equity: Math.round(state.equity + openMark) });
      }
    }
    if (state.equityCurve.length > 1500) state.equityCurve = state.equityCurve.slice(-1500);

    state.processedThrough = allDates[allDates.length - 1] ?? state.processedThrough;
    state.lastRun = new Date().toISOString();
    state.running = false;
    saveState(state);
    return { processedDays: toProcess.length, openedTrades: opened, closedTrades: closed };
  } catch (e) {
    const s = getState(); s.running = false; saveState(s);
    throw e;
  }
}

export function getBotView() {
  const cfg = getConfig(); const s = getState();
  const closed = s.closedTrades;
  const wins = closed.filter(t => t.pnl$ > 0).length;
    const realizedPnl = s.equity - cfg.startingEquity;
  const openPnl = s.openPositions.reduce((a, p) => a + (p.unrealPnl$ || 0), 0);
  const accountValue = s.equity + openPnl; // mark-to-market: realized cash + open marks
  const totalPnl = accountValue - cfg.startingEquity;
  const avgWin = (() => { const w = closed.filter(t => t.pnl$ > 0); return w.length ? Math.round(w.reduce((a, t) => a + t.pnl$, 0) / w.length) : 0; })();
  const avgLoss = (() => { const l = closed.filter(t => t.pnl$ <= 0); return l.length ? Math.round(l.reduce((a, t) => a + t.pnl$, 0) / l.length) : 0; })();
  return {
    config: cfg,
    strategy: `BBTC Trend-Ride — ride to a ${cfg.breakConfirmBars}-close break of the ${cfg.exitEmaPeriod}-EMA`,
    accountValue: Math.round(accountValue),
    realizedCash: Math.round(s.equity),
    startingEquity: cfg.startingEquity,
    totalPnl: Math.round(totalPnl),
    realizedPnl: Math.round(realizedPnl),
    openPnl,
    totalReturnPct: cfg.startingEquity ? +(totalPnl / cfg.startingEquity * 100).toFixed(2) : 0,
    openCount: s.openPositions.length,
    closedCount: closed.length,
    winRate: closed.length ? +(wins / closed.length * 100).toFixed(1) : null,
    avgWin$: avgWin, avgLoss$: avgLoss,
    openPositions: s.openPositions.map(p => ({ ...p, daysHeld: businessDaysSince(p.entryDate) })),
    recentTrades: [...closed].slice(-40).reverse(),
    equityCurve: s.equityCurve,
    universeSize: s.universeSize,
    processedThrough: s.processedThrough,
    lastRun: s.lastRun,
    running: s.running,
    startedAt: s.startedAt,
  };
}
function businessDaysSince(dateStr: string): number {
  const start = new Date(dateStr + "T00:00:00Z").getTime();
  return Math.max(0, Math.floor((Date.now() - start) / 86400000));
}
