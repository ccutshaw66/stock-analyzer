/**
 * Express middleware to gate routes by tier.
 *
 * Usage:
 *   app.get("/api/mm-exposure/:sym", requireTier("pro"), handler);
 */
import { meetsTier, type Tier } from "./index";

export function requireTier(min: Tier) {
  return (req: any, res: any, next: any) => {
    const userTier: Tier = req.user?.tier ?? "free";
    if (!meetsTier(userTier, min)) {
      return res.status(402).json({
        error: "TIER_REQUIRED",
        requiredTier: min,
        currentTier: userTier,
        upgradeUrl: "/billing/upgrade",
      });
    }
    next();
  };
}
