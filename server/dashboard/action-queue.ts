/**
 * Action Queue aggregator — the centerpiece of the rebuilt dashboard.
 *
 * Returns the prioritized list of decisions the user needs to make TODAY,
 * pulled from existing source-of-truth APIs:
 *
 *   - Open trades (storage) → run their strategy manifest's `evaluate()` to
 *     surface lifecycle alerts (stop near, target near, partial due, etc).
 *   - Alerts table → unread + undismissed rows from the cron-evaluated alert
 *     rules (scanner verdict changes, price stops, earnings rules).
 *   - HTF setups → setups still within Givens' entry window (per
 *     orchestrator's MAX_DAYS_SINCE_BREAKOUT + MAX_CHASE_PCT gates).
 *   - Earnings → held positions reporting within the next N trading days
 *     (Bennet vol-crush awareness, default 2 days).
 *
 * Per the "no-action-no-show" rule: if a position has nothing actionable,
 * it does not appear in the queue. Empty queue = "All clear" state.
 */
import type { Express, Request, Response } from "express";
import { requireAuth } from "../auth";
import { storage } from "../storage";
import { db } from "../db";
import { alerts, type Trade } from "@shared/schema";
import { eq, and, gte, desc } from "drizzle-orm";
import {
  getStrategyManifest,
  type StrategyTradeView,
  type LifecycleSeverity,
} from "@shared/strategies/registry";
import { getEarningsForPositions } from "../snapshot/earnings";

export type ActionItemKind = "trade-alert" | "alert" | "htf-setup" | "earnings";

export interface ActionItem {
  /** Stable id for React keys + dismiss tracking. */
  id: string;
  kind: ActionItemKind;
  /** Affected ticker (always uppercase). */
  symbol: string;
  /** Severity from the strategy/alert source — drives badge color. */
  severity: LifecycleSeverity;
  /** Short headline shown bold. */
  title: string;
  /** Sub-line shown muted. */
  detail: string;
  /** Optional action label (e.g. "Close 30", "Take partial"). */
  actionLabel?: string;
  /** Where clicking the item takes the user. */
  href: string;
  /** Optional priority — used to sort within a severity tier. Higher first. */
  priority?: number;
  /** When this item was generated (server time, for "X min ago" hints). */
  generatedAt: number;
}

const SEVERITY_RANK: Record<LifecycleSeverity, number> = {
  critical: 0,
  warn: 1,
  watch: 2,
  info: 3,
};

function sortQueue(items: ActionItem[]): ActionItem[] {
  return [...items].sort((a, b) => {
    const sev = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (sev !== 0) return sev;
    return (b.priority ?? 0) - (a.priority ?? 0);
  });
}

/** Convert an open Trade row to the manifest's StrategyTradeView shape. */
function tradeToView(t: any): StrategyTradeView {
  return {
    symbol: String(t.symbol).toUpperCase(),
    openPrice: Number(t.openPrice),
    currentPrice: t.currentPrice == null ? null : Number(t.currentPrice),
    target: t.target == null ? null : Number(t.target),
    closeDate: t.closeDate ?? null,
    tradeDate: t.tradeDate,
    strategy: t.strategy ?? "manual",
    strategyReason: t.strategyReason ?? null,
    strategyData: t.strategyData ?? null,
    contractsShares: typeof t.contractsShares === "number" ? t.contractsShares : undefined,
    lifecycleState: t.lifecycleState ?? null,
  };
}

/** Drive the manifest alerts off each open trade. */
async function tradeAlerts(userId: number): Promise<ActionItem[]> {
  const allTrades = await storage.getAllTrades(userId);
  const open = (allTrades as Trade[]).filter(t => !t.closeDate);
  if (open.length === 0) return [];

  // Enrich open HTF trades with live lifecycle state (mirrors /api/trades logic).
  const { getHtfBars } = await import("../data/htf-ohlcv-cache");
  const { computeHtfLifecycle } = await import("../compartments/htf-scanner/lifecycle");
  const enriched = await Promise.all(
    open.map(async (t: any) => {
      if (t.strategy !== "htf") return t;
      try {
        const bars = await getHtfBars(t.symbol);
        if (bars.length === 0) return t;
        const data = (t.strategyData ?? {}) as any;
        const entryPrice = Math.abs(t.openPrice);
        const lifecycleState = computeHtfLifecycle(
          bars,
          t.tradeDate,
          entryPrice,
          typeof data.flagHigh === "number" ? data.flagHigh : null,
          typeof data.flagLow === "number" ? data.flagLow : null,
          typeof data.targetPrice === "number" ? data.targetPrice : (t.target ?? null),
        );
        return { ...t, lifecycleState };
      } catch {
        return t;
      }
    }),
  );

  const items: ActionItem[] = [];
  const now = Date.now();
  for (const t of enriched) {
    try {
      const manifest = getStrategyManifest(t.strategy);
      const view = tradeToView(t);
      const evalRes = manifest.evaluate(view);
      // Only surface alerts at watch or higher — info-level chatter is for
      // the per-trade Positions row, not the dashboard queue.
      const promoted = evalRes.alerts.filter(a => a.severity !== "info");
      for (const a of promoted) {
        items.push({
          id: `trade-${t.id}-${a.message.slice(0, 16)}`,
          kind: "trade-alert",
          symbol: t.symbol.toUpperCase(),
          severity: a.severity,
          title: `${t.symbol.toUpperCase()} · ${manifest.shortName}`,
          detail: a.message,
          actionLabel: a.actionLabel,
          href: `/tracker`,
          priority: a.severity === "critical" ? 100 : a.severity === "warn" ? 75 : 50,
          generatedAt: now,
        });
      }
    } catch {
      // Best-effort per trade; one bad manifest doesn't tank the queue.
    }
  }
  return items;
}

/** Surface unread + undismissed cron alerts from the last 24 hours. */
async function cronAlerts(userId: number): Promise<ActionItem[]> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  try {
    const rows = await db
      .select()
      .from(alerts)
      .where(
        and(
          eq(alerts.userId, userId),
          eq(alerts.dismissed, false),
          gte(alerts.createdAt, since),
        ),
      )
      .orderBy(desc(alerts.createdAt))
      .limit(50);
    return rows.map((a: any) => ({
      id: `alert-${a.id}`,
      kind: "alert" as const,
      symbol: String(a.symbol || "").toUpperCase(),
      severity: (a.severity as LifecycleSeverity) ?? "watch",
      title: a.title ?? `${a.kind} fired`,
      detail: a.body ?? "",
      href: `/alerts`,
      priority: a.read ? 10 : 40,
      generatedAt: new Date(a.createdAt).getTime(),
    }));
  } catch {
    return [];
  }
}

/**
 * HTF setups within Givens' entry window — actionable AND not already chased.
 * Uses default config/portfolio (per-user resize lives on /htf itself); the
 * Action Queue's job is to flag "this is here," not to size the position.
 */
async function htfSetupItems(_userId: number): Promise<ActionItem[]> {
  try {
    const { htfScannerData } = await import("../compartments/htf-scanner");
    const result = await htfScannerData.getSetups({
      actionableOnly: true,
    });
    const now = Date.now();
    return result.rows.slice(0, 10).map((r: any) => ({
      id: `htf-${r.symbol}-${r.breakoutDate}`,
      kind: "htf-setup" as const,
      symbol: String(r.symbol).toUpperCase(),
      severity: r.qualityScore >= 85 ? "warn" : "watch",
      title: `${r.symbol} · HTF breakout (score ${r.qualityScore})`,
      detail: `Entry near $${Number(r.breakoutPrice).toFixed(2)}; target $${Number(r.targetPrice).toFixed(2)}; window closes after next open.`,
      actionLabel: "View setup",
      href: `/htf/${r.symbol}`,
      priority: Math.min(70, Math.max(20, r.qualityScore)),
      generatedAt: now,
    }));
  } catch {
    return [];
  }
}

/** Earnings within the next N trading days on any open position (Bennet rule). */
async function earningsItems(userId: number, withinDays = 2): Promise<ActionItem[]> {
  try {
    const allTrades = await storage.getAllTrades(userId);
    const open = (allTrades as Trade[]).filter(t => !t.closeDate);
    const tickers = Array.from(new Set(open.map(t => String(t.symbol).toUpperCase())));
    if (tickers.length === 0) return [];
    const upcoming = await getEarningsForPositions(tickers, withinDays);
    const now = Date.now();
    return upcoming.map(e => ({
      id: `earn-${e.symbol}-${e.nextReportDate}`,
      kind: "earnings" as const,
      symbol: e.symbol,
      severity: (e.daysUntil <= 1 ? "warn" : "watch") as LifecycleSeverity,
      title: `${e.symbol} earnings in ${e.daysUntil}d`,
      detail: `Report ${e.nextReportDate}. Vol-crush window — review option exposure.`,
      actionLabel: "Open position",
      href: `/tracker`,
      priority: 60 - e.daysUntil,
      generatedAt: now,
    }));
  } catch {
    return [];
  }
}

export async function buildActionQueue(userId: number): Promise<ActionItem[]> {
  const [trade, cron, htf, earn] = await Promise.all([
    tradeAlerts(userId),
    cronAlerts(userId),
    htfSetupItems(userId),
    earningsItems(userId),
  ]);
  return sortQueue([...trade, ...cron, ...htf, ...earn]);
}

export function registerActionQueueRoute(app: Express): void {
  app.get("/api/dashboard/action-queue", requireAuth, async (req: Request, res: Response) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "unauthenticated" });
    try {
      const items = await buildActionQueue(userId);
      res.json({ items, generatedAt: Date.now() });
    } catch (err: any) {
      console.error("[dashboard] action-queue failed:", err?.message || err);
      res.status(500).json({ error: "action_queue_failed", message: String(err?.message || err) });
    }
  });
}
