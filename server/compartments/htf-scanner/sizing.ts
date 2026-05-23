/**
 * Dynamic position-size recommendation for HTF.
 *
 * Rationale: Cardoza Monte Carlo on the 2026-05-20 HTF baseline showed
 * MC95 max drawdown of ~$12,858 at $1,750/trade. On a $7K account that's
 * 1.85× — game-over if drawdown hits early. The fix isn't to change the
 * strategy (validation cleared it with WFE 1.98 / strong-edge); it's to
 * scale position size to *cumulative HTF realized P&L*, so drawdowns are
 * always paid out of profits already earned, never out of starting capital.
 *
 * Three phases, anchored to the MC95 stat scaled linearly:
 *   - Phase 1 — $500/trade. MC95 scales to ~$3.7K (~50% of $7K). Tolerable
 *     for a new starter. Required until $5K realized HTF P&L.
 *   - Phase 2 — $1,000/trade. Activated at $5K HTF P&L (account now $12K).
 *     MC95 ~$7.4K = ~60% of capital.
 *   - Phase 3 — $1,750/trade. Activated at $13K HTF P&L (account ~$20K).
 *     Full target size. MC95 ~$12.9K = ~65% of capital.
 *
 * Realized P&L counts ONLY trades where `strategy='htf'` AND `closeDate IS
 * NOT NULL`. Open positions don't count — paper gains aren't drawdown buffer.
 *
 * Pure functions only. The route handler reads trades + account settings,
 * passes the numbers in, returns the recommendation to the client.
 */

export interface SizingPhase {
  phase: 1 | 2 | 3;
  /** Cumulative HTF realized $ needed to enter this phase. */
  minRealizedPnL: number;
  /** Recommended dollars per trade. */
  positionSize: number;
  /** Short label for UI badges. */
  label: string;
  /** Reasoning for the choice — surfaced as hover/tooltip. */
  reasoning: string;
}

export const SIZING_PHASES: SizingPhase[] = [
  {
    phase: 1,
    minRealizedPnL: 0,
    positionSize: 500,
    label: "Phase 1 — Build the buffer",
    reasoning:
      "$500/trade scales MC95 drawdown to ~$3.7K (≈50% of $7K starting account). Survivable if the worst-case timing hits before profits accumulate.",
  },
  {
    phase: 2,
    minRealizedPnL: 5000,
    positionSize: 1000,
    label: "Phase 2 — Scaling up",
    reasoning:
      "Cumulative HTF realized P&L ≥ $5K means the account is ~$12K. $1,000/trade keeps MC95 drawdown ~60% of working capital — acceptable as the buffer grows.",
  },
  {
    phase: 3,
    minRealizedPnL: 13000,
    positionSize: 1750,
    label: "Phase 3 — Full size",
    reasoning:
      "Cumulative HTF realized P&L ≥ $13K means the account is ~$20K. Full $1,750/trade matches the locked baseline that produced the $569K / WFE 1.98 result.",
  },
];

export interface SizingRecommendation {
  htfRealizedPnL: number;
  currentPhase: SizingPhase;
  /** Next phase (or null if already at Phase 3). */
  nextPhase: SizingPhase | null;
  /** Realized $ still needed to enter the next phase (null if at Phase 3). */
  dollarsToNextPhase: number | null;
  /** % progress within the current phase (0–100). 100 = ready to step up. */
  phaseProgressPct: number;
  /** Suggested `capital` value for the HTF Config — starting + realized. */
  recommendedCapital: number;
  /**
   * Suggested `maxPositionPct` — the explicit ceiling that, combined with
   * `recommendedCapital`, produces the phase's positionSize. Calibrated so
   * the existing position-sizing math caps trades at the right $-amount
   * without requiring a schema change.
   */
  recommendedMaxPositionPct: number;
}

/**
 * Compute the active phase + next-phase progress given cumulative HTF
 * realized P&L. `startingCapital` is used to derive the recommended
 * `capital` config value (starting + realized = current real capital).
 */
export function computeSizingRecommendation(
  htfRealizedPnL: number,
  startingCapital: number,
): SizingRecommendation {
  // Find the highest phase whose minRealizedPnL ≤ current realized.
  let currentIdx = 0;
  for (let i = 0; i < SIZING_PHASES.length; i++) {
    if (htfRealizedPnL >= SIZING_PHASES[i].minRealizedPnL) currentIdx = i;
    else break;
  }
  const currentPhase = SIZING_PHASES[currentIdx];
  const nextPhase = currentIdx + 1 < SIZING_PHASES.length ? SIZING_PHASES[currentIdx + 1] : null;
  const dollarsToNextPhase = nextPhase != null
    ? Math.max(0, nextPhase.minRealizedPnL - htfRealizedPnL)
    : null;
  const phaseSpan = nextPhase != null
    ? nextPhase.minRealizedPnL - currentPhase.minRealizedPnL
    : 1;
  const phaseProgressPct = nextPhase != null
    ? Math.min(100, Math.max(0, ((htfRealizedPnL - currentPhase.minRealizedPnL) / phaseSpan) * 100))
    : 100;
  // Current capital = starting + realized HTF P&L. Note: this is HTF-only
  // by design — we don't credit non-HTF strategies' P&L here because they
  // have their own (future) sizing logic. Starting capital is the user's
  // pre-HTF baseline; realized HTF P&L is the buffer they've earned.
  const recommendedCapital = startingCapital + Math.max(0, htfRealizedPnL);
  const recommendedMaxPositionPct = recommendedCapital > 0
    ? currentPhase.positionSize / recommendedCapital
    : 0.25;
  return {
    htfRealizedPnL: Number(htfRealizedPnL.toFixed(2)),
    currentPhase,
    nextPhase,
    dollarsToNextPhase: dollarsToNextPhase != null ? Number(dollarsToNextPhase.toFixed(2)) : null,
    phaseProgressPct: Number(phaseProgressPct.toFixed(1)),
    recommendedCapital: Number(recommendedCapital.toFixed(2)),
    recommendedMaxPositionPct: Number(recommendedMaxPositionPct.toFixed(4)),
  };
}
