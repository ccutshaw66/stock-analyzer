/**
 * Gamma-Vol PAPER BOT — a deterministic, adjustable rules engine you can watch.
 *
 * Like HERMES/KAIROS but native and in-process. Plays two regime rules with zero
 * discretion on the ~95-name big-cap basket:
 *   - SHORT vol: dealers LONG gamma (GEX>0, vol suppressed) + IV rich  -> sell vol
 *   - LONG  vol: dealers SHORT gamma (GEX<0, vol amplified)  + IV cheap -> buy vol
 * IV "rich/cheap" is judged CROSS-SECTIONALLY (rank within the basket that day),
 * so signals work from day one — no long IV history needed.
 *
 * P&L is a variance proxy, paper only, NO broker, NO real money: a short-vol
 * trade wins iff realized vol over the hold window < the implied vol sold at
 * entry (reverse for long). Honest core of the edge, not exact option fills.
 * Adjustable money + risk via config (startingEquity, riskPct, maxPositions,
 * holdDays, IV thresholds). Equity is realized-only; open trades show a countdown.
 *
 * Persistence: gitignored data/gamma-bot/{config,state}.json (survives redeploys).
 */
import fs from "fs";
import path from "path";
import { GAMMA_UNIVERSE, readAllGammaSnapshots } from "./gamma-tracker";
import { computeMMExposure } from "./mm-exposure";
import { getHtfBars } from "./data/htf-ohlcv-cache";

export interface BotConfig {
  startingEquity: number;
  riskPctPerTrade: number; // fraction of equity risked per trade
  maxPositions: number;
  holdDays: number;
  shortIvRank: number; // sell vol only when cross-sectional IV rank >= this
  longIvRank: number;  // buy vol only when IV rank <= this
}
const DEFAULT_CONFIG: BotConfig = {
  startingEquity: 20000, riskPctPerTrade: 0.02, maxPositions: 20, holdDays: 10, shortIvRank: 0.6, longIvRank: 0.4,
};

interface OpenPos { id: string; ticker: string; side: "SHORT" | "LONG"; entryDate: string; entryIV: number; entrySpot: number; sizeDollars: number; ivRank: number; }
interface ClosedTrade extends OpenPos { exitDate: string; realizedVol: number; pnlVolPts: number; pnlPct: number; pnl$: number; }
interface Signal { ticker: string; gex: number; regime: "long-γ" | "short-γ"; atmIV: number; ivRank: number; side: "SHORT" | "LONG" | "—"; }

interface BotState {
  startedAt: string;
  equity: number;
  openPositions: OpenPos[];
  closedTrades: ClosedTrade[];
  equityCurve: { date: string; equity: number }[];
  processedDates: string[];
  lastSignals: Signal[];
  lastRun: string | null;
  running: boolean;
}

const DIR = path.resolve(process.cwd(), "data", "gamma-bot");
const CONFIG_FILE = path.join(DIR, "config.json");
const STATE_FILE = path.join(DIR, "state.json");
function ensureDir() { try { fs.mkdirSync(DIR, { recursive: true }); } catch {} }

export function getConfig(): BotConfig {
  try { return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) }; } catch { return { ...DEFAULT_CONFIG }; }
}
function saveConfig(c: BotConfig) { ensureDir(); fs.writeFileSync(CONFIG_FILE, JSON.stringify(c, null, 2)); }

function freshState(cfg: BotConfig): BotState {
  return { startedAt: new Date().toISOString(), equity: cfg.startingEquity, openPositions: [], closedTrades: [], equityCurve: [], processedDates: [], lastSignals: [], lastRun: null, running: false };
}
function getState(): BotState {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch { return freshState(getConfig()); }
}
function saveState(s: BotState) { ensureDir(); fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); }

export function updateConfig(partial: Partial<BotConfig>): BotConfig {
  const c = { ...getConfig(), ...partial };
  c.startingEquity = Math.max(500, Math.min(10_000_000, +c.startingEquity || DEFAULT_CONFIG.startingEquity));
  c.riskPctPerTrade = Math.max(0.001, Math.min(0.25, +c.riskPctPerTrade || DEFAULT_CONFIG.riskPctPerTrade));
  c.maxPositions = Math.max(1, Math.min(100, Math.round(+c.maxPositions || DEFAULT_CONFIG.maxPositions)));
  c.holdDays = Math.max(2, Math.min(60, Math.round(+c.holdDays || DEFAULT_CONFIG.holdDays)));
  c.shortIvRank = Math.max(0.5, Math.min(0.95, +c.shortIvRank || DEFAULT_CONFIG.shortIvRank));
  c.longIvRank = Math.max(0.05, Math.min(0.5, +c.longIvRank || DEFAULT_CONFIG.longIvRank));
  saveConfig(c);
  return c;
}
export function resetBot(): BotState { const s = freshState(getConfig()); saveState(s); return s; }

function realizedVol(closes: number[]): number | null {
  const r: number[] = [];
  for (let i = 1; i < closes.length; i++) if (closes[i] > 0 && closes[i - 1] > 0) r.push(Math.log(closes[i] / closes[i - 1]));
  if (r.length < 2) return null;
  const m = r.reduce((a, b) => a + b, 0) / r.length;
  const v = r.reduce((a, b) => a + (b - m) * (b - m), 0) / (r.length - 1);
  return Math.sqrt(v) * Math.sqrt(252);
}

type Snap = { ticker: string; gex: number; atmIV: number; spot: number };

/** Process one calendar day's basket of snapshots. Idempotent per date. */
async function processDay(date: string, snaps: Snap[], cfg: BotConfig, state: BotState): Promise<void> {
  if (state.processedDates.includes(date)) return;
  const usable = snaps.filter(s => s.atmIV > 0 && s.spot > 0);
  if (usable.length < 5) return; // not enough basket to rank

  // 1) close positions that reached the hold horizon
  const stillOpen: OpenPos[] = [];
  for (const p of state.openPositions) {
    let bars: any[] = [];
    try { bars = await getHtfBars(p.ticker, { lookbackDays: 400 }); } catch {}
    const idxByDate = new Map<string, number>();
    bars.forEach((b, i) => idxByDate.set(b.t.toISOString().slice(0, 10), i));
    const eIdx = idxByDate.get(p.entryDate);
    const cIdx = idxByDate.get(date);
    const heldBars = eIdx !== undefined && cIdx !== undefined ? cIdx - eIdx : 0;
    if (heldBars >= cfg.holdDays && eIdx !== undefined && cIdx !== undefined) {
      const rv = realizedVol(bars.slice(eIdx, cIdx + 1).map((b: any) => b.c)) ?? p.entryIV;
      const pnlVolPts = p.side === "SHORT" ? p.entryIV - rv : rv - p.entryIV;
      const pnlPct = Math.max(-1, Math.min(1, pnlVolPts / p.entryIV));
      const pnl$ = p.sizeDollars * pnlPct;
      state.equity += pnl$;
      state.closedTrades.push({ ...p, exitDate: date, realizedVol: rv, pnlVolPts, pnlPct, pnl$ });
    } else {
      stillOpen.push(p);
    }
  }
  state.openPositions = stillOpen;

  // 2) cross-sectional IV rank + signals
  const ivs = usable.map(s => s.atmIV).sort((a, b) => a - b);
  const rankOf = (iv: number) => ivs.filter(x => x <= iv).length / ivs.length;
  const signals: Signal[] = usable.map(s => {
    const ivRank = rankOf(s.atmIV);
    let side: "SHORT" | "LONG" | "—" = "—";
    if (s.gex > 0 && ivRank >= cfg.shortIvRank) side = "SHORT";
    else if (s.gex < 0 && ivRank <= cfg.longIvRank) side = "LONG";
    return { ticker: s.ticker, gex: s.gex, regime: s.gex > 0 ? "long-γ" : "short-γ", atmIV: s.atmIV, ivRank, side };
  }).sort((a, b) => Math.abs(b.gex) - Math.abs(a.gex));
  state.lastSignals = signals;

  // 3) open new positions (skip names already held; respect maxPositions)
  const held = new Set(state.openPositions.map(p => p.ticker));
  const size = state.equity * cfg.riskPctPerTrade;
  for (const sig of signals) {
    if (state.openPositions.length >= cfg.maxPositions) break;
    if (sig.side === "—" || held.has(sig.ticker)) continue;
    const snap = usable.find(s => s.ticker === sig.ticker)!;
    state.openPositions.push({ id: `${sig.ticker}-${date}`, ticker: sig.ticker, side: sig.side, entryDate: date, entryIV: snap.atmIV, entrySpot: snap.spot, sizeDollars: size, ivRank: sig.ivRank });
    held.add(sig.ticker);
  }

  state.processedDates.push(date);
  state.equityCurve.push({ date, equity: Math.round(state.equity) });
  if (state.equityCurve.length > 1000) state.equityCurve = state.equityCurve.slice(-1000);
  state.lastRun = new Date().toISOString();
}

/** Cron path: replay any newly-collected snapshot days the bot hasn't processed. */
export async function runBotOnStored(): Promise<{ processed: number }> {
  const cfg = getConfig(); const state = getState();
  const byDate = new Map<string, Snap[]>();
  for (const s of readAllGammaSnapshots()) {
    const arr = byDate.get(s.takenDate) ?? byDate.set(s.takenDate, []).get(s.takenDate)!;
    arr.push({ ticker: s.ticker.toUpperCase(), gex: s.totalGEX, atmIV: (s.atmIV ?? 0), spot: s.spot ?? 0 });
  }
  const dates = Array.from(byDate.keys()).sort();
  let processed = 0;
  for (const d of dates) if (!state.processedDates.includes(d)) { await processDay(d, byDate.get(d)!, cfg, state); processed++; }
  saveState(state);
  return { processed };
}

/** "Run Now" path: pull live gamma for the basket and process today. Background-safe. */
export async function runBotLive(): Promise<void> {
  const state = getState();
  if (state.running) return;
  state.running = true; saveState(state);
  try {
    const cfg = getConfig();
    const today = new Date().toISOString().slice(0, 10);
    const snaps: Snap[] = [];
    for (const t of GAMMA_UNIVERSE) {
      try { const mm = await computeMMExposure(t.toUpperCase()); if (mm && mm.spot) snaps.push({ ticker: t.toUpperCase(), gex: mm.totalGEX, atmIV: mm.atmIV ?? 0, spot: mm.spot }); } catch {}
      await new Promise(r => setTimeout(r, 200));
    }
    const fresh = getState(); // re-read in case config changed
    fresh.running = false;
    // force re-eval of today if we're refreshing it live
    fresh.processedDates = fresh.processedDates.filter(d => d !== today);
    await processDay(today, snaps, cfg, fresh);
    saveState(fresh);
  } catch (e) {
    const s = getState(); s.running = false; saveState(s);
  }
}

export function getBotView() {
  const cfg = getConfig(); const s = getState();
  const closed = s.closedTrades;
  const wins = closed.filter(t => t.pnl$ > 0).length;
  const totalPnl = s.equity - cfg.startingEquity;
  return {
    config: cfg,
    equity: Math.round(s.equity),
    startingEquity: cfg.startingEquity,
    totalPnl: Math.round(totalPnl),
    totalReturnPct: cfg.startingEquity ? +(totalPnl / cfg.startingEquity * 100).toFixed(2) : 0,
    openCount: s.openPositions.length,
    closedCount: closed.length,
    winRate: closed.length ? +(wins / closed.length * 100).toFixed(1) : null,
    openPositions: s.openPositions.map(p => ({ ...p, daysHeld: businessDaysSince(p.entryDate), holdDays: cfg.holdDays })),
    recentTrades: closed.slice(-30).reverse(),
    equityCurve: s.equityCurve,
    signals: s.lastSignals.slice(0, 60),
    activeSignalCount: s.lastSignals.filter(x => x.side !== "—").length,
    lastRun: s.lastRun,
    running: s.running,
    startedAt: s.startedAt,
  };
}
function businessDaysSince(dateStr: string): number {
  const start = new Date(dateStr + "T00:00:00Z").getTime();
  const days = Math.floor((Date.now() - start) / 86400000);
  return Math.max(0, days);
}
