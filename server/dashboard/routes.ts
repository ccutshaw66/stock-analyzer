/**
 * Dashboard layout routes — load + save the per-user JSONB blob.
 *
 * Auth-gated: relies on `req.user` from the existing `requireAuth` middleware
 * which runs on `/api/*` routes (see server/auth.ts).
 */
import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { requireAuth } from "../auth";
import { buildDefaultDashboardLayout } from "./layout";
import { registerActionQueueRoute } from "./action-queue";
import { registerMorningBriefRoute } from "./morning-brief";
import { registerPositionNewsRoute } from "./news-routes";
import { registerChecklistRoutes } from "./checklist-routes";
import { registerAskOtterRoutes } from "./ask-otter-routes";
import { registerPositionInsidersRoute, registerInsiderClustersRoute } from "./insider-routes";
import { registerInsiderRatioRoute } from "./insider-ratio";
import { registerForm4Routes } from "./form4-routes";

export function registerDashboardRoutes(app: Express): void {
  // Dashboard rebuild v1 routes — each compartment gets its own server module
  // (action-queue / morning-brief / news / checklist / ask-otter / insiders)
  // registered here so adding a new compartment is one import + one call.
  registerActionQueueRoute(app);
  registerMorningBriefRoute(app);
  registerPositionNewsRoute(app);
  registerChecklistRoutes(app);
  registerAskOtterRoutes(app);
  registerPositionInsidersRoute(app);
  registerInsiderClustersRoute(app);
  registerInsiderRatioRoute(app);
  registerForm4Routes(app);

  // Get the current user's dashboard layout. Returns the saved layout if
  // one exists, otherwise the server-computed default. Never 404s — the
  // client always has something to render.
  //
  // `requireAuth` applied per-route (not via app.use) because this module
  // is mounted at the top of `registerRoutes`, before the global
  // `app.use("/api", requireAuth)` at routes.ts:1590. Self-protecting
  // keeps the routes correct regardless of mount order.
  app.get("/api/dashboard/layout", requireAuth, async (req: Request, res: Response) => {
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

  // Reset the current user's dashboard layout — drops the saved row so the
  // next GET returns the server's default. Lets users opt back into a new
  // default after we ship a layout change (e.g. moving Ask Otter).
  app.delete("/api/dashboard/layout", requireAuth, async (req: Request, res: Response) => {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    try {
      await storage.deleteDashboardLayout(userId);
      res.json(buildDefaultDashboardLayout());
    } catch (err: any) {
      console.error("[dashboard] DELETE layout failed:", err?.message || err);
      res.status(500).json({ error: err?.message || "delete_failed" });
    }
  });

  // Save the current user's dashboard layout (full-document PATCH).
  // Validation of the body shape is intentionally light here — the layout
  // is a JSONB blob owned by the user. Future rounds can tighten with Zod.
  app.patch("/api/dashboard/layout", requireAuth, async (req: Request, res: Response) => {
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
