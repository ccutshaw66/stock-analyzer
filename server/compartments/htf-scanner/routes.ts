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
import { storage } from "../../storage";
import { requireAuth } from "../../auth";
import { TRADE_TYPES } from "@shared/schema";
import {
  DEFAULT_ACCOUNT_CONFIG,
  PortfolioState,
  type AccountConfig,
  type OpenPosition,
} from "../../signals/risk/position-sizing";
import { htfScannerData } from ".";
import { htfCacheStats, getHtfBars } from "../../data/htf-ohlcv-cache";
import { runHtfScan, peekLatestScan } from "./orchestrator";
import { scanHtf } from "../../signals/strategies/htf";
import { computeSizingRecommendation, SIZING_PHASES } from "./sizing";
import { computeClosedTradeProfit } from "@shared/pnl";

// Trade types that represent equity positions (vs option contracts). Filter
// from the shared TRADE_TYPES registry so this stays in sync with schema.ts
// — never hard-code the codes here.
const STOCK_TRADE_TYPES = new Set(
  Object.entries(TRADE_TYPES)
    .filter(([, def]) => def.category === "Stock")
    .map(([code]) => code),
);

function getUserId(req: Request, res: Response): number | null {
  const uid = req.user?.id;
  if (!uid) {
    res.status(401).json({ error: "unauthenticated" });
    return null;
  }
  return uid;
}

async function loadAccountConfig(userId: number): Promise<AccountConfig> {
  try {
    const row = await storage.getAccountSettings(userId);
    const persisted = (row as any)?.htfConfig;
    if (persisted && typeof persisted === "object") {
      return { ...DEFAULT_ACCOUNT_CONFIG, ...persisted };
    }
  } catch {
    // Storage threw — fall through to defaults. getAccountSettings already
    // has a migration-lag fallback (SELECT *) so this branch is rare.
  }
  return { ...DEFAULT_ACCOUNT_CONFIG };
}

async function loadPortfolio(userId: number): Promise<PortfolioState> {
  try {
    const all = await storage.getAllTrades(userId);
    // Build a symbol → scan-row lookup so we can backfill stop/target/sector
    // for HTF trades that were created before the auto-fill flow (pre-2026-
    // 05-21). peekLatestScan() returns the cached snapshot without triggering
    // a new scan — fast, no FMP traffic, may be null if no scan has ever run.
    const latest = peekLatestScan();
    const scanBySymbol = new Map<string, NonNullable<typeof latest>["rows"][number]>();
    for (const r of latest?.rows ?? []) scanBySymbol.set(r.symbol.toUpperCase(), r);

    // Filter to HTF-strategy open positions. Any trade Chris tagged as HTF
    // counts toward the cap — stocks, calls, spreads, whatever.
    const open: OpenPosition[] = all
      .filter(r =>
        r.closeDate === null &&
        r.strategy === "htf"
      )
      .map(r => {
        const data = (r.strategyData ?? {}) as any;
        const scan = scanBySymbol.get(r.symbol.toUpperCase());
        // openPrice is stored signed (negative for debit/buy). Display +
        // risk math want the absolute fill price.
        const entryPrice = Math.abs(r.openPrice);
        // Real stop — from strategyData first, else the live scan's
        // flag-low-derived stop. NEVER fall back to `r.target` (it's the
        // profit-ROI math, not a stop).
        const stopPrice =
          typeof data.stopPrice === "number" ? data.stopPrice
          : scan?.stopPrice ?? null;
        // Real target — strategyData → scan target → null.
        const targetPrice =
          typeof data.targetPrice === "number" ? data.targetPrice
          : scan?.targetPrice ?? null;
        const sector =
          typeof data.sector === "string" ? data.sector
          : scan?.sector ?? "Unknown";
        return {
          symbol: r.symbol,
          sector,
          shares: r.contractsShares,
          entryPrice,
          stopPrice,
          targetPrice,
          entryDate: r.tradeDate,
          currentPrice: r.currentPrice ?? undefined,
        };
      });
    return new PortfolioState(open);
  } catch {
    return new PortfolioState();
  }
}

export function mountRoutes(app: Express): void {
  // ─── Read live setups ─────────────────────────────────────────────────
  // The scanner is live: there's one in-memory snapshot of what's firing
  // right now. If the cache is fresh, return it. If stale or missing, run
  // a fresh scan first. Sizing + actionable status are recomputed live
  // against the current config + portfolio so Config edits propagate
  // without a re-scan.
  app.get("/api/htf/setups", requireAuth, async (req: Request, res: Response) => {
    const userId = getUserId(req, res);
    if (!userId) return;
    try {
      const minScore = req.query.minScore ? Number(req.query.minScore) : undefined;
      const symbol = typeof req.query.symbol === "string" ? req.query.symbol : undefined;
      const actionableOnly = req.query.actionableOnly === "true";
      const forceRefresh = req.query.refresh === "true";
      const stage =
        req.query.stage === "fired" || req.query.stage === "forming"
          ? (req.query.stage as "fired" | "forming")
          : undefined;
      const config = await loadAccountConfig(userId);
      const portfolio = await loadPortfolio(userId);
      const result = await htfScannerData.getSetups({
        minScore,
        symbol,
        actionableOnly,
        forceRefresh,
        stage,
        config,
        portfolio,
      });
      res.json({
        scannedAt: result.scannedAt,
        durationMs: result.durationMs,
        universeSize: result.universeSize,
        rows: result.rows,
      });
    } catch (err: any) {
      console.error("[htf] GET /setups failed:", err?.message || err);
      res.status(500).json({ error: "scan_read_failed", message: String(err?.message || err) });
    }
  });

  app.get("/api/htf/setups/filtered", requireAuth, async (req: Request, res: Response) => {
    const userId = getUserId(req, res);
    if (!userId) return;
    try {
      const config = await loadAccountConfig(userId);
      const portfolio = await loadPortfolio(userId);
      const all = await htfScannerData.getSetups({ config, portfolio });
      const filtered = all.rows.filter(r => !r.actionable);
      res.json({
        scannedAt: all.scannedAt,
        durationMs: all.durationMs,
        universeSize: all.universeSize,
        rows: filtered,
      });
    } catch (err: any) {
      console.error("[htf] GET /setups/filtered failed:", err?.message || err);
      res.status(500).json({ error: "scan_read_failed", message: String(err?.message || err) });
    }
  });

  // ─── Portfolio ────────────────────────────────────────────────────────
  app.get("/api/htf/portfolio", requireAuth, async (req: Request, res: Response) => {
    const userId = getUserId(req, res);
    if (!userId) return;
    try {
      const config = await loadAccountConfig(userId);
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
    res.json(await loadAccountConfig(userId));
  });

  app.put("/api/htf/config", requireAuth, async (req: Request, res: Response) => {
    const userId = getUserId(req, res);
    if (!userId) return;
    try {
      const body = req.body as Partial<AccountConfig>;
      const merged: AccountConfig = { ...(await loadAccountConfig(userId)), ...body };
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
      // Persist through the canonical storage layer. updateAccountSettings
      // already has a migration-lag fallback: if `htf_config` isn't in the
      // DB yet, the field is dropped from the update silently and the user
      // sees the merged value in the response (read-from-DB returns
      // pre-merge until they run db:push). Doc'd in storage.ts.
      await storage.updateAccountSettings(userId, { htfConfig: merged } as any);
      res.json(merged);
    } catch (err: any) {
      console.error("[htf] PUT /config failed:", err?.message || err);
      res.status(500).json({ error: "config_write_failed", message: String(err?.message || err) });
    }
  });

  // ─── Force a fresh scan ───────────────────────────────────────────────
  // Bypasses the 30-min memory cache. Returns the live row count + timing.
  app.post("/api/htf/scan/run", requireAuth, async (req: Request, res: Response) => {
    const userId = getUserId(req, res);
    if (!userId) return;
    try {
      const config = await loadAccountConfig(userId);
      const portfolio = await loadPortfolio(userId);
      const forceRefresh = req.body?.forceRefresh === true;
      const minScore = typeof req.body?.minScore === "number" ? req.body.minScore : 0;
      const result = await runHtfScan({ config, portfolio, forceRefresh, minScore });
      res.json({
        scannedAt: result.scannedAt,
        durationMs: result.durationMs,
        universeSize: result.universeSize,
        scanned: result.scanned,
        hits: result.rows.length,
        actionable: result.rows.filter(r => r.actionable).length,
        errors: result.errors,
      });
    } catch (err: any) {
      console.error("[htf] POST /scan/run failed:", err?.message || err);
      res.status(500).json({ error: "scan_run_failed", message: String(err?.message || err) });
    }
  });

  // ─── Metals & mining watch (full complex, any price) ──────────────────
  // Separate HTF scan over the whole mining sector with NO price cap. Same
  // detector + sizing as /htf; different universe. Read serves the cached
  // snapshot (or scans if stale); ?refresh=true forces a fresh scan.
  app.get("/api/htf/metals-watch", requireAuth, async (req: Request, res: Response) => {
    const userId = getUserId(req, res);
    if (!userId) return;
    try {
      const config = await loadAccountConfig(userId);
      const portfolio = await loadPortfolio(userId);
      const forceRefresh = req.query.refresh === "true";
      const scan = forceRefresh
        ? await htfScannerData.runMetalsWatch({ config, portfolio })
        : await htfScannerData.getMetalsWatch({ config, portfolio });
      res.json({
        scannedAt: scan.scannedAt,
        durationMs: scan.durationMs,
        universeSize: scan.universeSize,
        rows: scan.rows,
      });
    } catch (err: any) {
      console.error("[htf] GET /metals-watch failed:", err?.message || err);
      res.status(500).json({ error: "metals_watch_read_failed", message: String(err?.message || err) });
    }
  });

  app.post("/api/htf/metals-watch/run", requireAuth, async (req: Request, res: Response) => {
    const userId = getUserId(req, res);
    if (!userId) return;
    try {
      const config = await loadAccountConfig(userId);
      const portfolio = await loadPortfolio(userId);
      const minScore = typeof req.body?.minScore === "number" ? req.body.minScore : 0;
      const result = await htfScannerData.runMetalsWatch({ config, portfolio, minScore });
      res.json({
        scannedAt: result.scannedAt,
        durationMs: result.durationMs,
        universeSize: result.universeSize,
        scanned: result.scanned,
        hits: result.rows.length,
        actionable: result.rows.filter(r => r.actionable).length,
        errors: result.errors,
      });
    } catch (err: any) {
      console.error("[htf] POST /metals-watch/run failed:", err?.message || err);
      res.status(500).json({ error: "metals_watch_run_failed", message: String(err?.message || err) });
    }
  });

  // ─── Position-size recommendation (Phase 1/2/3) ───────────────────────
  // Reads the user's cumulative HTF realized P&L from the trades table,
  // returns the recommended position size + capital + maxPositionPct based
  // on the Phase 1/2/3 plan. The /htf Config tab shows this as a card and
  // can apply it with one click. See sizing.ts for the phase rationale.
  app.get("/api/htf/sizing-recommendation", requireAuth, async (req: Request, res: Response) => {
    const userId = getUserId(req, res);
    if (!userId) return;
    try {
      const allTrades = await storage.getAllTrades(userId);
      // HTF realized P&L = sum of closed-trade profit for trades tagged
      // strategy='htf' AND closed. Open positions don't count toward the
      // buffer (paper gains aren't drawdown protection).
      const htfRealized = allTrades
        .filter(t => t.strategy === "htf" && t.closeDate !== null)
        .reduce((sum, t) => sum + computeClosedTradeProfit(t), 0);
      const settings = await storage.getAccountSettings(userId);
      const recommendation = computeSizingRecommendation(
        htfRealized,
        settings.startingAccountValue,
      );
      res.json({
        ...recommendation,
        startingCapital: settings.startingAccountValue,
        phases: SIZING_PHASES,
      });
    } catch (err: any) {
      console.error("[htf] GET /sizing-recommendation failed:", err?.message || err);
      res.status(500).json({ error: "sizing_recommendation_failed" });
    }
  });

  // ─── Cache stats (diagnostic) ─────────────────────────────────────────
  app.get("/api/htf/cache/stats", requireAuth, async (req: Request, res: Response) => {
    if (!getUserId(req, res)) return;
    res.json(htfCacheStats());
  });

  // ─── Derive HTF snapshot from history ─────────────────────────────────
  // Solves the "row shows all —" problem on Current Positions: if an HTF
  // trade's strategyData is empty AND the symbol is no longer in the live
  // (1-day) scan, we can still re-derive the original setup by running
  // scanHtf on the full ~1-year cached bar history. The detector is
  // deterministic; if the breakout happened in the last year, it's found.
  //
  // Returns the NEWEST detected HTF setup's snapshot fields, or {hit:null}.
  // Callers persist this to the trade row via PATCH /api/trades/:id so the
  // backfill is one-time per trade.
  app.get("/api/htf/derive/:symbol", requireAuth, async (req: Request, res: Response) => {
    if (!getUserId(req, res)) return;
    try {
      const symbol = String(req.params.symbol || "").toUpperCase();
      if (!symbol) {
        res.status(400).json({ error: "symbol_required" });
        return;
      }
      const bars = await getHtfBars(symbol);
      if (bars.length === 0) {
        res.json({ symbol, hit: null, reason: "no_bars" });
        return;
      }
      const hits = scanHtf(bars, symbol);
      const newest = hits[0] ?? null;
      if (!newest) {
        res.json({ symbol, hit: null, reason: "no_htf_detection" });
        return;
      }
      // Mirror the shape the client already merges into strategyData.
      res.json({
        symbol,
        hit: {
          stopPrice: newest.stopPrice,
          targetPrice: newest.targetPrice,
          breakoutPrice: newest.breakoutPrice,
          breakoutDate: newest.breakoutDate.toISOString().slice(0, 10),
          qualityScore: newest.qualityScore,
          poleGainPct: newest.extras.poleGainPct,
          poleDays: newest.extras.poleDays,
          flagDays: newest.extras.flagDays,
          flagPullbackPct: newest.extras.flagPullbackPct,
          flagHigh: newest.extras.flagHigh,
          flagLow: newest.extras.flagLow,
          breakoutVolRatio: newest.extras.breakoutVolRatio,
          hasOverheadResistance: newest.extras.hasOverheadResistance,
          nearestResistancePct: newest.extras.nearestResistancePct,
          // Sector isn't computed by scanHtf — it lives in the universe row
          // and isn't carried into HtfHit. Leave undefined; trade row keeps
          // existing sector if any, else "Unknown".
        },
      });
    } catch (err: any) {
      console.error("[htf] GET /derive/:symbol failed:", err?.message || err);
      res.status(500).json({ error: "derive_failed", message: String(err?.message || err) });
    }
  });

  // ─── Pattern chart data ───────────────────────────────────────────────
  // Returns the last ~120 bars + the newest HTF hit's full annotation so
  // the frontend can draw pole/flag windows, breakout level, target/stop
  // lines, and the 20-MA trail line in one fetch.
  app.get("/api/htf/chart/:symbol", requireAuth, async (req: Request, res: Response) => {
    if (!getUserId(req, res)) return;
    try {
      const symbol = String(req.params.symbol || "").toUpperCase();
      if (!symbol) {
        res.status(400).json({ error: "symbol_required" });
        return;
      }
      const allBars = await getHtfBars(symbol);
      if (allBars.length === 0) {
        res.status(404).json({ error: "no_bars" });
        return;
      }
      const hits = scanHtf(allBars, symbol);
      const newest = hits[0] ?? null;

      // Window the bars to ~120 days for chart readability — extend back to
      // include the pole start when the pole is older than the default window.
      const WINDOW_BARS = 120;
      let sliceStart = Math.max(0, allBars.length - WINDOW_BARS);
      if (newest) {
        for (let i = 0; i < allBars.length; i++) {
          if (allBars[i].t.getTime() === newest.patternStart.getTime()) {
            sliceStart = Math.max(0, i - 5); // a few bars of context before pole start
            break;
          }
        }
      }
      const windowBars = allBars.slice(sliceStart);

      // 20-bar SMA — Givens' trailing-stop reference, also the canonical
      // moving average drawn on the chart.
      const closes = windowBars.map(b => b.c);
      const sma20: Array<number | null> = new Array(closes.length).fill(null);
      let sum = 0;
      for (let i = 0; i < closes.length; i++) {
        sum += closes[i];
        if (i >= 20) sum -= closes[i - 20];
        if (i >= 19) sma20[i] = sum / 20;
      }

      const bars = windowBars.map((b, i) => ({
        date: b.t.toISOString().slice(0, 10),
        open: b.o,
        high: b.h,
        low: b.l,
        close: b.c,
        volume: b.v,
        sma20: sma20[i] ?? undefined,
      }));

      const annotation = newest
        ? {
            poleStartDate: newest.patternStart.toISOString().slice(0, 10),
            poleStartPrice: newest.extras.poleStartPrice,
            poleEndPrice: newest.extras.poleEndPrice,
            poleGainPct: newest.extras.poleGainPct,
            poleDays: newest.extras.poleDays,
            flagStartDate: (() => {
              // Flag begins flagDays bars before the breakout bar (inclusive).
              const breakoutIdx = windowBars.findIndex(
                b => b.t.getTime() === newest.breakoutDate.getTime(),
              );
              const flagStartIdx = breakoutIdx >= 0
                ? Math.max(0, breakoutIdx - newest.extras.flagDays)
                : -1;
              return flagStartIdx >= 0
                ? windowBars[flagStartIdx].t.toISOString().slice(0, 10)
                : null;
            })(),
            flagDays: newest.extras.flagDays,
            flagHigh: newest.extras.flagHigh,
            flagLow: newest.extras.flagLow,
            flagPullbackPct: newest.extras.flagPullbackPct,
            breakoutDate: newest.breakoutDate.toISOString().slice(0, 10),
            breakoutPrice: newest.breakoutPrice,
            breakoutVolRatio: newest.extras.breakoutVolRatio,
            targetPrice: newest.targetPrice,
            stopPrice: newest.stopPrice,
            qualityScore: newest.qualityScore,
          }
        : null;

      res.json({ symbol, bars, annotation });
    } catch (err: any) {
      console.error("[htf] GET /chart failed:", err?.message || err);
      res.status(500).json({ error: "chart_fetch_failed", message: String(err?.message || err) });
    }
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
