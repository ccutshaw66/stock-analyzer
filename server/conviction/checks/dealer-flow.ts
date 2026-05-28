/**
 * Dealer Flow check — how are market makers positioned in this ticker's
 * options chain? Positive gamma = dealers hedge against the trend (dampens
 * moves); negative gamma = dealers amplify the trend (volatility expansion).
 * Squeeze bias rolls these into "up/down/neutral" in plain language.
 */
import type { Check, CheckResult } from "./types";

export const dealerFlowCheck: Check = (ctx) => {
  if (!ctx.mm) return null; // illiquid options or fetch failed — quiet skip
  const { squeezeBias, squeezeStrength, gammaWall, spot } = ctx.mm;

  const base: Omit<CheckResult, "status" | "reason"> = {
    id: "dealer-flow",
    category: "Dealer Flow",
    label: "Market-maker positioning",
    weight: 2,
  };

  const wallTxt =
    gammaWall && spot
      ? ` Gamma wall near $${gammaWall.toFixed(2)} (${gammaWall > spot ? "above" : "below"} spot).`
      : "";

  if (squeezeBias === "up" && squeezeStrength >= 0.4) {
    return {
      ...base,
      status: "pass",
      reason: `Market makers are positioned for upside — they'll amplify any rally.${wallTxt}`,
    };
  }
  if (squeezeBias === "down" && squeezeStrength >= 0.4) {
    return {
      ...base,
      status: "fail",
      reason: `Market makers are positioned for downside — they'll amplify any selling.${wallTxt}`,
    };
  }
  return {
    ...base,
    status: "warn",
    reason: `Dealer positioning is neutral — no clear edge from market makers.${wallTxt}`,
  };
};
