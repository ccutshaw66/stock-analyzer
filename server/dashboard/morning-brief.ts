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
  lossBudget: {
    /** Aziz 1%/day rule. Computed from starting account value. */
    dollarsBudgeted: number;        // 1% of starting account value
    /** Realized losses today + open-position drawdown from entry. */
    dollarsAtRisk: number;
    pctUsed: number;                // dollarsAtRisk / dollarsBudgeted
  };
}

const DAILY_LOSS_PCT = 0.01;          // Aziz Ch. 4

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

async function fetchLossBudget(userId: number): Promise<MorningBrief["lossBudget"]> {
  try {
    const settings = await storage.getAccountSettings(userId);
    const starting = settings?.startingAccountValue ?? 10000;
    const budgeted = starting * DAILY_LOSS_PCT;

    const today = todayIso();
    const allTrades = (await storage.getAllTrades(userId)) as Trade[];
    const closedToday = allTrades.filter(t => t.closeDate === today);
    const open = allTrades.filter(t => !t.closeDate);

    let realizedLoss = 0;
    for (const t of closedToday) {
      if (t.closePrice == null) continue;
      const dir = t.openPrice < 0 ? -1 : 1;
      const pnl = (t.closePrice - Math.abs(t.openPrice)) * t.contractsShares * dir;
      if (pnl < 0) realizedLoss += -pnl;
    }
    let openDrawdown = 0;
    for (const t of open) {
      if (t.currentPrice == null) continue;
      const dir = t.openPrice < 0 ? -1 : 1;
      const pnl = (t.currentPrice - Math.abs(t.openPrice)) * t.contractsShares * dir;
      if (pnl < 0) openDrawdown += -pnl;
    }
    const atRisk = realizedLoss + openDrawdown;
    return {
      dollarsBudgeted: Number(budgeted.toFixed(2)),
      dollarsAtRisk: Number(atRisk.toFixed(2)),
      pctUsed: budgeted > 0 ? Number((atRisk / budgeted).toFixed(3)) : 0,
    };
  } catch {
    return { dollarsBudgeted: 0, dollarsAtRisk: 0, pctUsed: 0 };
  }
}

export async function buildMorningBrief(userId: number): Promise<MorningBrief> {
  const [marketRegime, book, attention, freshSetups, lossBudget] = await Promise.all([
    fetchRegime(),
    fetchBook(userId),
    fetchAttention(userId),
    fetchFreshSetups(),
    fetchLossBudget(userId),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    marketRegime,
    book,
    attention,
    freshSetups,
    lossBudget,
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
