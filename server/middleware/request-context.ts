/**
 * Request context middleware — Phase 2.2.
 *
 * - Generates / echoes an X-Request-Id header (UUID v4 fallback, 64-char cap)
 * - Attaches req.id and req.log (child logger scoped to this request)
 * - Emits one structured log line per completed /api request
 *
 * Express typings for req.id/req.log are intentionally loose (any) to avoid
 * fighting with the rest of the codebase's looser typing.
 */
import { randomUUID } from "crypto";
import type { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger";

export function requestContext(req: Request, res: Response, next: NextFunction) {
  try {
    const incomingRaw = req.headers["x-request-id"];
    const incoming = Array.isArray(incomingRaw) ? incomingRaw[0] : incomingRaw;
    const id =
      typeof incoming === "string" && incoming.length > 0 && incoming.length <= 64
        ? incoming
        : randomUUID();

    (req as any).id = id;
    (req as any).log = logger.child({ req_id: id });
    (req as any)._startTime = Date.now();
    res.setHeader("X-Request-Id", id);

    if (req.path.startsWith("/api")) {
      res.on("finish", () => {
        const duration_ms = Date.now() - ((req as any)._startTime || Date.now());
        const level: "error" | "warn" | "info" =
          res.statusCode >= 500 ? "error" :
          res.statusCode >= 400 ? "warn" :
          "info";
        try {
          (req as any).log?.[level]({
            method: req.method,
            path: req.path,
            status: res.statusCode,
            duration_ms,
          }, `${req.method} ${req.path} ${res.statusCode}`);
        } catch {
          /* never let logging break a request */
        }
      });
    }
  } catch (e) {
    // Never block the request because of logging init failure
    try { console.error("[request-context] middleware error:", e); } catch {}
  }
  next();
}
