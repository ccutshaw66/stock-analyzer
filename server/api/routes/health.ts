/**
 * /health endpoint. Used by UptimeRobot / BetterUptime / Kubernetes.
 * Checks: DB connectivity, Polygon ping, Stripe ping.
 */
// import { Router } from "express";
// import { data } from "../../data";

// export const healthRouter = Router();
// healthRouter.get("/health", async (_req, res) => {
//   const checks = { db: false, polygon: false, stripe: false };
//   // TODO: fill checks
//   const ok = Object.values(checks).every(Boolean);
//   res.status(ok ? 200 : 503).json({ ok, checks, ts: new Date().toISOString() });
// });

export {};
