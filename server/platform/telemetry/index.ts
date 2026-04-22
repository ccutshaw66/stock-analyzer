/**
 * Structured logging + error capture + metrics.
 * Wraps pino (logs) and Sentry (errors). Swap underlying libs without touching callers.
 */
export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

// TODO: replace console with pino(config). Add Sentry init here.
export const log: Logger = {
  debug: (m, meta) => console.debug(m, meta ?? ""),
  info:  (m, meta) => console.info(m, meta ?? ""),
  warn:  (m, meta) => console.warn(m, meta ?? ""),
  error: (m, meta) => console.error(m, meta ?? ""),
};

export function captureException(err: unknown, context?: Record<string, unknown>): void {
  // TODO: Sentry.captureException(err, { extra: context });
  log.error("exception", { err: String(err), ...context });
}
