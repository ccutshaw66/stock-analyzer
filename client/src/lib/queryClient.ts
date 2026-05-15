import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";

const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(`${API_BASE}${url}`, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(`${API_BASE}${queryKey.join("/")}`);

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      // Keep cached data for the whole session — don't evict when a
      // component unmounts. Cache lives until a manual refresh or
      // full page reload (logout). For scanner query keys, the
      // sessionStorage persister (below) also rehydrates across
      // page reloads inside the tab.
      gcTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});

/**
 * sessionStorage-backed persister for cross-reload cache survival.
 *
 * Wired in `App.tsx` via `PersistQueryClientProvider`. Only query keys
 * starting with `/api/scanner` are persisted — see `App.tsx` for the
 * `dehydrateOptions.shouldDehydrateQuery` filter. This is the
 * Q-C1-locked replacement for the legacy scanner.tsx sessionStorage
 * code (Round 5 compartment refactor, 2026-05-14).
 *
 * Why sessionStorage (not localStorage): scan results are real-time
 * market data; carrying them across days would be misleading. Tab
 * close = fresh start, same UX as the legacy code.
 */
export const queryPersister = createSyncStoragePersister({
  storage: typeof window !== "undefined" ? window.sessionStorage : undefined,
  key: "stockotter:rq-cache",
});
