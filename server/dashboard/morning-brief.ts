/**
 * Morning Brief aggregator — the one-paragraph banner that opens the dashboard.
 *
 * Computes (NOT generates with an LLM — correctness matters) the structured
 * numbers the client templates into a single sentence:
 *
 *   "Market is RISK-ON (regime up from yesterday). Your book +1.4% pre-market
 *    on N positions. 2 items need attention today: AAPL hit partial, NVDA
 *    approaching trail. 3 new HTF setups overnight. Loss budget $12 of $70
 *    used."
 *
 * All numbers are pulled from the same source-of-truth APIs the dedicated
 * pages use — Market Pulse for regime, Trade Tracker for book P&L, the
 * Action Queue for attention count, HTF orchestrator for fresh setups.
 */
import type { Express, Request, Response } from "express";
import { requireAuth } from "../auth";
import { storage } from "../storage";
import type { Trade } from "@shared/schema";
import { buildActionQueue } from "./action-queue";

export interface MorningBrief {
  /** ISO timestamp of generation. */
  generatedAt: string;
  marketRegime: {
    tier: string | null;            // "RISK-OFF" | "DEFENSIVE" | "NEUTRAL" | "RISK-ON" | "EUPHORIC"
    score: number | null;           // 0-100
    explainer: string | null;
  };
  book: {
    openPositionCount: number;
    realizedPnLDollar: number;      // closed trades, today only
    unrealizedPnLDollar: number;    // open trades, mark-to-current
    totalPnLDollar: number;         // realized + unrealized
  };
  attention: {
    itemCount: number;              // size of the Action Queue
    criticalCount: number;          // critical severity only
  };
  freshSetups: {
    htfCount: number;               // HTF setups within Givens' window
  };
  perTradeRisk: {
    /** Per-trade risk cap in dollars (account value × maxRiskPerTradePct). */
    dollarsBudgeted: number;
    /** Worst open position's current drawdown from entry (positive number). */
    worstDrawdownDollar: number;
    /** Symbol of the worst-drawdown open position (for the tooltip / drill). */
    worstSymbol: string | null;
    /** worstDrawdownDollar / dollarsBudgeted. ≥1 = a single position has blown past its risk cap. */
    pctUsed: number;
  };
  /**
   * Open-position count per strategy id. Chris rule (2026-05-22): "if there
   * are any trades in that strategy it should be on the dashboard." Lets the
   * Brief surface what strategies the user is currently trading without
   * dumping every individual position into the Action Queue.
   *
   * Strategy id matches `STRATEGY_REGISTRY` keys (htf, wyckoff-spring,
   * bbtc-ver, tft-40w, tft-60w, tft-cat, amc, manual, other).
   */
  strategyMix: Array<{ strategy: string; count: number }>;
}

const DEFAULT_PER_TRADE_RISK_PCT = 0.05;  // 5% per trade default (user can override via htf_config)

function todayIso(): string {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

async function fetchRegime(): Promise<MorningBrief["marketRegime"]> {
  try {
    const { readIntraday, readBreadth } = await import("../market-pulse-cache");
    const { computeRegime } = await import("../data/providers/market-pulse.adapter");
    const intraday = readIntraday();
    if (!intraday) return { tier: null, score: null, explainer: null };
    const breadth = readBreadth() ?? {
      pctAbove50d: null, pctAbove200d: null,
      newHighs: null, newLows: null, universeSize: null,
      asOf: 0,
    };
    const regime = computeRegime(intraday.volatility, breadth, intraday.riskAppetite);
    return {
      tier: regime?.tier ?? null,
      score: regime?.score ?? null,
      explainer: regime?.explainer ?? null,
    };
  } catch {
    return { tier: null, score: null, explainer: null };
  }
}

async function fetchBook(userId: number): Promise<MorningBrief["book"]> {
  try {
    const allTrades = (await storage.getAllTrades(userId)) as Trade[];
    const today = todayIso();
    const open = allTrades.filter(t => !t.closeDate);
    const closedToday = allTrades.filter(t => t.closeDate === today);

    // Realized today: closePrice - openPrice per share × shares (signs vary by trade type).
    const realized = closedToday.reduce((sum, t) => {
      if (t.closePrice == null) return sum;
      const dir = t.openPrice < 0 ? -1 : 1; // negative openPrice = debit/long-options sign convention
      return sum + (t.closePrice - Math.abs(t.openPrice)) * t.contractsShares * dir;
    }, 0);

    // Unrealized: currentPrice - openPrice per share × shares.
    const unrealized = open.reduce((sum, t) => {
      if (t.currentPrice == null) return sum;
      const dir = t.openPrice < 0 ? -1 : 1;
      return sum + (t.currentPrice - Math.abs(t.openPrice)) * t.contractsShares * dir;
    }, 0);

    return {
      openPositionCount: open.length,
      realizedPnLDollar: Number(realized.toFixed(2)),
      unrealizedPnLDollar: Number(unrealized.toFixed(2)),
      totalPnLDollar: Number((realized + unrealized).toFixed(2)),
    };
  } catch {
    return { openPositionCount: 0, realizedPnLDollar: 0, unrealizedPnLDollar: 0, totalPnLDollar: 0 };
  }
}

async function fetchAttention(userId: number): Promise<MorningBrief["attention"]> {
  try {
    const items = await buildActionQueue(userId);
    return {
      itemCount: items.length,
      criticalCount: items.filter(i => i.severity === "critical").length,
    };
  } catch {
    return { itemCount: 0, criticalCount: 0 };
  }
}

async function fetchFreshSetups(): Promise<MorningBrief["freshSetups"]> {
  try {
    const { htfScannerData } = await import("../compartments/htf-scanner");
    const result = await htfScannerData.getSetups({ actionableOnly: true });
    return { htfCount: result.rows.length };
  } catch {
    return { htfCount: 0 };
  }
}

async function fetchStrategyMix(userId: number): Promise<MorningBrief["strategyMix"]> {
  try {
    const allTrades = (await storage.getAllTrades(userId)) as Trade[];
    const open = allTrades.filter(t => !t.closeDate);
    const counts = new Map<string, number>();
    for (const t of open) {
      const key = (t.strategy || "manual").toString();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    // Sort by count desc so the most-used strategy appears first.
    return [...counts.entries()]
      .map(([strategy, count]) => ({ strategy, count }))
      .sort((a, b) => b.count - a.count);
  } catch {
    return [];
  }
}

async function fetchPerTradeRisk(userId: number): Promise<MorningBrief["perTradeRisk"]> {
  try {
    const settings = await storage.getAccountSettings(userId);
    const accountValue = settings?.startingAccountValue ?? 10000;
    // Per-trade risk pct: prefer user's htf_config setting, fall back to default
    // (5%). Field name matches `AccountConfig.maxRiskPerTradePct` so a single
    // user-config edit on /htf propagates to the dashboard.
    const cfg = (settings?.htfConfig ?? {}) as { maxRiskPerTradePct?: number };
    const riskPct = typeof cfg.maxRiskPerTradePct === "number" && cfg.maxRiskPerTradePct > 0
      ? cfg.maxRiskPerTradePct
      : DEFAULT_PER_TRADE_RISK_PCT;
    const budgeted = accountValue * riskPct;

    // For each open trade, compute current drawdown (positive number = how much
    // you're down from entry). Find the worst one — that's the trade most at
    // risk of blowing through your per-trade cap.
    const allTrades = (await storage.getAllTrades(userId)) as Trade[];
    const open = allTrades.filter(t => !t.closeDate);

    let worstDrawdown = 0;
    let worstSymbol: string | null = null;
    for (const t of open) {
      if (t.currentPrice == null) continue;
      const dir = t.openPrice < 0 ? -1 : 1;
      const pnl = (t.currentPrice - Math.abs(t.openPrice)) * t.contractsShares * dir;
      if (pnl < 0) {
        const drawdown = -pnl;
        if (drawdown > worstDrawdown) {
          worstDrawdown = drawdown;
          worstSymbol = t.symbol;
        }
      }
    }
    return {
      dollarsBudgeted: Number(budgeted.toFixed(2)),
      worstDrawdownDollar: Number(worstDrawdown.toFixed(2)),
      worstSymbol,
      pctUsed: budgeted > 0 ? Number((worstDrawdown / budgeted).toFixed(3)) : 0,
    };
  } catch {
    return { dollarsBudgeted: 0, worstDrawdownDollar: 0, worstSymbol: null, pctUsed: 0 };
  }
}

export async function buildMorningBrief(userId: number): Promise<MorningBrief> {
  const [marketRegime, book, attention, freshSetups, perTradeRisk, strategyMix] = await Promise.all([
    fetchRegime(),
    fetchBook(userId),
    fetchAttention(userId),
    fetchFreshSetups(),
    fetchPerTradeRisk(userId),
    fetchStrategyMix(userId),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    marketRegime,
    book,
    attention,
    freshSetups,
    perTradeRisk,
    strategyMix,
  };
}

export function registerMorningBriefRoute(app: Express): void {
  app.get("/api/dashboard/morning-brief", requireAuth, async (req: Request, res: Response) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "unauthenticated" });
    try {
      const brief = await buildMorningBrief(userId);
      res.json(brief);
    } catch (err: any) {
      console.error("[dashboard] morning-brief failed:", err?.message || err);
      res.status(500).json({ error: "morning_brief_failed", message: String(err?.message || err) });
    }
  });
}
