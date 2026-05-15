/**
 * Server-side compartment entry. Defines what each compartment contributes
 * to the server registry (manifest + optional route-mounting hook).
 *
 * The canonical data accessor is exported as a named export from each
 * compartment's `index.ts` (e.g. `favoritesData`); it is not enumerated in
 * this entry, mirroring how `server/compartments/search/index.ts` exports
 * `searchTickers` directly.
 */
import type { Express } from "express";
import type { CompartmentMeta } from "@shared/compartments/types";

export interface ServerCompartmentEntry {
  meta: CompartmentMeta;
  /**
   * Optional: mount HTTP routes for this compartment. Called once during
   * server startup from `server/compartments/registry.ts`. Compartments
   * whose routes still live in legacy `server/routes.ts` may omit this
   * until they migrate.
   */
  mountRoutes?: (app: Express) => void;
}

export type { CompartmentMeta };
