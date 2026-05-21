/**
 * Strategy registry — the single source of truth for what strategies exist,
 * how their trades render on the Current Positions page, and what alerts
 * fire when a trade hits a lifecycle decision point.
 *
 * Foundation-first plug-in shape: adding a new strategy = add a manifest to
 * the STRATEGY_REGISTRY map. The dropdown on Add/Edit Trade, the grouping
 * on Current Positions, the alerts column — all read from this file. No UI
 * code changes needed when a new strategy is added.
 *
 * Used by:
 *   - client/src/pages/trade-tracker.tsx   — dropdown + grouping + alerts
 *   - server/compartments/htf-scanner/routes.ts — HTF portfolio gate filter
 *   - any future strategy compartment that wants to set strategyData on
 *     newly-created trades
 *
 * Deferred (in CHANGES TODO):
 *   - Background monitor that fires alerts when the page isn't open
 *   - Browser push notifications
 *   - Email / SMS for critical actions (stop hit, take partial, dump)
 */

// ─── Trade subset this module operates on ─────────────────────────────────
//
// We don't import the full Drizzle `Trade` type because this file lives in
// `shared/` and is imported from both server (Node) and client (browser).
// The fields below are the minimum the manifests need.

export interface StrategyTradeView {
  symbol: string;
  openPrice: number;
  currentPrice: number | null;
  target: number | null;
  closeDate: string | null;
  tradeDate: string;
  strategy: string;
  strategyReason: string | null;
  strategyData: Record<string, any> | null;
}

// ─── What each strategy declares ──────────────────────────────────────────

export type LifecycleSeverity = "info" | "watch" | "warn" | "critical";
export type LifecycleAction = "hold" | "take-partial" | "exit" | "dump";

export interface DisplayPoint {
  /** Short label for the cell. e.g. "Stop", "Target", "Take 1/3". */
  label: string;
  /** Value to show. Already formatted ($12.40 / +18.5% / "Above $14.50"). */
  value: string;
  /**
   * Visual state for this point:
   *   - past:      already happened (entry filled, partial taken). Muted.
   *   - pending:   future, no action yet. Default text.
   *   - armed:     close to triggering. Color highlights, no urgency.
   *   - triggered: condition met RIGHT NOW. Bold + red/green badge + ACTION NOW.
   */
  state: "past" | "pending" | "armed" | "triggered";
}

export interface LifecycleAlert {
  severity: LifecycleSeverity;
  /** Human-readable message rendered in the alert badge. */
  message: string;
  /** Recommended action — drives badge color + icon. */
  action: LifecycleAction;
}

export interface StrategyEvaluation {
  /** Strategy-specific row cells shown under the group heading. */
  displayPoints: DisplayPoint[];
  /** Triggered alerts. Empty array = no action needed right now. */
  alerts: LifecycleAlert[];
}

export interface StrategyManifest {
  id: string;
  /** Long name shown in dropdown + group heading ("HTF (High Tight Flag)"). */
  name: string;
  /** Short label for compact UI. */
  shortName: string;
  /** One-line plain-English description. Shown under dropdown options. */
  description: string;
  /** Brand color category for the group header. Maps to design tokens. */
  color: "bull" | "watch" | "bear" | "neutral" | "info";
  /** If true, the trade form should show + require strategyReason text. */
  requiresReason: boolean;
  /**
   * Evaluate the trade against its strategy rules and return the lifecycle
   * data the Positions page renders. Pure function — no side effects, no
   * I/O. If price/bar data is needed to evaluate a trigger, the caller
   * passes it via `liveContext` (not implemented in this manifest version;
   * deferred until background monitor lands).
   */
  evaluate: (trade: StrategyTradeView) => StrategyEvaluation;
}

// ─── Formatting helpers ───────────────────────────────────────────────────

function fmt$(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return "—";
  return `$${n.toFixed(2)}`;
}
function fmtPct(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}
function pctChange(from: number | null, to: number | null): number | null {
  if (from == null || to == null || from === 0) return null;
  return ((to - from) / from) * 100;
}

// ─── Manifests ────────────────────────────────────────────────────────────

/**
 * HTF — High Tight Flag (Givens variant).
 * Lifecycle: Entry @ next open after breakout → Stop @ flag_low × 0.99 →
 * Take 1/3 after 3 cumulative close-strength days (close >5% above entry) →
 * Trail remaining 2/3 below 20-day MA after partial fires.
 */
const HTF_MANIFEST: StrategyManifest = {
  id: "htf",
  name: "HTF (High Tight Flag)",
  shortName: "HTF",
  description: "Givens HTF setup: 30%+ pole, tight flag, breakout on volume",
  color: "bull",
  requiresReason: false,
  evaluate(trade) {
    const data = trade.strategyData ?? {};
    const entry = trade.openPrice;
    const current = trade.currentPrice;
    const stop = typeof data.stopPrice === "number" ? data.stopPrice : null;
    const target = trade.target ?? (typeof data.targetPrice === "number" ? data.targetPrice : null);
    const partialThreshold = entry * 1.05; // close >5% above entry
    const flagHigh = typeof data.flagHigh === "number" ? data.flagHigh : null;
    const flagLow = typeof data.flagLow === "number" ? data.flagLow : null;
    const ma20 = typeof data.ma20 === "number" ? data.ma20 : null; // optional — set by background monitor when wired
    const partialDone = data.partialDone === true;

    const points: DisplayPoint[] = [];
    const alerts: LifecycleAlert[] = [];

    // Entry — always past once trade is open
    points.push({ label: "Entry", value: fmt$(entry), state: "past" });

    // Stop
    if (stop != null) {
      let state: DisplayPoint["state"] = "pending";
      if (current != null && current <= stop) state = "triggered";
      else if (current != null && current <= stop * 1.03) state = "armed";
      points.push({ label: "Stop", value: fmt$(stop), state });
      if (state === "triggered") {
        alerts.push({
          severity: "critical",
          action: "dump",
          message: `Stop hit ${fmt$(current!)} ≤ ${fmt$(stop)} — exit now`,
        });
      } else if (state === "armed") {
        alerts.push({
          severity: "warn",
          action: "hold",
          message: `Approaching stop — within 3% of ${fmt$(stop)}`,
        });
      }
    }

    // Take 1/3 after 3 consecutive strength days
    if (!partialDone) {
      let state: DisplayPoint["state"] = "pending";
      if (current != null && current > partialThreshold) state = "armed";
      points.push({ label: "Take 1/3", value: `Above ${fmt$(partialThreshold)}`, state });
      if (state === "armed") {
        alerts.push({
          severity: "watch",
          action: "take-partial",
          message: `Price above +5%. Sell 1/3 after 3 cumulative strength days.`,
        });
      }
    } else {
      points.push({ label: "Took 1/3", value: "✓", state: "past" });
    }

    // Trail 20-MA after partial
    if (partialDone) {
      let state: DisplayPoint["state"] = "pending";
      if (ma20 != null && current != null && current < ma20) state = "triggered";
      points.push({
        label: "Trail 20-MA",
        value: ma20 != null ? `Below ${fmt$(ma20)}` : "20-MA not loaded",
        state,
      });
      if (state === "triggered") {
        alerts.push({
          severity: "critical",
          action: "exit",
          message: `Close below 20-MA — exit remaining 2/3`,
        });
      }
    }

    // Target
    if (target != null) {
      let state: DisplayPoint["state"] = "pending";
      if (current != null && current >= target) state = "triggered";
      points.push({ label: "Target", value: fmt$(target), state });
      if (state === "triggered") {
        alerts.push({
          severity: "watch",
          action: "take-partial",
          message: `Target ${fmt$(target)} hit — review whether to exit or trail`,
        });
      }
    }

    // Pole + flag context (informational, no alerts)
    if (typeof data.poleGainPct === "number" && typeof data.poleDays === "number") {
      points.push({
        label: "Pole",
        value: `+${data.poleGainPct.toFixed(0)}% / ${data.poleDays}d`,
        state: "past",
      });
    }
    if (typeof data.flagDays === "number" && typeof data.flagPullbackPct === "number") {
      points.push({
        label: "Flag",
        value: `${data.flagDays}d / -${data.flagPullbackPct.toFixed(1)}%`,
        state: "past",
      });
    }

    // Current %-from-entry
    const pctFromEntry = pctChange(entry, current);
    if (pctFromEntry != null) {
      points.push({
        label: "vs entry",
        value: fmtPct(pctFromEntry),
        state: pctFromEntry >= 0 ? "past" : "pending",
      });
    }

    return { displayPoints: points, alerts };
  },
};

/**
 * BBTC + VER — Bull/Bear Trend Continuation + Velocity-Extremes Reversal.
 * Long-only since 2026-05-08 short demote. Trade closes on STOP_HIT or SELL.
 */
const BBTC_VER_MANIFEST: StrategyManifest = {
  id: "bbtc-ver",
  name: "BBTC + VER",
  shortName: "BBTC",
  description: "Trend continuation + oversold reversal (Ready/Set/Go chain)",
  color: "info",
  requiresReason: false,
  evaluate(trade) {
    const data = trade.strategyData ?? {};
    const entry = trade.openPrice;
    const current = trade.currentPrice;
    const stop = typeof data.stopPrice === "number" ? data.stopPrice : null;
    const target = trade.target ?? (typeof data.targetPrice === "number" ? data.targetPrice : null);
    const exitTrigger = typeof data.exitTrigger === "number" ? data.exitTrigger : null;

    const points: DisplayPoint[] = [];
    const alerts: LifecycleAlert[] = [];

    points.push({ label: "Entry", value: fmt$(entry), state: "past" });

    if (stop != null) {
      let state: DisplayPoint["state"] = "pending";
      if (current != null && current <= stop) state = "triggered";
      else if (current != null && current <= stop * 1.03) state = "armed";
      points.push({ label: "Stop (EXIT)", value: fmt$(stop), state });
      if (state === "triggered") {
        alerts.push({
          severity: "critical",
          action: "exit",
          message: `Stop hit ${fmt$(current!)} ≤ ${fmt$(stop)} — exit now`,
        });
      } else if (state === "armed") {
        alerts.push({
          severity: "warn",
          action: "hold",
          message: `Approaching stop — within 3% of ${fmt$(stop)}`,
        });
      }
    }

    if (exitTrigger != null) {
      let state: DisplayPoint["state"] = "pending";
      if (current != null && current <= exitTrigger) state = "triggered";
      points.push({ label: "Exit trigger", value: fmt$(exitTrigger), state });
      if (state === "triggered") {
        alerts.push({
          severity: "warn",
          action: "exit",
          message: `Exit-trigger price hit — close the position`,
        });
      }
    }

    if (target != null) {
      let state: DisplayPoint["state"] = "pending";
      if (current != null && current >= target) state = "triggered";
      points.push({ label: "Target", value: fmt$(target), state });
      if (state === "triggered") {
        alerts.push({
          severity: "watch",
          action: "take-partial",
          message: `Target ${fmt$(target)} hit — review whether to exit or trail`,
        });
      }
    }

    const pctFromEntry = pctChange(entry, current);
    if (pctFromEntry != null) {
      points.push({
        label: "vs entry",
        value: fmtPct(pctFromEntry),
        state: pctFromEntry >= 0 ? "past" : "pending",
      });
    }

    return { displayPoints: points, alerts };
  },
};

/**
 * TFT — Two-Layer Trend Continuation (40W weekly-close exit variant).
 * Holds a CORE position while regime is bullish, scales with tactical adds.
 */
const TFT_40W_MANIFEST: StrategyManifest = {
  id: "tft-40w",
  name: "TFT (40W exit)",
  shortName: "TFT-40W",
  description: "Two-layer trend follower — exits on weekly close below 40W SMA",
  color: "bull",
  requiresReason: false,
  evaluate(trade) {
    const data = trade.strategyData ?? {};
    const entry = trade.openPrice;
    const current = trade.currentPrice;
    const sma40w = typeof data.sma40w === "number" ? data.sma40w : null;
    const catastrophicStop = entry * 0.85; // -15% from entry

    const points: DisplayPoint[] = [];
    const alerts: LifecycleAlert[] = [];

    points.push({ label: "Entry", value: fmt$(entry), state: "past" });

    // 40W SMA exit
    if (sma40w != null) {
      let state: DisplayPoint["state"] = "pending";
      if (current != null && current < sma40w) state = "triggered";
      points.push({ label: "40W SMA", value: fmt$(sma40w), state });
      if (state === "triggered") {
        alerts.push({
          severity: "warn",
          action: "exit",
          message: `Weekly close below 40W — exit core position`,
        });
      }
    }

    // Catastrophic stop (-15%)
    let catState: DisplayPoint["state"] = "pending";
    if (current != null && current <= catastrophicStop) catState = "triggered";
    else if (current != null && current <= catastrophicStop * 1.03) catState = "armed";
    points.push({ label: "−15% stop", value: fmt$(catastrophicStop), state: catState });
    if (catState === "triggered") {
      alerts.push({
        severity: "critical",
        action: "dump",
        message: `Catastrophic stop hit (−15% from entry) — dump now`,
      });
    }

    const pctFromEntry = pctChange(entry, current);
    if (pctFromEntry != null) {
      points.push({
        label: "vs entry",
        value: fmtPct(pctFromEntry),
        state: pctFromEntry >= 0 ? "past" : "pending",
      });
    }

    return { displayPoints: points, alerts };
  },
};

const TFT_60W_MANIFEST: StrategyManifest = {
  ...TFT_40W_MANIFEST,
  id: "tft-60w",
  name: "TFT (60W exit)",
  shortName: "TFT-60W",
  description: "Two-layer trend follower — slower 60W SMA exit for moonshot capture",
};

const TFT_CAT_MANIFEST: StrategyManifest = {
  ...TFT_40W_MANIFEST,
  id: "tft-cat",
  name: "TFT (catastrophic-only)",
  shortName: "TFT-CAT",
  description: "Two-layer trend follower — core exits only on −15% stop",
};

/**
 * AMC — Aligned Momentum Confluence. The yellow phase of the Ready/Set/Go chain.
 */
const AMC_MANIFEST: StrategyManifest = {
  id: "amc",
  name: "AMC (Momentum Confluence)",
  shortName: "AMC",
  description: "5-condition momentum confluence — middle leg of Ready/Set/Go",
  color: "watch",
  requiresReason: false,
  evaluate(trade) {
    return BBTC_VER_MANIFEST.evaluate(trade); // same lifecycle as BBTC+VER
  },
};

/**
 * Manual — discretionary trade with no strategy rules.
 * Shows only entry + current %-from-entry.
 */
const MANUAL_MANIFEST: StrategyManifest = {
  id: "manual",
  name: "Manual",
  shortName: "Manual",
  description: "Discretionary trade — no strategy-driven lifecycle",
  color: "neutral",
  requiresReason: false,
  evaluate(trade) {
    const points: DisplayPoint[] = [];
    points.push({ label: "Entry", value: fmt$(trade.openPrice), state: "past" });
    if (trade.target != null) {
      let state: DisplayPoint["state"] = "pending";
      if (trade.currentPrice != null && trade.currentPrice >= trade.target) state = "triggered";
      points.push({ label: "Target", value: fmt$(trade.target), state });
    }
    const pct = pctChange(trade.openPrice, trade.currentPrice);
    if (pct != null) {
      points.push({
        label: "vs entry",
        value: fmtPct(pct),
        state: pct >= 0 ? "past" : "pending",
      });
    }
    return { displayPoints: points, alerts: [] };
  },
};

/**
 * Other — non-strategy reason ("Steve recommended", "FOMO", etc.).
 * Requires the reason text to be filled. Otherwise renders like Manual.
 */
const OTHER_MANIFEST: StrategyManifest = {
  id: "other",
  name: "Other",
  shortName: "Other",
  description: "Non-strategy reason (e.g. recommendation, news, hunch)",
  color: "neutral",
  requiresReason: true,
  evaluate: MANUAL_MANIFEST.evaluate,
};

// ─── Registry ─────────────────────────────────────────────────────────────

export const STRATEGY_REGISTRY: Record<string, StrategyManifest> = {
  htf: HTF_MANIFEST,
  "bbtc-ver": BBTC_VER_MANIFEST,
  "tft-40w": TFT_40W_MANIFEST,
  "tft-60w": TFT_60W_MANIFEST,
  "tft-cat": TFT_CAT_MANIFEST,
  amc: AMC_MANIFEST,
  manual: MANUAL_MANIFEST,
  other: OTHER_MANIFEST,
};

/** All valid strategy ids — used for dropdown options + validation. */
export const STRATEGY_IDS = Object.keys(STRATEGY_REGISTRY);

/**
 * Look up a manifest by id. Falls back to `manual` if the id is unknown
 * (e.g. a row from a future strategy that this build doesn't know about
 * yet) so the Positions page never crashes on render.
 */
export function getStrategyManifest(id: string | null | undefined): StrategyManifest {
  if (!id) return MANUAL_MANIFEST;
  return STRATEGY_REGISTRY[id] ?? MANUAL_MANIFEST;
}

/** True if the given id is a known strategy. */
export function isKnownStrategy(id: string | null | undefined): boolean {
  return !!id && id in STRATEGY_REGISTRY;
}
