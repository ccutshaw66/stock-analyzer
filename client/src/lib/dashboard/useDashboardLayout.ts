/**
 * Client hook for the per-user dashboard layout. Loads on mount, exposes
 * a `save(layout)` mutation. Caller drives when to save (e.g. on drag end,
 * on show/hide toggle). The server returns the saved layout back so the
 * cache stays consistent.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { API_DASHBOARD_LAYOUT } from "@shared/api/endpoints";
import type { DashboardLayout } from "@shared/dashboard/types";

const QUERY_KEY = [API_DASHBOARD_LAYOUT] as const;

export function useDashboardLayout() {
  const qc = useQueryClient();

  const query = useQuery<DashboardLayout>({
    queryKey: QUERY_KEY,
  });

  const mutation = useMutation<DashboardLayout, Error, DashboardLayout>({
    mutationFn: async (next) => {
      const res = await apiRequest("PATCH", API_DASHBOARD_LAYOUT, next);
      return res.json();
    },
    onSuccess: (saved) => {
      qc.setQueryData(QUERY_KEY, saved);
    },
  });

  return {
    layout: query.data,
    isLoading: query.isLoading,
    error: query.error,
    save: mutation.mutate,
    isSaving: mutation.isPending,
  };
}
