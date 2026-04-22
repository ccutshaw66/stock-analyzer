/**
 * Admin endpoint for inspecting and manually triggering scheduled jobs.
 * Mounted after auth (requireAuth) in the main app.
 *
 * Routes:
 *   GET  /api/admin/jobs            -> list of all jobs + last run info
 *   POST /api/admin/jobs/:id/run    -> trigger a job immediately
 *
 * Authorization: requires an authenticated admin user. We check the role
 * loosely (isAdmin on req.user) to stay compatible with the current codebase.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { listJobStatus, runJobNow } from "../../platform/jobs/scheduler";

// Match the rest of the codebase's admin check (email allowlist)
const ADMIN_EMAILS = new Set([
  "awisper@me.com",
  "christopher.cutshaw@gmail.com",
  "admin@stockotter.ai",
]);

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user;
  if (!user) return res.status(401).json({ error: "not authenticated" });
  const email = String(user.email || "").toLowerCase();
  if (!ADMIN_EMAILS.has(email) && !user.isAdmin && user.role !== "admin") {
    return res.status(403).json({ error: "admin only" });
  }
  next();
}

export const jobsAdminRouter = Router();

jobsAdminRouter.get("/admin/jobs", requireAdmin, (_req, res) => {
  res.json({ jobs: listJobStatus() });
});

jobsAdminRouter.post("/admin/jobs/:id/run", requireAdmin, async (req, res) => {
  const result = await runJobNow(req.params.id);
  if ((result as any).error === "not-found") {
    return res.status(404).json({ error: "job not found" });
  }
  res.json(result);
});
