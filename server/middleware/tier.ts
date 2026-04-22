/**
 * Tier-based feature gating middleware + per-user rate limiter.
 *
 * Single source of truth for paid-tier checks. Before this module,
 * the gating factory, the daily usage counter, the rate limiter, and
 * the usage-snapshot logic all lived inline in routes.ts and were
 * partially duplicated in the status + admin endpoints.
 *
 * Exports:
 *   - getDailyUsage(userId)               — lazy per-day usage counter
 *   - checkFeatureAccess(feature)         — express middleware factory
 *   - checkScanRateLimit(req, res)        — inline rate limit helper
 *   - getUsageSnapshot(userId, tier)      — shared shape for /status and /admin/users
 *
 * The `dailyUsage` and `userScanTimestamps` maps live in-process and reset on
 * restart. That matches the previous behavior exactly.
 */

import type { NextFunction } from "express";
import { getUserTier, TIER_LIMITS, type SubscriptionTier } from "../stripe";
import { storage } from "../storage";

// ─── Daily Usage ───────────────────────────────────────────────────────────
export interface DailyUsageEntry {
  date: string;      // YYYY-MM-DD (UTC)
  scans: number;
  analysis: number;
}

const dailyUsage = new Map<number, DailyUsageEntry>();

export function getDailyUsage(userId: number): DailyUsageEntry {
  const today = new Date().toISOString().slice(0, 10);
  const existing = dailyUsage.get(userId);
  if (!existing || existing.date !== today) {
    const fresh: DailyUsageEntry = { date: today, scans: 0, analysis: 0 };
    dailyUsage.set(userId, fresh);
    return fresh;
  }
  return existing;
}

// ─── Feature Gating Middleware ─────────────────────────────────────────────
export type GatedFeature = "mmExposure" | "scansPerDay" | "analysisPerDay" | "tradeLimit";

/**
 * Express middleware factory. Gates access to `feature` based on the user's
 * tier and (where applicable) their current daily usage. On block, responds
 * 403 with a structured upgrade prompt. On transient error, logs and lets the
 * request through (preserves legacy behavior).
 */
export function checkFeatureAccess(feature: GatedFeature) {
  // Intentionally typed `any` for req/res so downstream handlers keep their
  // pre-middleware request typing (route-local narrowing of req.params etc).
  return async (req: any, res: any, next: NextFunction) => {
    try {
      const userId = (req as any).user?.id as number | undefined;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const tier = await getUserTier(userId);
      const limits = TIER_LIMITS[tier];

      if (feature === "mmExposure") {
        if (!limits.mmExposure) {
          return res.status(403).json({
            error: "Upgrade to Pro to access MM Exposure",
            tier,
            upgradeUrl: "/api/subscription/checkout",
          });
        }
        return next();
      }

      if (feature === "scansPerDay") {
        const usage = getDailyUsage(userId);
        if (usage.scans >= limits.scansPerDay) {
          return res.status(403).json({
            error: `Daily scan limit reached (${limits.scansPerDay} scans/day on ${tier} plan). Upgrade for more.`,
            tier,
            upgradeUrl: "/api/subscription/checkout",
            limit: limits.scansPerDay,
            used: usage.scans,
          });
        }
        usage.scans++;
        return next();
      }

      if (feature === "analysisPerDay") {
        const usage = getDailyUsage(userId);
        if (usage.analysis >= limits.analysisPerDay) {
          return res.status(403).json({
            error: `Daily analysis limit reached (${limits.analysisPerDay} analyses/day on ${tier} plan). Upgrade for more.`,
            tier,
            upgradeUrl: "/api/subscription/checkout",
            limit: limits.analysisPerDay,
            used: usage.analysis,
          });
        }
        usage.analysis++;
        return next();
      }

      if (feature === "tradeLimit") {
        const tradeCount = await storage.getUserTradeCount(userId);
        if (tradeCount >= limits.tradeLimit) {
          return res.status(403).json({
            error: `Trade limit reached (${limits.tradeLimit} trades on ${tier} plan). Upgrade to add more.`,
            tier,
            upgradeUrl: "/api/subscription/checkout",
            limit: limits.tradeLimit,
            used: tradeCount,
          });
        }
        return next();
      }

      return next();
    } catch (err: any) {
      console.error("[featureGate] Error:", err?.message);
      // Fail-open: do not block legitimate users on transient errors.
      return next();
    }
  };
}

// ─── Per-user Scan Rate Limiter ────────────────────────────────────────────
const MAX_SCANS_PER_MINUTE = 3;
const userScanTimestamps = new Map<number, number[]>();

/**
 * Inline rate-limit check for scan-heavy endpoints. Returns true if the
 * request was rate-limited (and a 429 has already been written), false if
 * the caller should continue.
 */
export function checkScanRateLimit(req: any, res: any): boolean {
  const userId = (req as any).user?.id as number | undefined;
  if (!userId) return false;
  const now = Date.now();
  const timestamps = userScanTimestamps.get(userId) || [];
  const recent = timestamps.filter((t) => now - t < 60_000);
  if (recent.length >= MAX_SCANS_PER_MINUTE) {
    res.status(429).json({
      error: `Rate limited — max ${MAX_SCANS_PER_MINUTE} scans per minute. Results are cached, try again in a moment.`,
    });
    return true;
  }
  recent.push(now);
  userScanTimestamps.set(userId, recent);
  return false;
}

// ─── Usage Snapshot (used by /subscription/status + /admin/users) ──────────
export interface UsageSnapshot {
  scansUsed: number;
  scansRemaining: number;
  scansLimit: number;
  analysisUsed: number;
  analysisRemaining: number;
  analysisLimit: number;
}

export function getUsageSnapshot(userId: number, tier: SubscriptionTier): UsageSnapshot {
  const limits = TIER_LIMITS[tier] || TIER_LIMITS.free;
  const usage = getDailyUsage(userId);
  return {
    scansUsed: usage.scans,
    scansRemaining: Math.max(0, limits.scansPerDay - usage.scans),
    scansLimit: limits.scansPerDay,
    analysisUsed: usage.analysis,
    analysisRemaining: Math.max(0, limits.analysisPerDay - usage.analysis),
    analysisLimit: limits.analysisPerDay,
  };
}
