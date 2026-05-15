/**
 * Dashboard layout routes — load + save the per-user JSONB blob.
 *
 * Auth-gated: relies on `req.user` from the existing `requireAuth` middleware
 * which runs on `/api/*` routes (see server/auth.ts).
 */
import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { buildDefaultDashboardLayout } from "./layout";

export function registerDashboardRoutes(app: Express): void {
  // Get the current user's dashboard layout. Returns the saved layout if
  // one exists, otherwise the server-computed default. Never 404s — the
  // client always has something to render.
  app.get("/api/dashboard/layout", async (req: Request, res: Response) => {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    try {
      const row = await storage.getDashboardLayout(userId);
      if (row) {
        res.json(row.data);
        return;
      }
      res.json(buildDefaultDashboardLayout());
    } catch (err: any) {
      console.error("[dashboard] GET layout failed:", err?.message || err);
      // Defensive: if the table doesn't exist yet (db:push not run), still
      // return a usable default so the page renders.
      res.json(buildDefaultDashboardLayout());
    }
  });

  // Save the current user's dashboard layout (full-document PATCH).
  // Validation of the body shape is intentionally light here — the layout
  // is a JSONB blob owned by the user. Future rounds can tighten with Zod.
  app.patch("/api/dashboard/layout", async (req: Request, res: Response) => {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    const data = req.body;
    if (!data || typeof data !== "object") {
      res.status(400).json({ error: "body must be a layout object" });
      return;
    }
    try {
      const row = await storage.saveDashboardLayout(userId, data);
      res.json(row.data);
    } catch (err: any) {
      console.error("[dashboard] PATCH layout failed:", err?.message || err);
      res.status(500).json({ error: err?.message || "save_failed" });
    }
  });
}
