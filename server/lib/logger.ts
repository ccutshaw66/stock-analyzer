/**
 * Structured logger — Phase 2.2.
 *
 * Uses pino. JSON in production, pretty-printed in development.
 *
 * Log levels:
 *   - trace/debug: verbose diagnostics (off by default)
 *   - info: normal request flow, deploys, scheduled job starts
 *   - warn: non-fatal anomalies (429 retries, stale cache hits, etc.)
 *   - error: exceptions, failed requests, broken integrations
 *
 * Redaction: authorization, cookie, and any field named "secret" or "password"
 * is automatically redacted.
 */
import pino from "pino";

const isDev = process.env.NODE_ENV !== "production";
const logLevel = process.env.LOG_LEVEL || (isDev ? "debug" : "info");

export const logger = pino({
  level: logLevel,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-hub-signature-256"]',
      'req.headers["x-deploy-token"]',
      '*.password',
      '*.token',
      '*.secret',
      '*.apiKey',
    ],
    remove: true,
  },
  base: {
    service: "stock-analyzer",
    env: process.env.NODE_ENV || "development",
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  // Pretty-print only when stdout is a TTY and we're in development.
  // In production (pm2) logs are JSON so they can be shipped to any backend.
  transport: isDev && process.stdout.isTTY
    ? {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "HH:MM:ss.l",
          ignore: "pid,hostname,service,env",
        },
      }
    : undefined,
});

/**
 * Short-lived child logger attached to a request. Includes req_id for
 * correlation across log lines.
 */
export function requestLogger(req_id: string) {
  return logger.child({ req_id });
}
