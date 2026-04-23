/**
 * Analyst-Action detector.
 *
 * Fires when there's been a recent analyst upgrade or downgrade (within the
 * last 5 trading-ish days). Analyst actions tend to cluster around catalysts
 * and can kick off momentum runs.
 *
 * Direction: "up" on upgrades, "down" on downgrades. If both exist in the
 * window, the most recent action wins.
 * Strength: 1.0 if today, linearly decays to 0.2 at 5 days out. Multiple
 * actions in-window boost strength modestly (+0.1 per extra, capped at 1.0).
 *
 * Data source: FMP /stable/grades-latest-news, batch-loaded once per scan
 * and attached to ctx.extras.analystActions by the orchestrator.
 */
import type { SignalDetector, SignalResult } from "../scanner-v2";

const WINDOW_DAYS = 5;

export const analystActionDetector: SignalDetector = (ctx): SignalResult | null => {
  const actions = ctx.extras?.analystActions;
  if (!actions || actions.length === 0) return null;

  const now = Date.now();
  const msPerDay = 24 * 60 * 60 * 1000;

  // Filter to in-window actions, newest first
  const inWindow = actions
    .filter((a) => {
      const daysAgo = (now - a.date.getTime()) / msPerDay;
      return daysAgo >= 0 && daysAgo <= WINDOW_DAYS;
    })
    .sort((a, b) => b.date.getTime() - a.date.getTime());

  if (inWindow.length === 0) {
    return {
      id: "analyst_action",
      label: "Analyst Action",
      triggered: false,
      strength: 0,
      direction: "either",
      detail: `no action in last ${WINDOW_DAYS}d`,
    };
  }

  const latest = inWindow[0];
  const daysAgo = (now - latest.date.getTime()) / msPerDay;

  // Base strength: 0 days ago → 1.0, 5 days ago → 0.2
  let strength = Math.max(0.2, 1 - (daysAgo / WINDOW_DAYS) * 0.8);

  // Bonus for clustering: +0.1 per extra action, capped
  if (inWindow.length > 1) {
    strength = Math.min(1, strength + 0.1 * (inWindow.length - 1));
  }

  const direction = latest.direction;
  const dayLabel = daysAgo < 1 ? "today" : `${Math.round(daysAgo)}d ago`;
  const extra = inWindow.length > 1 ? ` (+${inWindow.length - 1} more)` : "";
  return {
    id: "analyst_action",
    label: "Analyst Action",
    triggered: true,
    strength,
    direction,
    detail: `${direction === "up" ? "upgrade" : "downgrade"} ${dayLabel}${extra}`,
  };
};
