/**
 * Request context middleware — Phase 2.2.
 *
 * - Generates a request ID (X-Request-Id header or UUID v4 fallback)
 * - Attaches `req.id` and `req.log` (a pino child logger scoped to this request)
 * - Sets X-Request-Id on the response so clients can correlate errors with logs
 * - Logs a single structured line per completed request with method/path/status/duration_ms
 */
import { randomUUID } from "crypto";
import type { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger";

declare global {
  namespace Express {
    interface Request {
      id?: string;
      log?: ReturnType<typeof logger.child>;
      _startTime?: number;
    }
  }
}

export function requestContext(req: Request, res: Response, next: NextFunction) {
  const incoming = (req.headers["x-request-id"] as string | undefined)?.trim();
  const id = incoming && incoming.length <= 64 ? incoming : randomUUID();
  req.id = id;
  req.log = logger.child({ req_id: id });
  req._startTime = Date.now();
  res.setHeader("X-Request-Id", id);

  // Only log /api requests — static assets are noise.
  if (req.path.startsWith("/api")) {
    res.on("finish", () => {
      const duration_ms = Date.now() - (req._startTime || Date.now());
      const level =
        res.statusCode >= 500 ? "error" :
        res.statusCode >= 400 ? "warn" :
        "info";
      req.log?.[level]({
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration_ms,
      }, `${req.method} ${req.path} ${res.statusCode}`);
    });
  }

  next();
}
