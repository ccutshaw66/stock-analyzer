// Alert evaluator (Phase 4.1)
// Runs every 30 minutes during market hours. For each enabled rule across all
// users, evaluates the trigger and emits an alert if it tripped. Dedupes via
// alertRules.lastFiredState so the same verdict doesn't fire repeatedly.

import { registerJob } from "../scheduler";
import { storage } from "../../../storage";
import { analyzeTicker } from "../../../signal-engine";
import { data } from "../../../data";
import type { AlertRule, InsertAlert } from "@shared/schema";

interface EvalContext {
  getVerdict: (ticker: string) => Promise<{ verdict: string; score: number; price: number } | null>;
  now: Date;
}

function parseConfig<T = any>(raw: string | null): T | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

async function fetchVerdict(ticker: string): Promise<{ verdict: string; score: number; price: number } | null> {
  try {
    const now = new Date();
    const from = new Date(now.getTime() - 210 * 24 * 60 * 60 * 1000); // ~210 calendar days → ≥150 trading days
    const bars = await data.getAggregates(ticker, from, now, "day");
    if (!bars || bars.length < 60) return null;
    const closes = bars.map(b => b.c);
    const highs = bars.map(b => b.h);
    const lows = bars.map(b => b.l);
    const vols = bars.map(b => b.v);
    const gate = analyzeTicker({ ticker, closes, highs, lows, volumes: vols, mmeData: null });
    return { verdict: gate.signal, score: gate.gatesCleared, price: closes[closes.length - 1] };
  } catch {
    return null;
  }
}

// ── Trigger evaluators (return null if not tripped, or an alert to emit) ──

async function evalScannerVerdict(rule: AlertRule, ctx: EvalContext): Promise<InsertAlert | null> {
  // Config: { verdicts?: string[]; tickers?: string[] }
  // If rule.ticker set → scope to that one ticker. Else fall back to config.tickers or all watchlist.
  const cfg = parseConfig<{ verdicts?: string[]; tickers?: string[] }>(rule.config) || {};
  const watchVerdicts = cfg.verdicts?.length ? cfg.verdicts : ["GO ↑", "GO ↓", "SET ↑", "SET ↓", "PULLBACK"];

  let tickers: string[] = [];
  if (rule.ticker) {
    tickers = [rule.ticker.toUpperCase()];
  } else if (cfg.tickers?.length) {
    tickers = cfg.tickers.map(t => t.toUpperCase());
  } else {
    // Scope = watchlist + open positions
    const favs = await storage.getFavorites(rule.userId, "watchlist");
    const trades = await storage.getAllTrades(rule.userId);
    const openSyms = trades.filter(t => !t.closeDate).map(t => t.symbol.toUpperCase());
    tickers = Array.from(new Set([...favs.map(f => f.ticker.toUpperCase()), ...openSyms]));
  }

  // Evaluate each ticker; fire on first trip (keeps alert volume sane).
  const prevState = parseConfig<Record<string, string>>(rule.lastFiredState) || {};
  const newState: Record<string, string> = { ...prevState };
  let tripped: InsertAlert | null = null;

  for (const tk of tickers) {
    const v = await ctx.getVerdict(tk);
    if (!v) continue;
    const matches = watchVerdicts.some(want => v.verdict.startsWith(want));
    if (!matches) continue;
    // Dedupe: only fire if this ticker's verdict changed since last run
    if (prevState[tk] === v.verdict) continue;
    newState[tk] = v.verdict;
    if (!tripped) {
      tripped = {
        userId: rule.userId,
        ruleId: rule.id,
        kind: "SCANNER_VERDICT",
        ticker: tk,
        title: `${tk}: ${v.verdict}`,
        body: `Scanner 2.0 now reads ${v.verdict} (${v.score}/3 gates) at $${v.price.toFixed(2)}.`,
        meta: JSON.stringify({ verdict: v.verdict, score: v.score, price: v.price }),
        severity: v.verdict.startsWith("GO") ? "critical" : v.verdict.startsWith("SET") ? "warn" : "info",
        read: false,
        dismissed: false,
      };
    }
  }

  // Persist state even if nothing fired (captures new verdicts we don't alert on too)
  await storage.touchAlertRule(rule.id, JSON.stringify(newState));
  return tripped;
}

async function evalPriceCross(rule: AlertRule, kind: "PRICE_TARGET" | "PRICE_STOP"): Promise<InsertAlert | null> {
  if (!rule.tradeId) return null;
  const trade = await storage.getTrade(rule.userId, rule.tradeId);
  if (!trade || trade.closeDate) return null;
  const level = kind === "PRICE_TARGET" ? trade.target : (parseConfig<{ stop?: number }>(rule.config)?.stop);
  if (!level || level <= 0) return null;

  let last: number | null = null;
  try {
    const q = await data.getQuote(trade.symbol);
    last = q?.price ?? null;
  } catch { return null; }
  if (!last) return null;
  const openPx = trade.openPrice || 0;
  const isLong = openPx >= 0; // simplistic; matches existing P/L direction convention
  const crossed = kind === "PRICE_TARGET"
    ? (isLong ? last >= level : last <= level)
    : (isLong ? last <= level : last >= level);
  if (!crossed) return null;

  const stateKey = `${kind}:${last.toFixed(2)}`;
  if (rule.lastFiredState === stateKey) return null; // already fired for this approx level
  await storage.touchAlertRule(rule.id, stateKey);

  return {
    userId: rule.userId,
    ruleId: rule.id,
    kind,
    ticker: trade.symbol,
    title: `${trade.symbol} ${kind === "PRICE_TARGET" ? "hit target" : "hit stop"}: $${last.toFixed(2)}`,
    body: `${trade.symbol} ${isLong ? "above" : "below"} ${kind === "PRICE_TARGET" ? "target" : "stop"} $${level.toFixed(2)} (current $${last.toFixed(2)}).`,
    meta: JSON.stringify({ tradeId: trade.id, level, price: last }),
    severity: kind === "PRICE_STOP" ? "critical" : "warn",
    read: false,
    dismissed: false,
  };
}

async function evalEarnings(rule: AlertRule, ctx: EvalContext): Promise<InsertAlert | null> {
  const cfg = parseConfig<{ daysBefore?: number }>(rule.config) || {};
  const daysBefore = cfg.daysBefore ?? 7;

  // Scope: if rule.tradeId → that trade only; else all open positions
  let symbols: string[] = [];
  if (rule.tradeId) {
    const t = await storage.getTrade(rule.userId, rule.tradeId);
    if (t && !t.closeDate) symbols = [t.symbol.toUpperCase()];
  } else {
    const trades = await storage.getAllTrades(rule.userId);
    symbols = Array.from(new Set(trades.filter(t => !t.closeDate).map(t => t.symbol.toUpperCase())));
  }
  if (!symbols.length) return null;

  const cutoff = new Date(ctx.now.getTime() + daysBefore * 24 * 60 * 60 * 1000);
  const prevState = parseConfig<Record<string, string>>(rule.lastFiredState) || {};
  const newState = { ...prevState };
  let tripped: InsertAlert | null = null;

  for (const sym of symbols) {
    try {
      const ev = await data.getEarnings(sym, 4);
      const next = ev?.filter(e => new Date(e.reportDate) >= ctx.now).sort((a, b) => new Date(a.reportDate).getTime() - new Date(b.reportDate).getTime())[0];
      if (!next) continue;
      const reportDate = new Date(next.reportDate);
      if (reportDate > cutoff) continue;
      const key = `${sym}:${reportDate.toISOString().slice(0, 10)}`;
      if (prevState[sym] === key) continue;
      newState[sym] = key;
      if (!tripped) {
        const days = Math.ceil((reportDate.getTime() - ctx.now.getTime()) / (24 * 60 * 60 * 1000));
        tripped = {
          userId: rule.userId,
          ruleId: rule.id,
          kind: "EARNINGS",
          ticker: sym,
          title: `${sym} earnings in ${days}d`,
          body: `${sym} reports ${next.fiscalPeriod || ""} on ${reportDate.toISOString().slice(0, 10)}.`,
          meta: JSON.stringify({ reportDate: next.reportDate, fiscalPeriod: next.fiscalPeriod }),
          severity: "warn",
          read: false,
          dismissed: false,
        };
      }
    } catch { /* skip ticker on error */ }
  }
  await storage.touchAlertRule(rule.id, JSON.stringify(newState));
  return tripped;
}

// Unusual options: placeholder that hooks the Polygon unusual-options detector
// when it's wired up. For MVP we emit nothing (the rule row still exists and
// can be enabled when detector data becomes available at the per-user level).
async function evalUnusualOptions(_rule: AlertRule): Promise<InsertAlert | null> {
  return null;
}

async function evaluateOnce() {
  const rules = await storage.getAllAlertRulesAllUsers();
  if (!rules.length) return;

  const verdictCache = new Map<string, { verdict: string; score: number; price: number } | null>();
  const ctx: EvalContext = {
    now: new Date(),
    getVerdict: async (ticker: string) => {
      const key = ticker.toUpperCase();
      if (verdictCache.has(key)) return verdictCache.get(key)!;
      const v = await fetchVerdict(key);
      verdictCache.set(key, v);
      return v;
    },
  };

  let emitted = 0;
  for (const rule of rules) {
    try {
      let alert: InsertAlert | null = null;
      if (rule.kind === "SCANNER_VERDICT")  alert = await evalScannerVerdict(rule, ctx);
      else if (rule.kind === "PRICE_TARGET") alert = await evalPriceCross(rule, "PRICE_TARGET");
      else if (rule.kind === "PRICE_STOP")   alert = await evalPriceCross(rule, "PRICE_STOP");
      else if (rule.kind === "EARNINGS")     alert = await evalEarnings(rule, ctx);
      else if (rule.kind === "UNUSUAL_OPTIONS") alert = await evalUnusualOptions(rule);
      if (alert) {
        await storage.createAlert(alert);
        emitted++;
      }
    } catch (err: any) {
      console.warn(`[alerts] rule ${rule.id} failed:`, err?.message || err);
    }
  }
  if (emitted) console.log(`[alerts] emitted ${emitted} alert(s) across ${rules.length} rule(s)`);
}

registerJob({
  id: "evaluate-alerts",
  description: "Evaluates user alert rules every 30m during market hours.",
  cron: "*/30 13-21 * * 1-5", // UTC ~ US market hours
  timeoutMs: 5 * 60 * 1000,
  handler: evaluateOnce,
});

export { evaluateOnce as evaluateAlertsOnce };
