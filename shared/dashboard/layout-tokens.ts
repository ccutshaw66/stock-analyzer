/**
 * Layout tokens — named tile sizes for the dashboard grid.
 *
 * Single source of truth for compartment widget dimensions. Compartment
 * manifests reference these named slots instead of raw `{ w, h }` numbers,
 * and `server/dashboard/layout.ts` reads positions from here too.
 *
 * Lives in `shared/` so both client compartments AND server-side default-
 * layout code can import the same values. Change a slot here, every tile
 * using it updates on next deploy — that's the compartmentalization payoff.
 */

export interface TileSize {
  readonly w: number;
  readonly h: number;
}

/** Small tile — narrow watchlist / signal pulse. */
export const TILE_SM: TileSize = { w: 3, h: 4 };

/** Medium tile — scanners, charts, dashboards. */
export const TILE_MD: TileSize = { w: 4, h: 4 };

/** Large tile — full-width tables, multi-pane charts. */
export const TILE_LG: TileSize = { w: 6, h: 6 };

/** Full row — page-wide content (advisory strip, hero). */
export const TILE_FULL: TileSize = { w: 12, h: 4 };

/** Min sizes by tile class — what a tile can shrink to. */
export const TILE_MIN_SM: TileSize = { w: 2, h: 3 };
export const TILE_MIN_MD: TileSize = { w: 3, h: 3 };
export const TILE_MIN_LG: TileSize = { w: 4, h: 4 };
