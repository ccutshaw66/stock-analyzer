/**
 * Express middleware to gate routes by tier.
 *
 * Usage:
 *   app.get("/api/mm-exposure/:sym", requireTier("pro"), handler);
 *
 * Resolves the user's tier from storage (the auth middleware populates
 * `req.user` with `{id,email,displayName}` but not `tier`, so we look it up
 * here). 402 on tier-fail, 401 if not authenticated.
 */
import { meetsTier, type Tier } from "./index";
import { getUserTier } from "../../stripe";

export function requireTier(min: Tier) {
  return async (req: any, res: any, next: any) => {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    try {
      const userTier = (await getUserTier(userId)) as Tier;
      if (!meetsTier(userTier, min)) {
        return res.status(402).json({
          error: "TIER_REQUIRED",
          requiredTier: min,
          currentTier: userTier,
          upgradeUrl: "/billing/upgrade",
        });
      }
      next();
    } catch (err: any) {
      // Fail-open on transient storage errors (matches checkFeatureAccess
      // legacy behavior) so a DB blip doesn't lock out paying users.
      console.error("[requireTier] tier lookup failed:", err?.message || err);
      next();
    }
  };
}
