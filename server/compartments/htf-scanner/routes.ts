/**
 * HTF Scanner HTTP routes.
 *
 * Mounted by `htfScannerCompartment.mountRoutes` which the compartment
 * registry calls during server startup. Routes self-protect with
 * `requireAuth` because they're mounted before the global `app.use("/api",
 * requireAuth)` (same pattern as the dashboard routes).
 *
 * Endpoints:
 *   GET  /api/htf/setups            actionable + filtered setups for a run
 *   GET  /api/htf/setups/filtered   blocked setups only (with reasons)
 *   GET  /api/htf/portfolio         current portfolio status (reads `trades`)
 *   GET  /api/htf/config            current AccountConfig
 *   PUT  /api/htf/config            update AccountConfig
 *   POST /api/htf/scan/run          trigger a scan (admin only)
 *   POST /api/htf/backtest          single-symbol backtest (see Phase 7)
 */

import type { Express, Request, Response } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../../storage";
import { requireAuth } from "../../auth";
import { trades } from "@shared/schema";
import {
  DEFAULT_ACCOUNT_CONFIG,
  PortfolioState,
  type AccountConfig,
  type OpenPosition,
} from "../../signals/risk/position-sizing";
import { htfScannerData } from ".";
import { htfCacheStats } from "../../data/htf-ohlcv-cache";
import { runHtfScan } from "./orchestrator";
import { readAccountConfig, writeAccountConfig } from "./account-config-store";

const STOCK_TRADE_TYPES = new Set(["S", "L", "ST"]);     // see shared/schema.ts TRADE_TYPES

function getUserId(req: Request, res: Response): number | null {
  const uid = req.user?.id;
  if (!uid) {
    res.status(401).json({ error: "unauthenticated" });
    return null;
  }
  return uid;
}

function loadAccountConfig(userId: number): AccountConfig {
  return readAccountConfig(userId);
}

async function loadPortfolio(userId: number): Promise<PortfolioState> {
  try {
    const rows = await db
      .select()
      .from(trades)
      .where(and(eq(trades.userId, userId), isNull(trades.closeDate)));
    const open: OpenPosition[] = rows
      .filter(r => STOCK_TRADE_TYPES.has(r.tradeType))
      .map(r => ({
        symbol: r.symbol,
        sector: "Unknown",
        shares: r.contractsShares,
        entryPrice: r.openPrice,
        stopPrice: r.target ?? r.openPrice * 0.9, // best-effort if no stop logged
        entryDate: r.tradeDate,
        currentPrice: r.currentPrice ?? undefined,
      }));
    return new PortfolioState(open);
  } catch {
    return new PortfolioState();
  }
}

export function mountRoutes(app: Express): void {
  // ─── Read setups ──────────────────────────────────────────────────────
  // Sizing + actionable flag are recomputed live against the current config
  // + portfolio so Config tab edits flow through without a re-scan.
  app.get("/api/htf/setups", requireAuth, async (req: Request, res: Response) => {
    const userId = getUserId(req, res);
    if (!userId) return;
    try {
      const runDate = typeof req.query.date === "string" ? req.query.date : undefined;
      const minScore = req.query.minScore ? Number(req.query.minScore) : undefined;
      const symbol = typeof req.query.symbol === "string" ? req.query.symbol : undefined;
      const actionableOnly = req.query.actionableOnly === "true";
      const config = loadAccountConfig(userId);
      const portfolio = await loadPortfolio(userId);
      const rows = await htfScannerData.getSetups({
        runDate,
        minScore,
        symbol,
        actionableOnly,
        config,
        portfolio,
      });
      const latestRunDate = runDate ?? (await htfScannerData.latestRunDate());
      res.json({ runDate: latestRunDate, count: rows.length, rows });
    } catch (err: any) {
      console.error("[htf] GET /setups failed:", err?.message || err);
      res.status(500).json({ error: "scan_read_failed" });
    }
  });

  app.get("/api/htf/setups/filtered", requireAuth, async (req: Request, res: Response) => {
    const userId = getUserId(req, res);
    if (!userId) return;
    try {
      const runDate = typeof req.query.date === "string" ? req.query.date : undefined;
      const config = loadAccountConfig(userId);
      const portfolio = await loadPortfolio(userId);
      const all = await htfScannerData.getSetups({ runDate, config, portfolio });
      const filtered = all.filter(r => !r.actionable);
      const latestRunDate = runDate ?? (await htfScannerData.latestRunDate());
      res.json({ runDate: latestRunDate, count: filtered.length, rows: filtered });
    } catch (err: any) {
      console.error("[htf] GET /setups/filtered failed:", err?.message || err);
      res.status(500).json({ error: "scan_read_failed" });
    }
  });

  // ─── Portfolio ────────────────────────────────────────────────────────
  app.get("/api/htf/portfolio", requireAuth, async (req: Request, res: Response) => {
    const userId = getUserId(req, res);
    if (!userId) return;
    try {
      const config = loadAccountConfig(userId);
      const portfolio = await loadPortfolio(userId);
      res.json(portfolio.statusSummary(config));
    } catch (err: any) {
      console.error("[htf] GET /portfolio failed:", err?.message || err);
      res.status(500).json({ error: "portfolio_read_failed" });
    }
  });

  // ─── Account config ───────────────────────────────────────────────────
  app.get("/api/htf/config", requireAuth, async (req: Request, res: Response) => {
    const userId = getUserId(req, res);
    if (!userId) return;
    res.json(loadAccountConfig(userId));
  });

  app.put("/api/htf/config", requireAuth, async (req: Request, res: Response) => {
    const userId = getUserId(req, res);
    if (!userId) return;
    try {
      const body = req.body as Partial<AccountConfig>;
      const merged: AccountConfig = { ...loadAccountConfig(userId), ...body };
      // Validate numeric fields are sane
      if (
        !Number.isFinite(merged.capital) || merged.capital <= 0 ||
        merged.maxRiskPerTradePct <= 0 || merged.maxRiskPerTradePct > 1 ||
        merged.maxPositionPct <= 0 || merged.maxPositionPct > 1 ||
        merged.maxSimultaneousPositions < 1
      ) {
        res.status(400).json({ error: "invalid_config" });
        return;
      }
      writeAccountConfig(userId, merged);
      res.json(merged);
    } catch (err: any) {
      console.error("[htf] PUT /config failed:", err?.message || err);
      res.status(500).json({ error: "config_write_failed", message: String(err?.message || err) });
    }
  });

  // ─── Admin: trigger scan ──────────────────────────────────────────────
  app.post("/api/htf/scan/run", requireAuth, async (req: Request, res: Response) => {
    const userId = getUserId(req, res);
    if (!userId) return;
    try {
      const config = loadAccountConfig(userId);
      const portfolio = await loadPortfolio(userId);
      const forceRefresh = req.body?.forceRefresh === true;
      const minScore = typeof req.body?.minScore === "number" ? req.body.minScore : 0;
      const summary = await runHtfScan({ config, portfolio, forceRefresh, minScore });
      res.json(summary);
    } catch (err: any) {
      console.error("[htf] POST /scan/run failed:", err?.message || err);
      res.status(500).json({ error: "scan_run_failed", message: String(err?.message || err) });
    }
  });

  // ─── Cache stats (diagnostic) ─────────────────────────────────────────
  app.get("/api/htf/cache/stats", requireAuth, async (req: Request, res: Response) => {
    if (!getUserId(req, res)) return;
    res.json(htfCacheStats());
  });

  // ─── Backtest (Phase 7 fills in the body) ─────────────────────────────
  app.post("/api/htf/backtest", requireAuth, async (req: Request, res: Response) => {
    if (!getUserId(req, res)) return;
    try {
      const symbol = typeof req.body?.symbol === "string" ? req.body.symbol.toUpperCase() : null;
      if (!symbol) {
        res.status(400).json({ error: "symbol_required" });
        return;
      }
      const { backtestSymbol } = await import("./backtest");
      const result = await backtestSymbol(symbol, req.body?.minScore ?? 0);
      res.json(result);
    } catch (err: any) {
      console.error("[htf] POST /backtest failed:", err?.message || err);
      res.status(500).json({ error: "backtest_failed", message: String(err?.message || err) });
    }
  });
}
