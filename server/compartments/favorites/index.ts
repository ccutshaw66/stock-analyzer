/**
 * Favorites compartment — per-user watchlist + portfolio ticker lists.
 *
 * This is the worked-example compartment for Phase 1B. The canonical data
 * accessor (`favoritesData`) wraps the existing `storage.ts` methods so any
 * consumer — current `/api/favorites` routes in `server/routes.ts`, future
 * dashboard widgets, alert rules — calls through the same module.
 *
 * Route handlers still live in `server/routes.ts:2984-3034` during the
 * strangler migration; future work can move them here behind `mountRoutes`.
 */
import { storage } from "../../storage";
import type { Favorite, InsertFavorite } from "@shared/schema";
import type { ServerCompartmentEntry, CompartmentMeta } from "../types";

const meta: CompartmentMeta = {
  id: "favorites",
  name: "Favorites / Watchlist",
  tier: "free",
  description: "Per-user watchlist + portfolio ticker lists with verdict/score.",
};

/**
 * Canonical data accessor — single source of truth for any consumer that
 * needs to read or mutate per-user favorites. Pages, widgets, alerts, and
 * API endpoints all import from here.
 */
export const favoritesData = {
  list(userId: number, listType: string): Promise<Favorite[]> {
    return storage.getFavorites(userId, listType);
  },
  get(userId: number, ticker: string, listType: string) {
    return storage.getFavorite(userId, ticker, listType);
  },
  add(fav: InsertFavorite) {
    return storage.addFavorite(fav);
  },
  remove(userId: number, ticker: string, listType: string) {
    return storage.removeFavorite(userId, ticker, listType);
  },
  updateScore(userId: number, ticker: string, listType: string, score: number, verdict: string) {
    return storage.updateFavoriteScore(userId, ticker, listType, score, verdict);
  },
};

export const favoritesCompartment: ServerCompartmentEntry = {
  meta,
};

export { meta };
