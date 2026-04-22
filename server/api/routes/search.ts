/**
 * /api/search/v2 — ticker search via the data facade.
 *
 * v2 suffix so the legacy /api/search (direct Polygon call) stays alive
 * during strangler migration. Frontend can cut over at its own pace.
 */
import type { Express, Request, Response } from "express";
import { searchTickers } from "../../features/search";

export function registerSearchRoutes(app: Express): void {
  app.get("/api/search/v2", async (req: Request, res: Response) => {
    const q = (req.query.q as string | undefined) ?? "";
    const limitRaw = req.query.limit as string | undefined;
    const limit = limitRaw ? parseInt(limitRaw, 10) : 10;

    try {
      const results = await searchTickers(q, Number.isNaN(limit) ? 10 : limit);
      res.json(results);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "search_failed";
      // Match legacy behavior: soft-fail returns empty array, log server-side.
      console.warn(`[api/search/v2] "${q}" → ${msg}`);
      res.json([]);
    }
  });
}
