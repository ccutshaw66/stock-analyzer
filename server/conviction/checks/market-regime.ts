/**
 * Market Regime check — is the broader market in a tape that helps or
 * hurts a long entry? Risk-on / euphoric = tailwind; defensive / risk-off
 * = headwind; neutral = no edge. Pulled from the live Market Pulse cache
 * so the regime reflects today's tape, not last night's snapshot.
 */
import type { Check, CheckResult } from "./types";

export const marketRegimeCheck: Check = (ctx) => {
  if (!ctx.marketRegime) return null;
  const tier = ctx.marketRegime.tier;

  const base: Omit<CheckResult, "status" | "reason"> = {
    id: "market-regime",
    category: "Market Regime",
    label: "Broader market tape",
    weight: 2,
  };

  if (tier === "RISK-ON" || tier === "EUPHORIC") {
    return {
      ...base,
      status: "pass",
      reason: `Market in ${tier.toLowerCase()} mode — broader tape is supportive of long entries.`,
    };
  }
  if (tier === "DEFENSIVE" || tier === "RISK-OFF") {
    return {
      ...base,
      status: "fail",
      reason: `Market in ${tier.toLowerCase().replace("-", " ")} mode — buying into a defensive tape. Headwind.`,
    };
  }
  return {
    ...base,
    status: "warn",
    reason: "Market in neutral regime — no tailwind, no headwind.",
  };
};
