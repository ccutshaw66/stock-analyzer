/**
 * Re-exports the canonical layout tokens from `shared/dashboard/layout-tokens`.
 *
 * Why re-export: client code uses `@/lib/layout-tokens` for ergonomics, but
 * the source of truth is in `shared/` so server-side default-layout code
 * imports the same values. Don't add new tokens here — put them in
 * `shared/dashboard/layout-tokens.ts`.
 */
export {
  TILE_SM,
  TILE_MD,
  TILE_LG,
  TILE_FULL,
  TILE_MIN_SM,
  TILE_MIN_MD,
  TILE_MIN_LG,
  type TileSize,
} from "@shared/dashboard/layout-tokens";
