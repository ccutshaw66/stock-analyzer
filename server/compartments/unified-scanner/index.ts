/**
 * Unified Scanner server compartment — one scanner across every quality-scored
 * strategy. Routes live in ./routes.ts and are mounted via mountRoutes().
 */
import type { ServerCompartmentEntry, CompartmentMeta } from "../types";
import { mountRoutes } from "./routes";

const meta: CompartmentMeta = {
  id: "unified-scanner",
  name: "Unified Scanner",
  tier: "free",
  fullPageRoute: "/scanner",
  description: "One scanner across every strategy; required filters + green-grade (80+) gate.",
};

export const unifiedScannerCompartment: ServerCompartmentEntry = {
  meta,
  mountRoutes,
};

export { meta };
