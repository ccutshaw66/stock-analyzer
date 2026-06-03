/**
 * Compartment contract — universal manifest type.
 *
 * A compartment is a self-contained feature module exposing one canonical
 * data accessor + pure logic layer + at least two presentation modes
 * (Full view + Widget view). Lives end-to-end: server module → client hook →
 * components → registry entry.
 *
 * This file is import-safe from both server and client (no React, no Express).
 * Side-specific extensions live in `server/compartments/types.ts` and
 * `client/src/compartments/types.ts`.
 *
 * See `docs/MASTER_PATHWAY.md` Phase 1B for the full contract.
 */

export type CompartmentTier = "free" | "pro" | "elite" | "owner";

export interface CompartmentMeta {
  /** Stable id used by registries, persistence schemas, and tier middleware. */
  id: string;
  /** Human-readable name shown in widget headers and admin UI. */
  name: string;
  /** Minimum subscription tier required to use this compartment. */
  tier: CompartmentTier;
  /** Optional route for the Full view. Omit for server-only compartments. */
  fullPageRoute?: string;
  /** One-line description for admin/dev surfaces. */
  description?: string;
}
