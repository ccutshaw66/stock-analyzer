/**
 * Favorites compartment — client side. Manifest + Widget view.
 *
 * Full-page consumers continue to use `client/src/components/FavoritesPanel.tsx`
 * during the strangler migration; that component is the future `FullView`
 * once it migrates to call `useFavorites` directly.
 */
import type { ClientCompartmentEntry, CompartmentMeta } from "../types";
import { TILE_SM, TILE_MIN_SM } from "@/lib/layout-tokens";
import { WatchlistWidget } from "./WatchlistWidget";

const meta: CompartmentMeta = {
  id: "favorites",
  name: "Favorites / Watchlist",
  tier: "free",
  description: "Per-user watchlist + portfolio ticker lists with verdict/score.",
};

export const favoritesCompartment: ClientCompartmentEntry = {
  meta,
  WidgetView: WatchlistWidget,
  widgetDefaultSize: TILE_SM,
  widgetMinSize: TILE_MIN_SM,
};

export { meta, WatchlistWidget };
export { useFavorites, type FavoriteItem, type FavoritesListType } from "./useFavorites";
