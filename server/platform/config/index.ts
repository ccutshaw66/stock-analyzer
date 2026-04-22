/**
 * Central config loader. Reads from process.env exactly once at boot.
 *
 * Rules:
 *   - Never reference process.env outside this file.
 *   - Throw hard on missing required vars in non-test envs.
 *   - Keep sample values in .env.example (no real secrets).
 *
 * Usage:
 *   import { config } from "@platform/config";
 *   const key = config.polygon.apiKey;
 */
import "dotenv/config";

type Env = "development" | "staging" | "production" | "test";

const NODE_ENV: Env = (process.env.NODE_ENV as Env) || "development";
const IS_TEST = NODE_ENV === "test";

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    // In test environments, we don't want config loading to blow up test
    // bootstrap. Return an empty string; any real usage will fail loudly
    // the moment it tries to make a request.
    if (IS_TEST) return "";
    throw new Error(`[config] Missing required env var: ${name}`);
  }
  return v;
}

function optional(name: string, fallback = ""): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

function optionalNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (Number.isNaN(n)) {
    throw new Error(`[config] Env var ${name} must be a number, got "${raw}"`);
  }
  return n;
}

export const config = {
  env: NODE_ENV,
  isProd: NODE_ENV === "production",
  isDev: NODE_ENV === "development",
  isTest: IS_TEST,

  port: optionalNumber("PORT", 5000),
  appBaseUrl: optional("APP_BASE_URL", optional("APP_URL", "http://localhost:5000")),

  db: {
    url: required("DATABASE_URL"),
  },

  auth: {
    jwtSecret: required("JWT_SECRET"),
  },

  deploy: {
    webhookSecret: optional("DEPLOY_WEBHOOK_SECRET"),
  },

  // ─── Data providers ──────────────────────────────────────────────────────
  polygon: {
    apiKey: required("POLYGON_API_KEY"),
    baseUrl: optional("POLYGON_BASE_URL", "https://api.polygon.io"),
  },

  fmp: {
    apiKey: optional("FMP_API_KEY"),
    baseUrl: optional("FMP_BASE_URL", "https://financialmodelingprep.com/api"),
  },

  // ─── Billing ─────────────────────────────────────────────────────────────
  stripe: {
    secretKey: optional("STRIPE_SECRET_KEY"),
    webhookSecret: optional("STRIPE_WEBHOOK_SECRET"),
    priceIdPro: optional("STRIPE_PRO_PRICE_ID"),
    priceIdElite: optional("STRIPE_ELITE_PRICE_ID"),
  },

  // ─── Mail ────────────────────────────────────────────────────────────────
  smtp: {
    host: optional("SMTP_HOST"),
    port: optionalNumber("SMTP_PORT", 587),
    user: optional("SMTP_USER"),
    pass: optional("SMTP_PASS"),
    from: optional("SMTP_FROM", "alerts@stockotter.ai"),
  },

  // ─── Telemetry (Phase 2) ─────────────────────────────────────────────────
  sentry: {
    dsn: optional("SENTRY_DSN"),
  },
} as const;

/**
 * Call once at server boot. Throws immediately if required vars are missing.
 * Prefer explicit boot-time validation over lazy errors mid-request.
 */
export function assertConfigLoaded(): void {
  // Accessing the frozen object is enough to trigger the required() calls
  // during module evaluation. This function exists so main() can opt-in
  // to an explicit, logged boot check:
  //   console.log(`[config] env=${config.env} port=${config.port}`);
  void config;
}

export type AppConfig = typeof config;
