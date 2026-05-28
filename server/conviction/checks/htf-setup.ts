/**
 * HTF Setup check — has the High Tight Flag pattern just fired, or is one
 * forming? HTF is Stockotter's highest-conviction breakout pattern (30%+
 * pole, tight flag, volume on breakout). When HTF fires, that's a strong
 * argument FOR the trade; when one is forming, you're early.
 */
import { scanHtf } from "../../signals/strategies/htf";
import type { Check, CheckResult } from "./types";

export const htfSetupCheck: Check = (ctx) => {
  if (ctx.bars.length < 100) return null;
  // scanHtf expects bars in the shape {t,o,h,l,c,v} which matches OHLCV.
  const hits = scanHtf(ctx.bars as any, ctx.ticker);
  const base: Omit<CheckResult, "status" | "reason"> = {
    id: "htf-setup",
    category: "Setup",
    label: "High Tight Flag setup",
    weight: 3,
  };

  if (!hits || hits.length === 0) {
    return null; // No HTF setup at all — don't show a row; it's not relevant.
  }

  // Most recent hit
  const recent = hits[hits.length - 1];
  const stage = (recent as any).stage ?? "fired";

  if (stage === "fired") {
    const target = (recent as any).targetPrice;
    const stop = (recent as any).stopPrice;
    const tgtTxt = target ? ` Target ~$${target.toFixed(2)}` : "";
    const stopTxt = stop ? `, stop ~$${stop.toFixed(2)}` : "";
    return {
      ...base,
      status: "pass",
      reason: `High Tight Flag just fired — a strong breakout pattern with measured upside.${tgtTxt}${stopTxt}.`,
    };
  }
  return {
    ...base,
    status: "warn",
    reason: "High Tight Flag setup is forming but hasn't broken out yet — keep it on watch.",
  };
};
