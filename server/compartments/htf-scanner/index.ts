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

  /** Read setups for a given run, with optional filters. */
  async getSetups(q: HtfSetupsQuery = {}): Promise<HtfSetup[]> {
    const runDate = q.runDate ?? (await latestRunDate());
    if (!runDate) return [];
    const conditions = [eq(htfSetups.runDate, runDate)];
    if (q.actionableOnly) conditions.push(eq(htfSetups.actionable, true));
    if (q.minScore !== undefined) conditions.push(gte(htfSetups.qualityScore, q.minScore));
    if (q.symbol) conditions.push(eq(htfSetups.symbol, q.symbol.toUpperCase()));
    return db
      .select()
      .from(htfSetups)
      .where(and(...conditions))
      .orderBy(desc(htfSetups.qualityScore), asc(htfSetups.symbol));
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
