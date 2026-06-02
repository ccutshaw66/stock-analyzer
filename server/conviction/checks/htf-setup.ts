/**
 * HTF Setup check — has the High Tight Flag pattern just fired, or is one
 * forming? HTF is Stockotter's highest-conviction breakout pattern (30%+
 * pole, tight flag, volume on breakout). When HTF fires, that's a strong
 * argument FOR the trade; when one is forming, you're early.
 */
import { scanHtf, htfLiveStatus } from "../../signals/strategies/htf";
import type { Check, CheckResult } from "./types";

// A fired HTF stays a "fresh" trigger on the on-demand check for ~2 trading weeks.
// (The nightly scanner uses a stricter 1-day window; the price-based guards are shared.)
const TRIGGER_MAX_DAYS_SINCE_BREAKOUT = 14;

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

  // Most recent hit. scanHtf returns hits sorted newest → oldest, so the
  // freshest breakout is hits[0] (NOT hits[length-1], which is the oldest and
  // would surface a months-stale signal as if it "just fired").
  const recent = hits[0];
  const stage = (recent as any).stage ?? "fired";

  if (stage === "fired") {
    const target = (recent as any).targetPrice as number | undefined;
    const stop = (recent as any).stopPrice as number | undefined;
    const tgtTxt = target ? ` Target ~$${target.toFixed(2)}` : "";
    const stopTxt = stop ? `, stop ~$${stop.toFixed(2)}` : "";

    // Validity guards — a fired HTF is only an actionable GO while the trade is
    // still live and the breakout is fresh. Uses the SHARED predicate so we never
    // recommend a setup that has already played out, been chased, or gone stale.
    const lastBar = ctx.bars[ctx.bars.length - 1];
    const status = htfLiveStatus(recent, lastBar.c, lastBar.t, TRIGGER_MAX_DAYS_SINCE_BREAKOUT);

    if (!status.live) {
      switch (status.reason) {
        case "stopped":
          return {
            ...base,
            status: "fail",
            reason: `High Tight Flag broke out but price has since fallen below its ~$${stop?.toFixed(2)} stop — the setup failed.`,
          };
        case "target-hit":
          return {
            ...base,
            status: "warn",
            reason: `High Tight Flag already broke out and has run to its ~$${target?.toFixed(2)} target — the entry has passed.`,
          };
        case "chased":
          return {
            ...base,
            status: "warn",
            reason: `High Tight Flag fired but price has already run too far past the breakout for a clean entry — chasing it now is risky.`,
          };
        case "stale":
          return {
            ...base,
            status: "warn",
            reason: `High Tight Flag fired ${status.daysSince} days ago — no longer a fresh trigger.${tgtTxt}${stopTxt}.`,
          };
      }
    }
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
