/**
 * Central config loader. Reads from process.env.
 *
 * Rules:
 *   - Never reference process.env outside this file.
 *   - Throw hard on missing required vars in non-test envs.
 *   - Keep sample values in .env.example (no real secrets).
 */
import "dotenv/config";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function optional(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export const config = {
  env: optional("NODE_ENV", "development") as "development" | "staging" | "production" | "test",
  port: Number(optional("PORT", "3000")),

  db: {
    url: required("DATABASE_URL"),
  },

  polygon: {
    apiKey: required("POLYGON_API_KEY"),
    baseUrl: optional("POLYGON_BASE_URL", "https://api.polygon.io"),
  },

  fmp: {
    apiKey: optional("FMP_API_KEY"),
    baseUrl: optional("FMP_BASE_URL", "https://financialmodelingprep.com/api"),
  },

  stripe: {
    secretKey: required("STRIPE_SECRET_KEY"),
    webhookSecret: required("STRIPE_WEBHOOK_SECRET"),
  },

  alerts: {
    emailFrom: optional("ALERTS_EMAIL_FROM", "alerts@stockotter.ai"),
    sendgridApiKey: optional("SENDGRID_API_KEY"),
  },

  sentry: {
    dsn: optional("SENTRY_DSN"),
  },
} as const;
