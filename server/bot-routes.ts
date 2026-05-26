/**
 * Bot-callable routes — for internal-only services that need stockotter
 * data without simulating a cookie-authenticated browser session.
 *
 * Mounted in `routes.ts` BEFORE the global `/api` cookie-auth wall.
 * Every route here MUST verify a shared secret (`X-Bot-Key` header) via
 * `requireBotKey` before serving data. Auth is by env var
 * `BOT_API_KEY`. Bots run on the internal LAN so this isn't the only
 * line of defense, but it's the one that lives in the codebase.
 *
 * The KAIROS bot (python/kairos/) is the first consumer. Future internal
 * bots can add endpoints here following the same pattern.
 */
import type { Express, Request, Response, NextFunction } from "express";
import { htfScannerData } from "./compartments/htf-scanner";
import { DEFAULT_ACCOUNT_CONFIG, PortfolioState } from "./signals/risk/position-sizing";

const HEADER_NAME = "x-bot-key";
const MAX_WATCHLIST_DEFAULT = 25;

function requireBotKey(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.BOT_API_KEY;
  if (!expected) {
    // No key configured → endpoint is effectively disabled. Fail closed.
    res.status(503).json({ error: "bot_auth_not_configured" });
    return;
  }
  const provided = req.headers[HEADER_NAME];
  if (typeof provided !== "string" || provided !== expected) {
    res.status(401).json({ error: "invalid_bot_key" });
    return;
  }
  next();
}

export function mountBotRoutes(app: Express): void {
  if (!process.env.BOT_API_KEY) {
    console.log("[bot-routes] BOT_API_KEY not set — /api/bot/* endpoints will return 503");
  } else {
    console.log("[bot-routes] /api/bot/* endpoints active (X-Bot-Key auth)");
  }

  // GET /api/bot/htf-watchlist
  //   Query: ?limit=N (default 25), ?minScore=N (default 70)
  //   Returns the top N actionable HTF setups from the live scanner cache.
  //   Bot calls this hourly to refresh its watchlist.
  app.get("/api/bot/htf-watchlist", requireBotKey, async (req: Request, res: Response) => {
    try {
      const limit = clampInt(req.query.limit, 1, 200, MAX_WATCHLIST_DEFAULT);
      const minScore = clampInt(req.query.minScore, 0, 100, 70);

      // Bot has no user context — use defaults so the scan runs against the
      // universe without user-specific portfolio caps filtering things out.
      const config = { ...DEFAULT_ACCOUNT_CONFIG };
      const portfolio = new PortfolioState();

      const result = await htfScannerData.getSetups({
        actionableOnly: true,
        minScore,
        config,
        portfolio,
      });

      const symbols = result.rows.slice(0, limit).map(r => ({
        ticker: r.symbol,
        qualityScore: r.qualityScore,
        breakoutPrice: r.breakoutPrice,
        targetPrice: r.targetPrice,
        stopPrice: r.stopPrice,
        stage: r.pattern === "HTF_Givens_Forming" ? "forming" : "fired",
        breakoutDate: typeof r.breakoutDate === "string"
          ? r.breakoutDate
          : new Date(r.breakoutDate as any).toISOString(),
      }));

      res.json({
        scanned_at: result.scannedAt,
        universe_size: result.universeSize,
        count: symbols.length,
        symbols,
      });
    } catch (err: any) {
      console.error("[bot-routes] htf-watchlist failed:", err?.message || err);
      res.status(500).json({ error: "watchlist_read_failed", message: String(err?.message || err) });
    }
  });
}

function clampInt(raw: unknown, min: number, max: number, dflt: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(min, Math.min(max, Math.floor(n)));
}
