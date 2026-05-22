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
  /**
   * Open share count. Required for alerts to compute real-dollar take-partial
   * and exit instructions ("Sell 3 shares to lock in $11.40 profit") instead
   * of abstract "take 1/3" rules the user would have to math out by hand.
   * Optional only because legacy callers may not pass it yet; manifests
   * fall back to share-fraction language when missing.
   */
  contractsShares?: number;
  /**
   * Live lifecycle state computed from bars walked from entry → today.
   * Snapshot data lives in strategyData (locked at entry: stop, target,
   * pole, flag). DYNAMIC data lives here (partialDone, currentMa20,
   * hasStopped, hasTargeted, strength-day counter, peak/trough). The
   * server attaches this on /api/trades for open HTF positions; manifest
   * reads from it when present, falls back to strategyData otherwise.
   */
  lifecycleState?: Record<string, any> | null;
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
  /**
   * Number of shares the action targets. The UI uses this to render an
   * action button ("Sell 3" / "Close 10" / "DUMP 10") and to pre-fill the
   * Close Trade modal's qty. Manifests own this number per their strategy
   * rules — HTF "take-partial" populates floor(shares/3); HTF "dump"
   * populates full shares; BBTC "exit" populates full shares; etc.
   *
   * null = informational alert with no executable action (e.g. "hold",
   * "watch"). UI renders no button.
   */
  actionShares?: number | null;
  /**
   * Short button label the UI renders. Lets each strategy phrase its own
   * action ("Sell 3" / "Take partial" / "Dump 10"). Falls back to
   * action-name capitalization if absent.
   */
  actionLabel?: string;
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
   * Opt-in metadata that surfaces this strategy on the /chart comparison page.
   * Strategies without this field don't appear in the toggle (e.g. HTF and
   * Wyckoff Spring have their own dedicated pages, not the /chart backtester).
   * Adding a new comparable strategy = set this + register a server adapter
   * in `server/diag/chart-data.ts`. The /chart page itself stays untouched.
   */
  chartBacktest?: {
    /** Short label shown on the toggle button. */
    label: string;
    /** Tooltip text shown on hover. */
    description: string;
  };
  /**
   * Ordered list of `DisplayPoint.label`s the Current Positions table renders
   * as **its own columns** for this strategy. Each strategy gets its own
   * table so the columns reflect its rules (HTF: Stop / Take 1/3 / Trail
   * 20-MA / Target; BBTC: Stop / Exit Trigger / Target; etc.). Labels that
   * don't appear in a particular row's `evaluate()` output render "—".
   *
   * Excludes "Entry" + "vs entry" since those are common to every strategy
   * and rendered in fixed columns by the page; manifest only owns the
   * STRATEGY-SPECIFIC slots between them.
   */
  columnOrder: string[];
  /**
   * Evaluate the trade against its strategy rules and return the lifecycle
   * data the Positions page renders. Pure function — no side effects, no
   * I/O. If price/bar data is needed to evaluate a trigger, the caller
   * passes it via `liveContext` (not implemented in this manifest version;
   * deferred until background monitor lands).
   */
  evaluate: (trade: StrategyTradeView) => StrategyEvaluation;
  /**
   * Marks a research-only strategy that has not yet been wired into the
   * live signal/scanner stack. UI shows an "experimental" badge and skips
   * the strategy in scanner sweeps. Use when a strategy has been registered
   * for visibility (e.g. listed under /wheel's Experimental Strategies
   * section) but isn't yet production-ready.
   */
  experimental?: boolean;
  /**
   * Optional grouping hint surfaced on host pages (e.g. /wheel lists every
   * manifest with `pageGroup: "wheel"` under its Experimental Strategies
   * section). Keeps the strategy registry as the single source of truth
   * for "what strategies exist + where they surface."
   */
  pageGroup?: "wheel" | "trend" | "reversal" | "calculator";
}

// ─── Formatting helpers ───────────────────────────────────────────────────

function fmt$(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return "—";
  return `$${n.toFixed(2)}`;
}
function fmt$0(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return "—";
  return `$${Math.round(n).toLocaleString()}`;
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
  columnOrder: ["Stop", "Take 1/3", "Took 1/3", "Trail 20-MA", "Target", "Pole", "Flag"],
  evaluate(trade) {
    const data = trade.strategyData ?? {};
    const live = trade.lifecycleState ?? {};
    const entry = Math.abs(trade.openPrice);   // openPrice is signed; risk math wants absolute
    const current = trade.currentPrice;
    const shares = trade.contractsShares ?? 0;
    const stop = typeof data.stopPrice === "number" ? data.stopPrice : null;
    const target = (typeof data.targetPrice === "number" ? data.targetPrice : null)
      ?? (trade.target != null && trade.target > entry ? trade.target : null);
    const partialThreshold = entry * 1.05; // close >5% above entry
    // Dynamic fields: prefer the LIVE lifecycle state (server-computed by
    // walking bars from entry to today). Snapshot field on strategyData is
    // a fallback only — it's stale by definition for an active trade.
    const ma20 = typeof live.currentMa20 === "number" ? live.currentMa20
      : typeof data.ma20 === "number" ? data.ma20
      : null;
    const partialDone = live.partialDone === true || data.partialDone === true;
    const partialPriceLive = typeof live.partialPrice === "number" ? live.partialPrice : null;
    const partialDateLive = typeof live.partialDate === "string" ? live.partialDate : null;
    const currentStrengthDays = typeof live.currentStrengthDays === "number" ? live.currentStrengthDays : 0;

    // Pre-computed share splits — every alert below uses these so the
    // trader sees real numbers, not abstract "1/3" arithmetic.
    const oneThirdShares = Math.max(0, Math.floor(shares / 3));
    const twoThirdsShares = Math.max(0, shares - oneThirdShares);

    const points: DisplayPoint[] = [];
    const alerts: LifecycleAlert[] = [];

    // Entry / share count — always past once trade is open
    points.push({
      label: "Entry",
      value: shares > 0 ? `${shares} @ ${fmt$(entry)}` : fmt$(entry),
      state: "past",
    });

    // Stop — with $-at-risk computed from shares
    if (stop != null) {
      const dollarsAtRisk = shares > 0 ? Math.max(0, shares * (entry - stop)) : null;
      let state: DisplayPoint["state"] = "pending";
      if (current != null && current <= stop) state = "triggered";
      else if (current != null && current <= stop * 1.03) state = "armed";
      points.push({
        label: "Stop",
        value: dollarsAtRisk != null ? `${fmt$(stop)} (risk ${fmt$0(dollarsAtRisk)})` : fmt$(stop),
        state,
      });
      if (state === "triggered") {
        const dollarLoss = current != null && shares > 0 ? shares * (entry - current) : null;
        alerts.push({
          severity: "critical",
          action: "dump",
          actionShares: shares > 0 ? shares : null,
          actionLabel: shares > 0 ? `DUMP ${shares}` : "DUMP",
          message: shares > 0 && dollarLoss != null
            ? `STOP HIT. Exit all ${shares} shares now — locks ${fmt$0(-dollarLoss)} loss`
            : `Stop hit ${fmt$(current!)} ≤ ${fmt$(stop)} — exit now`,
        });
      } else if (state === "armed") {
        alerts.push({
          severity: "warn",
          action: "hold",
          actionShares: null,                               // informational, no button
          message: `Within 3% of stop ${fmt$(stop)} — be ready to exit ${shares} shares`,
        });
      }
    }

    // Take 1/3 — strategy rule: 3 cumulative close-strength days (close >5%
    // above entry) fires sale of 1/3 the position. The live lifecycle state
    // tracks whether this has actually FIRED on bars (partialDone), the date
    // it fired, the price, AND the current cumulative strength-day counter.
    if (!partialDone) {
      let state: DisplayPoint["state"] = "pending";
      if (currentStrengthDays > 0) state = "armed";
      else if (current != null && current > partialThreshold) state = "armed";
      const valueText = oneThirdShares > 0
        ? currentStrengthDays > 0
          ? `${oneThirdShares} sh · ${currentStrengthDays}/3 strength days`
          : `${oneThirdShares} sh above ${fmt$(partialThreshold)}`
        : `Above ${fmt$(partialThreshold)}`;
      points.push({ label: "Take 1/3", value: valueText, state });
      // Only fire the action alert when the 3rd strength day completes AND
      // the partial hasn't already been taken. currentStrengthDays === 0 with
      // partialDone === false means we're still building toward the 3-day
      // count or just had a non-strength day — informational only, no button.
      if (currentStrengthDays >= 3 && current != null && oneThirdShares > 0) {
        const profitPerShare = current - entry;
        const lockedIn = oneThirdShares * profitPerShare;
        alerts.push({
          severity: "watch",
          action: "take-partial",
          actionShares: oneThirdShares,
          actionLabel: `Sell ${oneThirdShares}`,
          message: `3rd close-strength day completed. Sell ${oneThirdShares} shares to lock in ${fmt$0(lockedIn)} profit (1/3 of position). Remaining ${twoThirdsShares} trail under 20-MA.`,
        });
      }
    } else {
      // Partial fired — show the date + price it locked in.
      const lockedAt = partialPriceLive != null ? ` @ ${fmt$(partialPriceLive)}` : "";
      const onDate = partialDateLive ? ` on ${partialDateLive}` : "";
      points.push({
        label: "Took 1/3",
        value: `✓${lockedAt}${onDate}`,
        state: "past",
      });
    }

    // Trail 20-MA — visible the WHOLE trade life, not just after partial.
    // Pre-partial: shown as a context line (live 20-MA value, no alerts).
    // Post-partial: this is the exit line per Givens' rule — close below
    // 20-MA fires the close-remaining alert.
    {
      let state: DisplayPoint["state"] = "pending";
      if (ma20 != null && current != null) {
        if (current < ma20) state = partialDone ? "triggered" : "armed";
        else if (current < ma20 * 1.02) state = "armed";
      }
      const valueText = ma20 != null
        ? partialDone
          ? `Exit below ${fmt$(ma20)}`
          : `20-MA ${fmt$(ma20)}`
        : "computing…";
      points.push({ label: "Trail 20-MA", value: valueText, state });

      // Alerts fire ONLY after partial has been taken — full-position exit
      // on a single MA poke would clip trends.
      if (partialDone && ma20 != null && current != null && current < ma20) {
        const remainingProfit = twoThirdsShares > 0 ? twoThirdsShares * (current - entry) : null;
        alerts.push({
          severity: "critical",
          action: "exit",
          actionShares: twoThirdsShares > 0 ? twoThirdsShares : null,
          actionLabel: twoThirdsShares > 0 ? `Close ${twoThirdsShares}` : "Close",
          message: remainingProfit != null
            ? `EXIT REMAINING. Close ${fmt$(current)} below 20-MA ${fmt$(ma20)} — sell final ${twoThirdsShares} shares (${fmt$0(remainingProfit)} profit on this lot).`
            : `Close below 20-MA — exit remaining 2/3`,
        });
      } else if (partialDone && ma20 != null && current != null && current < ma20 * 1.02) {
        alerts.push({
          severity: "warn",
          action: "hold",
          actionShares: null,
          message: `Within 2% of 20-MA (${fmt$(ma20)}) — ready to exit remaining ${twoThirdsShares} on close below.`,
        });
      }
    }

    // Target — measure-rule level. Hitting it is a take-profit decision point.
    if (target != null) {
      let state: DisplayPoint["state"] = "pending";
      if (current != null && current >= target) state = "triggered";
      points.push({ label: "Target", value: fmt$(target), state });
      if (state === "triggered" && current != null && shares > 0) {
        const profit = shares * (current - entry);
        alerts.push({
          severity: "watch",
          action: "take-partial",
          actionShares: shares,
          actionLabel: `Take profit (${shares})`,
          message: `Target ${fmt$(target)} hit. Position up ${fmt$0(profit)} — take profit on all ${shares} shares, or trail under 20-MA.`,
        });
      }
    }

    // Pole + flag context (informational)
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

    // Current %-from-entry + $ unrealized
    const pctFromEntry = pctChange(entry, current);
    if (pctFromEntry != null) {
      const unrealized = current != null && shares > 0 ? shares * (current - entry) : null;
      points.push({
        label: "vs entry",
        value: unrealized != null ? `${fmtPct(pctFromEntry)} (${fmt$0(unrealized)})` : fmtPct(pctFromEntry),
        state: pctFromEntry >= 0 ? "past" : "pending",
      });
    }

    return { displayPoints: points, alerts };
  },
};

/**
 * Wyckoff Spring — Accumulation-phase false breakdown reversal.
 * Lifecycle: Entry @ next open after SOS bar → Stop @ spring_low × 0.98 →
 * Take 1/3 after 2 consecutive daily closes above entry × 1.10 → Trail
 * remaining 2/3 below 20-day MA after partial fires.
 *
 * Test bar REQUIRED at detection (validated 2026-05-21 — tested cohort
 * earns $44.10/trade vs $24.81/trade untested across 491-ticker / 10y
 * basket; full strategy clears acceptance gate at 58.7% WR / $10,362
 * basket P&L / 235 trades).
 */
const WYCKOFF_SPRING_MANIFEST: StrategyManifest = {
  id: "wyckoff-spring",
  name: "Wyckoff Spring",
  shortName: "Spring",
  description: "False breakdown at trading-range bottom → SOS reversal (Wyckoff accumulation)",
  color: "bull",
  requiresReason: false,
  columnOrder: ["Stop", "Take 1/3", "Took 1/3", "Trail 20-MA", "Target", "TR range", "Spring"],
  evaluate(trade) {
    const data = trade.strategyData ?? {};
    const live = trade.lifecycleState ?? {};
    const entry = Math.abs(trade.openPrice);
    const current = trade.currentPrice;
    const shares = trade.contractsShares ?? 0;
    const stop = typeof data.stopPrice === "number" ? data.stopPrice : null;
    const target = (typeof data.targetPrice === "number" ? data.targetPrice : null)
      ?? (trade.target != null && trade.target > entry ? trade.target : null);
    const partialThreshold = entry * 1.10; // 2 consecutive closes above this
    const ma20 = typeof live.currentMa20 === "number" ? live.currentMa20
      : typeof data.ma20 === "number" ? data.ma20
      : null;
    const partialDone = live.partialDone === true || data.partialDone === true;
    const partialPriceLive = typeof live.partialPrice === "number" ? live.partialPrice : null;
    const partialDateLive = typeof live.partialDate === "string" ? live.partialDate : null;
    const currentGainDays = typeof live.currentGainDays === "number" ? live.currentGainDays : 0;

    const oneThirdShares = Math.max(0, Math.floor(shares / 3));
    const twoThirdsShares = Math.max(0, shares - oneThirdShares);

    const points: DisplayPoint[] = [];
    const alerts: LifecycleAlert[] = [];

    points.push({
      label: "Entry",
      value: shares > 0 ? `${shares} @ ${fmt$(entry)}` : fmt$(entry),
      state: "past",
    });

    if (stop != null) {
      const dollarsAtRisk = shares > 0 ? Math.max(0, shares * (entry - stop)) : null;
      let state: DisplayPoint["state"] = "pending";
      if (current != null && current <= stop) state = "triggered";
      else if (current != null && current <= stop * 1.03) state = "armed";
      points.push({
        label: "Stop",
        value: dollarsAtRisk != null ? `${fmt$(stop)} (risk ${fmt$0(dollarsAtRisk)})` : fmt$(stop),
        state,
      });
      if (state === "triggered") {
        const dollarLoss = current != null && shares > 0 ? shares * (entry - current) : null;
        alerts.push({
          severity: "critical",
          action: "dump",
          actionShares: shares > 0 ? shares : null,
          actionLabel: shares > 0 ? `DUMP ${shares}` : "DUMP",
          message: shares > 0 && dollarLoss != null
            ? `STOP HIT. Exit all ${shares} shares now — locks ${fmt$0(-dollarLoss)} loss`
            : `Stop hit ${fmt$(current!)} ≤ ${fmt$(stop)} — exit now`,
        });
      } else if (state === "armed") {
        alerts.push({
          severity: "warn",
          action: "hold",
          actionShares: null,
          message: `Within 3% of stop ${fmt$(stop)} — be ready to exit ${shares} shares`,
        });
      }
    }

    // Take 1/3 — 2 consecutive daily closes above entry × 1.10. Tracked by
    // the server's lifecycle walker (currentGainDays); falls back to a
    // threshold-only "armed when above the line" display if missing.
    if (!partialDone) {
      let state: DisplayPoint["state"] = "pending";
      if (currentGainDays > 0) state = "armed";
      else if (current != null && current > partialThreshold) state = "armed";
      const valueText = oneThirdShares > 0
        ? currentGainDays > 0
          ? `${oneThirdShares} sh · ${currentGainDays}/2 +10% days`
          : `${oneThirdShares} sh above ${fmt$(partialThreshold)}`
        : `Above ${fmt$(partialThreshold)}`;
      points.push({ label: "Take 1/3", value: valueText, state });
      if (currentGainDays >= 2 && current != null && oneThirdShares > 0) {
        const profitPerShare = current - entry;
        const lockedIn = oneThirdShares * profitPerShare;
        alerts.push({
          severity: "watch",
          action: "take-partial",
          actionShares: oneThirdShares,
          actionLabel: `Sell ${oneThirdShares}`,
          message: `2nd +10% close completed. Sell ${oneThirdShares} shares to lock in ${fmt$0(lockedIn)} profit (1/3 of position). Remaining ${twoThirdsShares} trail under 20-MA.`,
        });
      }
    } else {
      const lockedAt = partialPriceLive != null ? ` @ ${fmt$(partialPriceLive)}` : "";
      const onDate = partialDateLive ? ` on ${partialDateLive}` : "";
      points.push({
        label: "Took 1/3",
        value: `✓${lockedAt}${onDate}`,
        state: "past",
      });
    }

    // Trail 20-MA — alerts fire only post-partial (identical to HTF).
    {
      let state: DisplayPoint["state"] = "pending";
      if (ma20 != null && current != null) {
        if (current < ma20) state = partialDone ? "triggered" : "armed";
        else if (current < ma20 * 1.02) state = "armed";
      }
      const valueText = ma20 != null
        ? partialDone
          ? `Exit below ${fmt$(ma20)}`
          : `20-MA ${fmt$(ma20)}`
        : "computing…";
      points.push({ label: "Trail 20-MA", value: valueText, state });

      if (partialDone && ma20 != null && current != null && current < ma20) {
        const remainingProfit = twoThirdsShares > 0 ? twoThirdsShares * (current - entry) : null;
        alerts.push({
          severity: "critical",
          action: "exit",
          actionShares: twoThirdsShares > 0 ? twoThirdsShares : null,
          actionLabel: twoThirdsShares > 0 ? `Close ${twoThirdsShares}` : "Close",
          message: remainingProfit != null
            ? `EXIT REMAINING. Close ${fmt$(current)} below 20-MA ${fmt$(ma20)} — sell final ${twoThirdsShares} shares (${fmt$0(remainingProfit)} profit on this lot).`
            : `Close below 20-MA — exit remaining 2/3`,
        });
      } else if (partialDone && ma20 != null && current != null && current < ma20 * 1.02) {
        alerts.push({
          severity: "warn",
          action: "hold",
          actionShares: null,
          message: `Within 2% of 20-MA (${fmt$(ma20)}) — ready to exit remaining ${twoThirdsShares} on close below.`,
        });
      }
    }

    if (target != null) {
      let state: DisplayPoint["state"] = "pending";
      if (current != null && current >= target) state = "triggered";
      points.push({ label: "Target", value: fmt$(target), state });
      if (state === "triggered" && current != null && shares > 0) {
        const profit = shares * (current - entry);
        alerts.push({
          severity: "watch",
          action: "take-partial",
          actionShares: shares,
          actionLabel: `Take profit (${shares})`,
          message: `Target ${fmt$(target)} hit. Position up ${fmt$0(profit)} — take profit on all ${shares}, or trail under 20-MA.`,
        });
      }
    }

    // TR range + Spring context (informational; locked at entry).
    if (typeof data.trHigh === "number" && typeof data.trLow === "number") {
      points.push({
        label: "TR range",
        value: `${fmt$(data.trLow)} – ${fmt$(data.trHigh)}`,
        state: "past",
      });
    }
    if (typeof data.springLow === "number") {
      const testStr = data.hasTest === true ? " ✓ tested" : "";
      points.push({
        label: "Spring",
        value: `${fmt$(data.springLow)}${testStr}`,
        state: "past",
      });
    }

    const pctFromEntry = pctChange(entry, current);
    if (pctFromEntry != null) {
      const unrealized = current != null && shares > 0 ? shares * (current - entry) : null;
      points.push({
        label: "vs entry",
        value: unrealized != null ? `${fmtPct(pctFromEntry)} (${fmt$0(unrealized)})` : fmtPct(pctFromEntry),
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
  columnOrder: ["Stop (EXIT)", "Exit trigger", "Target"],
  chartBacktest: {
    label: "BBTC + VER",
    description: "Current website Ready/Set/Go strategy",
  },
  evaluate(trade) {
    const data = trade.strategyData ?? {};
    const entry = Math.abs(trade.openPrice);
    const current = trade.currentPrice;
    const shares = trade.contractsShares ?? 0;
    const stop = typeof data.stopPrice === "number" ? data.stopPrice : null;
    const target = (typeof data.targetPrice === "number" ? data.targetPrice : null)
      ?? (trade.target != null && trade.target > entry ? trade.target : null);
    const exitTrigger = typeof data.exitTrigger === "number" ? data.exitTrigger : null;

    const points: DisplayPoint[] = [];
    const alerts: LifecycleAlert[] = [];

    points.push({
      label: "Entry",
      value: shares > 0 ? `${shares} @ ${fmt$(entry)}` : fmt$(entry),
      state: "past",
    });

    if (stop != null) {
      const dollarsAtRisk = shares > 0 ? Math.max(0, shares * (entry - stop)) : null;
      let state: DisplayPoint["state"] = "pending";
      if (current != null && current <= stop) state = "triggered";
      else if (current != null && current <= stop * 1.03) state = "armed";
      points.push({
        label: "Stop (EXIT)",
        value: dollarsAtRisk != null ? `${fmt$(stop)} (risk ${fmt$0(dollarsAtRisk)})` : fmt$(stop),
        state,
      });
      if (state === "triggered") {
        const dollarLoss = current != null && shares > 0 ? shares * (entry - current) : null;
        alerts.push({
          severity: "critical",
          action: "exit",
          actionShares: shares > 0 ? shares : null,
          actionLabel: shares > 0 ? `Close ${shares}` : "Close",
          message: shares > 0 && dollarLoss != null
            ? `STOP HIT. Exit ${shares} shares now — locks ${fmt$0(-dollarLoss)} loss`
            : `Stop hit ${fmt$(current!)} ≤ ${fmt$(stop)} — exit now`,
        });
      } else if (state === "armed") {
        alerts.push({
          severity: "warn",
          action: "hold",
          actionShares: null,
          message: `Within 3% of stop ${fmt$(stop)} — ready to exit ${shares} shares`,
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
          actionShares: shares > 0 ? shares : null,
          actionLabel: shares > 0 ? `Close ${shares}` : "Close",
          message: shares > 0
            ? `Exit-trigger hit. Close ${shares} shares.`
            : `Exit-trigger price hit — close the position`,
        });
      }
    }

    if (target != null) {
      let state: DisplayPoint["state"] = "pending";
      if (current != null && current >= target) state = "triggered";
      points.push({ label: "Target", value: fmt$(target), state });
      if (state === "triggered" && current != null && shares > 0) {
        const profit = shares * (current - entry);
        alerts.push({
          severity: "watch",
          action: "take-partial",
          actionShares: shares,
          actionLabel: `Take profit (${shares})`,
          message: `Target ${fmt$(target)} hit. Up ${fmt$0(profit)} on ${shares} shares — exit or trail.`,
        });
      }
    }

    const pctFromEntry = pctChange(entry, current);
    if (pctFromEntry != null) {
      const unrealized = current != null && shares > 0 ? shares * (current - entry) : null;
      points.push({
        label: "vs entry",
        value: unrealized != null ? `${fmtPct(pctFromEntry)} (${fmt$0(unrealized)})` : fmtPct(pctFromEntry),
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
  columnOrder: ["40W SMA", "−15% stop"],
  chartBacktest: {
    label: "TFT 40W",
    description: "Two-Layer Trend Continuation, weekly 40W SMA stop",
  },
  evaluate(trade) {
    const data = trade.strategyData ?? {};
    const entry = Math.abs(trade.openPrice);
    const current = trade.currentPrice;
    const shares = trade.contractsShares ?? 0;
    const sma40w = typeof data.sma40w === "number" ? data.sma40w : null;
    const catastrophicStop = entry * 0.85; // -15% from entry

    const points: DisplayPoint[] = [];
    const alerts: LifecycleAlert[] = [];

    points.push({
      label: "Entry",
      value: shares > 0 ? `${shares} @ ${fmt$(entry)}` : fmt$(entry),
      state: "past",
    });

    if (sma40w != null) {
      let state: DisplayPoint["state"] = "pending";
      if (current != null && current < sma40w) state = "triggered";
      points.push({ label: "40W SMA", value: fmt$(sma40w), state });
      if (state === "triggered") {
        alerts.push({
          severity: "warn",
          action: "exit",
          actionShares: shares > 0 ? shares : null,
          actionLabel: shares > 0 ? `Close ${shares}` : "Close core",
          message: shares > 0
            ? `Weekly close below 40W — exit ${shares}-share core position`
            : `Weekly close below 40W — exit core position`,
        });
      }
    }

    const dollarsAtRisk = shares > 0 ? shares * (entry - catastrophicStop) : null;
    let catState: DisplayPoint["state"] = "pending";
    if (current != null && current <= catastrophicStop) catState = "triggered";
    else if (current != null && current <= catastrophicStop * 1.03) catState = "armed";
    points.push({
      label: "−15% stop",
      value: dollarsAtRisk != null ? `${fmt$(catastrophicStop)} (risk ${fmt$0(dollarsAtRisk)})` : fmt$(catastrophicStop),
      state: catState,
    });
    if (catState === "triggered") {
      const dollarLoss = current != null && shares > 0 ? shares * (entry - current) : null;
      alerts.push({
        severity: "critical",
        action: "dump",
        actionShares: shares > 0 ? shares : null,
        actionLabel: shares > 0 ? `DUMP ${shares}` : "DUMP",
        message: shares > 0 && dollarLoss != null
          ? `CATASTROPHIC STOP (−15%). Exit ${shares} shares — locks ${fmt$0(-dollarLoss)} loss`
          : `Catastrophic stop hit (−15% from entry) — dump now`,
      });
    }

    const pctFromEntry = pctChange(entry, current);
    if (pctFromEntry != null) {
      const unrealized = current != null && shares > 0 ? shares * (current - entry) : null;
      points.push({
        label: "vs entry",
        value: unrealized != null ? `${fmtPct(pctFromEntry)} (${fmt$0(unrealized)})` : fmtPct(pctFromEntry),
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
  chartBacktest: {
    label: "TFT 60W",
    description: "TFT with slower 60W stop",
  },
};

const TFT_CAT_MANIFEST: StrategyManifest = {
  ...TFT_40W_MANIFEST,
  id: "tft-cat",
  name: "TFT (catastrophic-only)",
  shortName: "TFT-CAT",
  description: "Two-layer trend follower — core exits only on −15% stop",
  chartBacktest: {
    label: "TFT Catastrophic",
    description: "TFT, core only exits on −15% catastrophic. Maximum moonshot capture",
  },
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
  columnOrder: ["Stop (EXIT)", "Exit trigger", "Target"],
  chartBacktest: {
    label: "AMC only",
    description: "Adaptive Momentum Confluence (the 'Set' indicator alone)",
  },
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
  columnOrder: ["Target"],
  evaluate(trade) {
    const points: DisplayPoint[] = [];
    const entry = Math.abs(trade.openPrice);
    const shares = trade.contractsShares ?? 0;
    points.push({
      label: "Entry",
      value: shares > 0 ? `${shares} @ ${fmt$(entry)}` : fmt$(entry),
      state: "past",
    });
    if (trade.target != null && trade.target > entry) {
      let state: DisplayPoint["state"] = "pending";
      if (trade.currentPrice != null && trade.currentPrice >= trade.target) state = "triggered";
      points.push({ label: "Target", value: fmt$(trade.target), state });
    }
    const pct = pctChange(entry, trade.currentPrice);
    if (pct != null) {
      const unrealized = trade.currentPrice != null && shares > 0
        ? shares * (trade.currentPrice - entry)
        : null;
      points.push({
        label: "vs entry",
        value: unrealized != null ? `${fmtPct(pct)} (${fmt$0(unrealized)})` : fmtPct(pct),
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
  columnOrder: ["Target"],
  evaluate: MANUAL_MANIFEST.evaluate,
};

/**
 * Markov v2 — research-stage HMM regime model with vol-targeted sizing.
 *
 * Reference implementation lives at `backend/patterns/markov_trading_v2.py`
 * (Python + hmmlearn). Surfaces under /wheel's Experimental Strategies
 * section so Chris can track it without forcing a premature TypeScript port
 * of the EM/Baum-Welch math. When ready to promote: port the regime fitter
 * + transition-matrix-driven position sizing to a server signal under
 * `server/signals/strategies/markov.ts` and flip `experimental` off.
 *
 * Until then `evaluate()` returns a stub so the Add Trade dropdown can
 * include it for paper-tracking trades the user takes manually.
 */
const MARKOV_V2_MANIFEST: StrategyManifest = {
  id: "markov-v2",
  name: "Markov Regime v2 (Experimental)",
  shortName: "MARKOV",
  description: "HMM regime model + vol-targeted sizing + transaction costs. Research-stage; port from Python reference pending.",
  color: "info",
  requiresReason: false,
  columnOrder: ["Regime", "Target"],
  experimental: true,
  pageGroup: "wheel",
  evaluate(trade) {
    const entry = Math.abs(trade.openPrice);
    const points = [{
      label: "Entry",
      value: trade.contractsShares != null ? `${trade.contractsShares} @ ${fmt$(entry)}` : fmt$(entry),
      state: "past" as const,
    }];
    if (trade.currentPrice != null) {
      const pct = pctChange(entry, trade.currentPrice);
      if (pct != null) {
        points.push({
          label: "vs entry",
          value: fmtPct(pct),
          state: pct >= 0 ? "past" : "pending",
        });
      }
    }
    return { displayPoints: points, alerts: [] };
  },
};

// ─── Registry ─────────────────────────────────────────────────────────────

export const STRATEGY_REGISTRY: Record<string, StrategyManifest> = {
  htf: HTF_MANIFEST,
  "wyckoff-spring": WYCKOFF_SPRING_MANIFEST,
  "bbtc-ver": BBTC_VER_MANIFEST,
  "tft-40w": TFT_40W_MANIFEST,
  "tft-60w": TFT_60W_MANIFEST,
  "tft-cat": TFT_CAT_MANIFEST,
  amc: AMC_MANIFEST,
  "markov-v2": MARKOV_V2_MANIFEST,
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
