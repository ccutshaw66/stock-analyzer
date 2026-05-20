/**
 * HTF Scanner compartment — High Tight Flag pattern detector + nightly scan.
 *
 * Canonical data accessor: `htfScannerData`. Pages, widgets, and alert rules
 * import from here — never reach into `orchestrator.ts` or the DB directly.
 *
 * Routes are mounted by `mountRoutes` (defined in `./routes.ts`) which the
 * registry calls during server startup.
 */

import type { ServerCompartmentEntry, CompartmentMeta } from "../types";
import { and, asc, desc, eq, gte } from "drizzle-orm";
import { db } from "../../storage";
import { htfSetups, type HtfSetup } from "@shared/schema";
import { runHtfScan, type HtfScanOptions, type HtfScanSummary } from "./orchestrator";
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
    "Detects 30%+ pole / 25%-pullback flag breakouts on the US small/mid-cap universe and emits position-sized setups for $7K-account swing trading.",
};

export interface HtfSetupsQuery {
  runDate?: string;        // YYYY-MM-DD; defaults to latest available
  minScore?: number;       // default 0
  actionableOnly?: boolean;
  symbol?: string;
  /**
   * If supplied, recompute sizing + actionable flag against this config +
   * portfolio at read time. Lets the Config tab edits flow through without
   * needing to re-run the nightly scan.
   */
  config?: AccountConfig;
  portfolio?: PortfolioState;
}

/** Reconstruct just enough of an HtfHit from a stored row to re-size it. */
function rowToHit(row: HtfSetup): HtfHit {
  return {
    symbol: row.symbol,
    pattern: "HTF_Givens",
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
      flagLow: row.stopPrice / 0.98,    // stop = flagLow × 0.98 in scanHtf
      flagPullbackPct: row.flagPullbackPct,
      breakoutVolRatio: row.breakoutVolRatio,
    },
  };
}

/**
 * Override the sizing snapshot stored at scan time with a live recompute
 * against `config` + `portfolio`. Returns a new row object — never mutates
 * the DB record. Callers that don't pass config get the stored snapshot.
 */
export function resizeSetup(
  row: HtfSetup,
  config: AccountConfig,
  portfolio: PortfolioState,
): HtfSetup {
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

async function latestRunDate(): Promise<string | null> {
  const rows = await db
    .select({ runDate: htfSetups.runDate })
    .from(htfSetups)
    .orderBy(desc(htfSetups.runDate))
    .limit(1);
  return rows[0]?.runDate ?? null;
}

export const htfScannerData = {
  /** Trigger a scan. Wraps the orchestrator so call sites don't import deep. */
  runScan(opts: HtfScanOptions = {}): Promise<HtfScanSummary> {
    return runHtfScan(opts);
  },

  /**
   * Read setups for a given run, with optional filters. If `config` is
   * supplied, sizing + actionable status are recomputed live so the Config
   * tab edits flow through without a re-scan. The actionable filter and
   * the minScore filter are applied AFTER the live resize.
   */
  async getSetups(q: HtfSetupsQuery = {}): Promise<HtfSetup[]> {
    const runDate = q.runDate ?? (await latestRunDate());
    if (!runDate) return [];
    const conditions = [eq(htfSetups.runDate, runDate)];
    if (q.minScore !== undefined) conditions.push(gte(htfSetups.qualityScore, q.minScore));
    if (q.symbol) conditions.push(eq(htfSetups.symbol, q.symbol.toUpperCase()));
    let rows = await db
      .select()
      .from(htfSetups)
      .where(and(...conditions))
      .orderBy(desc(htfSetups.qualityScore), asc(htfSetups.symbol));
    if (q.config) {
      const portfolio = q.portfolio ?? new PortfolioState();
      rows = rows.map(r => resizeSetup(r, q.config!, portfolio));
    }
    if (q.actionableOnly) {
      rows = rows.filter(r => r.actionable);
    }
    return rows;
  },

  /** Most recent run date that has rows in the DB. */
  latestRunDate,
};

export const htfScannerCompartment: ServerCompartmentEntry = {
  meta,
  mountRoutes,
};

export { meta };
export type { HtfScanSummary };
