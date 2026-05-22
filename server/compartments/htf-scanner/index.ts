/**
 * HTF Scanner compartment — High Tight Flag pattern detector, live read.
 *
 * Canonical data accessor: `htfScannerData`. Pages, widgets, and alert rules
 * import from here — never reach into `orchestrator.ts` directly.
 *
 * There is no scan history. There's one in-memory snapshot of "what's firing
 * right now," refreshed on demand. Older runs aren't stored anywhere.
 *
 * Routes are mounted by `mountRoutes` (defined in `./routes.ts`) which the
 * registry calls during server startup.
 */

import type { ServerCompartmentEntry, CompartmentMeta } from "../types";
import {
  getLiveSetups,
  runHtfScan,
  peekLatestScan,
  invalidateScanCache,
  type HtfScanOptions,
  type HtfScanResult,
  type HtfLiveSetupRow,
} from "./orchestrator";
import { mountRoutes } from "./routes";
import {
  sizePosition,
  PortfolioState,
  type AccountConfig,
  type PositionRecommendation,
} from "../../signals/risk/position-sizing";
import type { HtfHit } from "../../signals/strategies/htf";

const meta: CompartmentMeta = {
  id: "htf-scanner",
  name: "HTF Scanner — High Tight Flag",
  tier: "free",
  fullPageRoute: "/htf",
  description:
    "Detects 30%+ pole / 25%-pullback flag breakouts firing right now on the US small/mid-cap universe.",
};

export interface HtfSetupsQuery {
  minScore?: number;
  actionableOnly?: boolean;
  symbol?: string;
  /** "fired" = breakout already fired; "forming" = still consolidating. */
  stage?: "fired" | "forming";
  /** When set, recompute sizing + actionable against this config + portfolio. */
  config?: AccountConfig;
  portfolio?: PortfolioState;
  /** Force a fresh scan even if the cache is warm. */
  forceRefresh?: boolean;
}

/** Reconstruct just enough of an HtfHit from a row to re-size it. */
function rowToHit(row: HtfLiveSetupRow): HtfHit {
  return {
    symbol: row.symbol,
    pattern: row.pattern === "HTF_Givens_Forming" ? "HTF_Givens_Forming" : "HTF_Givens",
    direction: "long",
    breakoutDate: new Date(row.breakoutDate),
    breakoutPrice: row.breakoutPrice,
    targetPrice: row.targetPrice,
    stopPrice: row.stopPrice,
    qualityScore: row.qualityScore,
    patternStart: new Date(row.breakoutDate),
    patternEnd: new Date(row.breakoutDate),
    extras: {
      poleStartPrice: 0,
      poleEndPrice: 0,
      poleGainPct: row.poleGainPct,
      poleDays: row.poleDays,
      flagDays: row.flagDays,
      flagHigh: 0,
      flagLow: row.stopPrice / 0.98,
      flagPullbackPct: row.flagPullbackPct,
      breakoutVolRatio: row.breakoutVolRatio,
      // Overhead-resistance fields added in commit e79f3e8 (info-only).
      // resizeSetup doesn't actually re-detect resistance — these are
      // safe defaults that don't affect sizing math.
      hasOverheadResistance: false,
      nearestResistancePct: 0,
    },
  };
}

/**
 * Override the sizing values from the scan-time row with a live recompute
 * against `config` + `portfolio`. The scan emits sizing using whatever
 * config was active when it ran; this lets the page resize without rescanning.
 */
export function resizeSetup(
  row: HtfLiveSetupRow,
  config: AccountConfig,
  portfolio: PortfolioState,
): HtfLiveSetupRow {
  const hit = rowToHit(row);
  const rec: PositionRecommendation = sizePosition(hit, config);
  const sector = row.sector ?? "Unknown";
  const check = portfolio.canAddPosition(rec, hit, config, sector);
  const actionable = rec.blockedReason === null && check.allowed;
  const blockedReason =
    rec.blockedReason ?? (check.allowed ? null : check.reason);
  return {
    ...row,
    recommendedShares: rec.recommendedShares,
    positionValue: rec.positionValue,
    actualRisk: rec.actualRisk,
    rewardRiskRatio: rec.rewardRiskRatio,
    actionable,
    blockedReason,
    warnings: rec.warnings,
  };
}

export interface LiveSetupsResponse {
  scannedAt: Date | null;
  durationMs: number;
  universeSize: number;
  rows: HtfLiveSetupRow[];
}

export const htfScannerData = {
  /** Force a fresh scan. Replaces the in-memory cache. */
  runScan(opts: HtfScanOptions = {}): Promise<HtfScanResult> {
    return runHtfScan(opts);
  },

  /**
   * Read the latest live setups. Triggers a scan if the cache is stale or
   * missing. Sizing + actionable flag are recomputed live against
   * `q.config` + `q.portfolio` when supplied so Config tab edits propagate
   * without a re-scan.
   */
  async getSetups(q: HtfSetupsQuery = {}): Promise<LiveSetupsResponse> {
    const scan = q.forceRefresh
      ? await runHtfScan({ config: q.config, portfolio: q.portfolio })
      : await getLiveSetups({ config: q.config, portfolio: q.portfolio });

    let rows: HtfLiveSetupRow[] = scan.rows;
    if (q.minScore !== undefined) {
      rows = rows.filter(r => r.qualityScore >= q.minScore!);
    }
    if (q.symbol) {
      const want = q.symbol.toUpperCase();
      rows = rows.filter(r => r.symbol === want);
    }
    if (q.stage) {
      const wantForming = q.stage === "forming";
      rows = rows.filter(r => (r.pattern === "HTF_Givens_Forming") === wantForming);
    }
    if (q.config) {
      const portfolio = q.portfolio ?? new PortfolioState();
      rows = rows.map(r => resizeSetup(r, q.config!, portfolio));
    }
    if (q.actionableOnly) {
      rows = rows.filter(r => r.actionable);
    }
    // Sort: highest quality, then symbol
    rows.sort((a, b) =>
      b.qualityScore !== a.qualityScore
        ? b.qualityScore - a.qualityScore
        : a.symbol.localeCompare(b.symbol),
    );
    return {
      scannedAt: scan.scannedAt,
      durationMs: scan.durationMs,
      universeSize: scan.universeSize,
      rows,
    };
  },

  /** Snapshot of the cache without triggering a scan. */
  peek(): HtfScanResult | null {
    return peekLatestScan();
  },

  /** Drop the in-memory cache. */
  invalidate(): void {
    invalidateScanCache();
  },
};

export const htfScannerCompartment: ServerCompartmentEntry = {
  meta,
  mountRoutes,
};

export { meta };
export type { HtfScanResult };
