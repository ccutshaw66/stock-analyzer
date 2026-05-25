/**
 * Canonical hook for the Dividend Calculator compartment.
 *
 * Wraps the `/api/dividends/:ticker` lookup in a React Query so every
 * surface (Full view, future widget, future alert preview) reads through
 * one entry point. The derived per-distribution / yearly numbers come
 * from `dividendCalcLogic.computeNumbers` — pure math, no React.
 *
 * NOTE — provider note: today the underlying route is Polygon-via-Yahoo-
 * shape (both kill targets per `plan_yahoo_polygon_kill`). When that
 * route migrates to FMP, only the response-mapping step in this hook
 * (or the `extractDividendData` server function) has to change — the
 * shape DividendData is independent of the source provider.
 */
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { dividendsPath } from "@shared/api/endpoints";
import type { DividendData } from "./dividendCalcLogic";

/** Look up one ticker's dividend data. `enabled` only fires when ticker is set. */
export function useDividendLookup(submittedTicker: string | null) {
  return useQuery<DividendData>({
    queryKey: ["dividend-calc", submittedTicker],
    queryFn: async () => {
      const res = await apiRequest("GET", dividendsPath(submittedTicker!));
      return res.json();
    },
    enabled: !!submittedTicker,
    retry: false,
  });
}
