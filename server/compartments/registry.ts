/**
 * Server compartment registry. Imports each compartment's entry and exposes
 * lookup helpers. Adding a new compartment is two lines: one import below
 * and one entry in `serverCompartments`.
 *
 * See `docs/MASTER_PATHWAY.md` Phase 1B + `docs/DASHBOARD_PLAN.md` P3 for
 * the contract this registry enforces.
 */
import type { Express } from "express";
import type { ServerCompartmentEntry } from "./types";
import { favoritesCompartment } from "./favorites";
import { scannerCompartment } from "./scanner";
import { tradesCompartment } from "./trades";
import { htfScannerCompartment } from "./htf-scanner";

const serverCompartments: ServerCompartmentEntry[] = [
  favoritesCompartment,
  scannerCompartment,
  tradesCompartment,
  htfScannerCompartment,
];

export function listServerCompartments(): readonly ServerCompartmentEntry[] {
  return serverCompartments;
}

export function getServerCompartment(id: string): ServerCompartmentEntry | undefined {
  return serverCompartments.find((c) => c.meta.id === id);
}

/**
 * Wire every compartment's HTTP routes (if any) into the Express app.
 * Called once from `server/routes.ts` during startup. Compartments whose
 * routes still live in legacy `server/routes.ts` simply have no
 * `mountRoutes` and are skipped here.
 */
export function mountAllCompartmentRoutes(app: Express): void {
  for (const c of serverCompartments) {
    c.mountRoutes?.(app);
  }
}
