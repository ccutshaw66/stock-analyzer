/**
 * Position News routes — headlines + press releases scoped to held tickers.
 *
 * Chris's rule (memory/feedback): "don't want traders to trade the news."
 * This endpoint only returns articles on symbols the user already owns —
 * it's situational awareness, not a discovery scanner.
 */
import type { Express, Request, Response } from "express";
import { requireAuth } from "../auth";
import { storage } from "../storage";
import type { Trade } from "@shared/schema";
import { getNewsForPositions, type NewsItem } from "../data/providers/news.adapter";

export interface PositionNewsResponse {
  items: NewsItem[];
  heldTickers: string[];
  generatedAt: string;
}

export function registerPositionNewsRoute(app: Express): void {
  app.get(
    "/api/dashboard/news-for-positions",
    requireAuth,
    async (req: Request, res: Response) => {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: "unauthenticated" });
      try {
        const lookbackHours = Math.min(
          Math.max(Number(req.query.lookbackHours) || 24, 1),
          168, // cap at 7 days
        );
        const trades = (await storage.getAllTrades(userId)) as Trade[];
        const open = trades.filter(t => !t.closeDate);
        const heldTickers = Array.from(
          new Set(open.map(t => String(t.symbol).toUpperCase())),
        );
        const items = await getNewsForPositions(heldTickers, { lookbackHours });
        res.json({
          items,
          heldTickers,
          generatedAt: new Date().toISOString(),
        } satisfies PositionNewsResponse);
      } catch (err: any) {
        console.error("[dashboard] news-for-positions failed:", err?.message || err);
        res.status(500).json({
          error: "news_for_positions_failed",
          message: String(err?.message || err),
        });
      }
    },
  );
}
