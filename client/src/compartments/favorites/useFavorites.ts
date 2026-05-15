/**
 * Canonical client-side data hook for the Favorites compartment.
 *
 * Any consumer (full-page Favorites panel, dashboard Watchlist widget,
 * future alert-preview widget, etc.) calls this hook — never raw fetch
 * to `/api/favorites/*`. One source of truth per the compartment contract.
 */
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export interface FavoriteItem {
  id: number;
  ticker: string;
  companyName: string;
  listType: string;
  score: number | null;
  verdict: string | null;
  sector: string | null;
  addedAt: string;
}

export type FavoritesListType = "watchlist" | "portfolio";

export function useFavorites(listType: FavoritesListType) {
  return useQuery<FavoriteItem[]>({
    queryKey: ["/api/favorites", listType],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/favorites/${listType}`);
      return res.json();
    },
  });
}
