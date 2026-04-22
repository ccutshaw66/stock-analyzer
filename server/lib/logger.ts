/**
 * Structured logger — Phase 2.2.
 *
 * Uses pino (raw — no pretty/http sidecar packages).
 * JSON output only. Pretty-printing for dev is intentionally skipped to avoid
 * pulling in pino-pretty's worker-thread transport, which didn't play well
 * with the esbuild externals setup (caused a 502 on first attempt).
 *
 * Sensitive fields (authorization, cookie, secret, password, token, apiKey)
 * are auto-redacted and removed from output.
 *
 * Log level is controlled by LOG_LEVEL env var, defaulting to "info".
 *
 * Fallback: if pino fails to initialize for any reason, we fall back to a
 * console-based shim. This prevents the whole app from crashing just because
 * structured logging is misbehaving.
 */

type LogFn = (obj: Record<string, any> | string, msg?: string) => void;

interface Logger {
  trace: LogFn;
  debug: LogFn;
  info: LogFn;
  warn: LogFn;
  error: LogFn;
  fatal: LogFn;
  child: (bindings: Record<string, any>) => Logger;
}

function makeConsoleShim(bindings: Record<string, any> = {}): Logger {
  const emit = (level: string) => (obj: any, msg?: string) => {
    const payload = typeof obj === "string"
      ? { msg: obj }
      : { ...obj, msg: msg ?? obj?.msg };
    try {
      console.log(JSON.stringify({
        level,
        time: new Date().toISOString(),
        service: "stock-analyzer",
        env: process.env.NODE_ENV || "development",
        ...bindings,
        ...payload,
      }));
    } catch {
      console.log(`[${level}]`, msg || obj);
    }
  };
  return {
    trace: emit("trace"),
    debug: emit("debug"),
    info: emit("info"),
    warn: emit("warn"),
    error: emit("error"),
    fatal: emit("fatal"),
    child: (b) => makeConsoleShim({ ...bindings, ...b }),
  };
}

let _logger: Logger;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pino = require("pino");
  const pinoInstance = pino({
    level: process.env.LOG_LEVEL || "info",
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
  });
  _logger = pinoInstance;
  pinoInstance.info({ startup: true }, "pino logger initialized");
} catch (e) {
  console.error("[logger] pino init failed, falling back to console shim:", e);
  _logger = makeConsoleShim();
  _logger.error({ startup: true, fallback: true }, "pino init failed, using shim");
}

export const logger: Logger = _logger;

/** Child logger attached to a single HTTP request for correlation. */
export function requestLogger(req_id: string): Logger {
  return logger.child({ req_id });
}
