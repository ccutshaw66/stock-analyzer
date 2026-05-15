/**
 * Search feature — thin orchestrator over the data facade.
 *
 * Proof-of-design: this is the FIRST feature routed through server/data/.
 * Every page migration in Phase 1.9+ follows this same pattern:
 *
 *   HTTP route (api/) → feature orchestrator (features/) → data facade (data/)
 *
 * Business rules live here. Vendor details stay inside data/.
 */
import { data } from "../../data";
import type { Symbol as Sym } from "../../data/types";

export interface SearchResult {
  symbol: Sym;
  name: string;
}

export async function searchTickers(query: string, limit = 10): Promise<SearchResult[]> {
  const q = query.trim();
  if (q.length === 0) return [];
  if (q.length > 64) return []; // reject obvious junk
  const n = Math.max(1, Math.min(limit, 50));

  const results = await data.searchTickers(q, n);
  return results.map((r) => ({ symbol: r.symbol, name: r.name }));
}
