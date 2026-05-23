/**
 * Scanner v2 compartment — "Explosion Detector"
 *
 * Canonical accessor wrapping `runScannerV2` from `server/scanner-v2.ts`.
 * Pages, dashboard widgets, alert rules, and future consumers all import
 * `scannerData` from here — no parallel fetches into `server/scanner-v2.ts`.
 *
 * Routes (`/api/scanner/v2`, `/api/scanner-v2/quick/:ticker`) still live
 * in legacy `server/routes.ts:4006-4047, 4228-4259` during strangler
 * migration; a follow-up round moves them here behind `mountRoutes`.
 */
import { runScannerV2, type ScannerV2Filters, type ScannerV2Response, type ScannerV2Row } from "../../scanner-v2";
import type { ServerCompartmentEntry, CompartmentMeta } from "../types";

const meta: CompartmentMeta = {
  id: "scanner-v2",
  name: "Scanner v2 — Best Opps",
  tier: "free",
  fullPageRoute: "/scanner",
  description: "Confluence-based explosion detector. Returns top scoring tickers with per-signal breakdown.",
};

/**
 * Canonical data accessor — every consumer of scanner-v2 data goes through
 * here. Forwarding-only wrapper for now; future logic (caching policy,
 * tier-aware throttling, etc.) lives here without changing call sites.
 */
export const scannerData = {
  run(filters: ScannerV2Filters): Promise<ScannerV2Response> {
    return runScannerV2(filters);
  },
};

export const scannerCompartment: ServerCompartmentEntry = {
  meta,
};

export { meta };
export type { ScannerV2Filters, ScannerV2Response, ScannerV2Row };
