/**
 * STRANGLE PAPER BOT — auto-trades the Strangle/Vol scanner so it can be tested.
 *
 * Deterministic, paper only, no broker. Each run it reads the scanner's signals
 * (server/strangle-scanner.ts — same gamma+IV source), opens paper strangles
 * (SELL VOL → short strangle, BUY VOL → long strangle), and settles each at
 * expiry against the REAL underlying close (via the shared getHtfBars cache).
 *
 *   short-strangle P&L/share = premium − max(0, S−callK) − max(0, putK−S)
 *   long-strangle  P&L/share = −(that)
 *   $ = P&L/share × 100 × contracts
 *
 * Mark-to-market account value (open legs marked at intrinsic). Persists to
 * gitignored data/strangle-bot/{config,state}.json (survives redeploys).
 */
import fs from "fs";
import path from "path";
import { getStrangleScan } from "./strangle-scanner";
import { getHtfBars } from "./data/htf-ohlcv-cache";

export interface BotConfig {
  startingEquity: number;
  contractsPerTrade: number;
  maxPositions: number;
  holdDays: number;           // strangle tenor (calendar days to expiry)
  sides: "both" | "sell" | "buy";
  minScore: number;           // skip weak signals
}
const DEFAULT_CONFIG: BotConfig = {
  startingEquity: 25000, contractsPerTrade: 1, maxPositions: 10, holdDays: 30, sides: "both", minScore: 60,
};

interface OpenPos {
  id: string; ticker: string; side: "short" | "long"; entryDate: string; expiryDate: string;
  putK: number; callK: number; premium: number; entrySpot: number; contracts: number;
  markPrice?: number; markPnl$?: number;
}
interface ClosedTrade extends Omit<OpenPos, "markPrice" | "markPnl$"> {
  exitDate: string; exitSpot: number; pnl$: number; outcome: "expired-inside" | "breached";
}

interface BotState {
  startedAt: string; equity: number; openPositions: OpenPos[]; closedTrades: ClosedTrade[];
  equityCurve: { date: string; equity: number }[]; processedDates: string[];
  lastRun: string | null; running: boolean;
}

const DIR = path.resolve(process.cwd(), "data", "strangle-bot");
const CONFIG_FILE = path.join(DIR, "config.json");
const STATE_FILE = path.join(DIR, "state.json");
function ensureDir() { try { fs.mkdirSync(DIR, { recursive: true }); } catch {} }
function writeJson(fp: string, obj: any) { ensureDir(); const tmp = `${fp}.tmp`; fs.writeFileSync(tmp, JSON.stringify(obj, null, 2)); fs.renameSync(tmp, fp); }

export function getConfig(): BotConfig {
  try { return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) }; } catch { return { ...DEFAULT_CONFIG }; }
}
function freshState(cfg: BotConfig): BotState {
  return { startedAt: new Date().toISOString(), equity: cfg.startingEquity, openPositions: [], closedTrades: [], equityCurve: [], processedDates: [], lastRun: null, running: false };
}
function getState(): BotState { try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch { return freshState(getConfig()); } }
export function resetBot(): BotState { const s = freshState(getConfig()); writeJson(STATE_FILE, s); return s; }
export function updateConfig(partial: Partial<BotConfig>): BotConfig {
  const c = { ...getConfig(), ...partial };
  c.startingEquity = Math.max(1000, Math.min(10_000_000, +c.startingEquity || DEFAULT_CONFIG.startingEquity));
  c.contractsPerTrade = Math.max(1, Math.min(100, Math.round(+c.contractsPerTrade || 1)));
  c.maxPositions = Math.max(1, Math.min(50, Math.round(+c.maxPositions || DEFAULT_CONFIG.maxPositions)));
  c.holdDays = Math.max(7, Math.min(90, Math.round(+c.holdDays || DEFAULT_CONFIG.holdDays)));
  c.sides = (["both", "sell", "buy"] as const).includes(c.sides) ? c.sides : "both";
  c.minScore = Math.max(0, Math.min(100, Math.round(Number.isFinite(+c.minScore) ? +c.minScore : DEFAULT_CONFIG.minScore)));
  writeJson(CONFIG_FILE, c);
  return c;
}

const addDays = (d: string, n: number) => new Date(new Date(d + "T00:00:00Z").getTime() + n * 864e5).toISOString().slice(0, 10);
function settlePerShare(side: "short" | "long", putK: number, callK: number, premium: number, S: number): number {
  const shortPnl = premium - Math.max(0, S - callK) - Math.max(0, putK - S);
  return side === "short" ? shortPnl : -shortPnl;
}

/** Latest close on or before a date from the shared bar cache. */
async function closeOnOrBefore(ticker: string, date: string): Promise<number | null> {
  try {
    const bars = await getHtfBars(ticker, { lookbackDays: 200 });
    let px: number | null = null;
    for (const b of bars) if (b.t.toISOString().slice(0, 10) <= date) px = b.c; else break;
    return px;
  } catch { return null; }
}

export async function runBot(): Promise<{ opened: number; settled: number }> {
  const cfg = getConfig();
  const state = getState();
  if (state.running) return { opened: 0, settled: 0 };
  state.running = true; writeJson(STATE_FILE, state);
  try {
    const scan = getStrangleScan();
    const today = new Date().toISOString().slice(0, 10);

    // 1) settle / mark open positions
    let settled = 0;
    const stillOpen: OpenPos[] = [];
    for (const p of state.openPositions) {
      if (today >= p.expiryDate) {
        const S = await closeOnOrBefore(p.ticker, p.expiryDate);
        if (S == null) { stillOpen.push(p); continue; } // can't settle yet — hold
        const pnl = settlePerShare(p.side, p.putK, p.callK, p.premium, S) * 100 * p.contracts;
        state.equity += pnl;
        const inside = S <= p.callK && S >= p.putK;
        state.closedTrades.push({ ...p, exitDate: p.expiryDate, exitSpot: +S.toFixed(2), pnl$: Math.round(pnl), outcome: inside ? "expired-inside" : "breached" });
        settled++;
      } else {
        const S = await closeOnOrBefore(p.ticker, today);
        if (S != null) { p.markPrice = +S.toFixed(2); p.markPnl$ = Math.round(settlePerShare(p.side, p.putK, p.callK, p.premium, S) * 100 * p.contracts); }
        stillOpen.push(p);
      }
    }
    state.openPositions = stillOpen;

    // 2) open new strangles from today's signals (one snapshot day → idempotent per asOf)
    let opened = 0;
    if (scan.asOf && !state.processedDates.includes(scan.asOf)) {
      const held = new Set(state.openPositions.map(p => p.ticker));
      for (const r of scan.rows) {
        if (state.openPositions.length >= cfg.maxPositions) break;
        if (r.verdict === "—" || r.score < cfg.minScore || held.has(r.ticker)) continue;
        const side: "short" | "long" = r.verdict === "SELL VOL" ? "short" : "long";
        if (cfg.sides === "sell" && side !== "short") continue;
        if (cfg.sides === "buy" && side !== "long") continue;
        state.openPositions.push({
          id: `${r.ticker}-${scan.asOf}`, ticker: r.ticker, side, entryDate: scan.asOf, expiryDate: addDays(scan.asOf, cfg.holdDays),
          putK: r.putStrike, callK: r.callStrike, premium: r.premium, entrySpot: r.spot, contracts: cfg.contractsPerTrade,
        });
        held.add(r.ticker); opened++;
      }
      state.processedDates.push(scan.asOf);
    }

    const openMark = state.openPositions.reduce((a, p) => a + (p.markPnl$ || 0), 0);
    state.equityCurve.push({ date: today, equity: Math.round(state.equity + openMark) });
    if (state.equityCurve.length > 1000) state.equityCurve = state.equityCurve.slice(-1000);
    state.lastRun = new Date().toISOString();
    state.running = false;
    writeJson(STATE_FILE, state);
    return { opened, settled };
  } catch (e) {
    const s = getState(); s.running = false; writeJson(STATE_FILE, s); throw e;
  }
}

export function getBotView() {
  const cfg = getConfig(); const s = getState();
  const closed = s.closedTrades;
  const wins = closed.filter(t => t.pnl$ > 0).length;
  const realizedPnl = s.equity - cfg.startingEquity;
  const openPnl = s.openPositions.reduce((a, p) => a + (p.markPnl$ || 0), 0);
  const accountValue = s.equity + openPnl;
  return {
    config: cfg,
    accountValue: Math.round(accountValue),
    realizedCash: Math.round(s.equity),
    startingEquity: cfg.startingEquity,
    totalPnl: Math.round(accountValue - cfg.startingEquity),
    realizedPnl: Math.round(realizedPnl),
    openPnl,
    totalReturnPct: cfg.startingEquity ? +((accountValue - cfg.startingEquity) / cfg.startingEquity * 100).toFixed(2) : 0,
    openCount: s.openPositions.length,
    closedCount: closed.length,
    winRate: closed.length ? +(wins / closed.length * 100).toFixed(1) : null,
    openPositions: s.openPositions.map(p => ({ ...p, daysToExpiry: Math.max(0, Math.round((new Date(p.expiryDate).getTime() - Date.now()) / 864e5)) })),
    recentTrades: [...closed].slice(-40).reverse(),
    equityCurve: s.equityCurve,
    lastRun: s.lastRun,
    running: s.running,
    startedAt: s.startedAt,
  };
}
