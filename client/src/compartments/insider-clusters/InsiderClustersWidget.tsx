import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Users, Loader2, TrendingUp, TrendingDown } from "lucide-react";

interface InsiderCluster {
  symbol: string;
  direction: "buy" | "sell";
  insiderCount: number;
  totalShares: number;
  totalDollar: number;
  topInsiders: string[];
  windowDays: number;
}

interface InsiderClustersData {
  clusters: InsiderCluster[];
  scannedAt: string;
  windowDays: number;
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null || typeof n !== "number" || Number.isNaN(n)) return "$0";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

export function InsiderClustersWidget() {
  const [, navigate] = useLocation();
  const [filter, setFilter] = useState<"all" | "buy" | "sell">("buy");

  const { data, isLoading, error } = useQuery<InsiderClustersData>({
    queryKey: ["/api/dashboard/insiders/clusters"],
    queryFn: async () => (await apiRequest("GET", "/api/dashboard/insiders/clusters")).json(),
    refetchInterval: 60 * 60 * 1000, // 1 hour — same as server cache
    staleTime: 30 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Scanning insider clusters…
      </div>
    );
  }
  if (error) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-bear-light px-4 text-center">
        Cluster scan unavailable.
      </div>
    );
  }
  const clusters = data?.clusters ?? [];
  const filtered = filter === "all" ? clusters : clusters.filter(c => c.direction === filter);

  return (
    <div className="h-full flex flex-col" data-testid="insider-clusters">
      <div className="flex items-center justify-between px-3 py-2 border-b border-card-border">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider font-semibold text-muted-foreground">
          <Users className="h-3.5 w-3.5" />
          Insider Clusters
        </div>
        <div className="flex items-center gap-1 text-micro">
          {(["buy", "sell", "all"] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-1.5 py-0.5 rounded transition-colors ${
                filter === f
                  ? f === "buy" ? "bg-bull/20 text-bull-light"
                  : f === "sell" ? "bg-bear/20 text-bear-light"
                  : "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              data-testid={`cluster-filter-${f}`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-4 py-6">
          <Users className="h-8 w-8 text-muted-foreground/40" />
          <div className="text-sm font-semibold text-foreground">No active clusters</div>
          <div className="text-xs text-muted-foreground max-w-xs">
            No tickers with 3+ insiders {filter === "all" ? "transacting" : `${filter}ing`} in the last 14 days.
          </div>
        </div>
      ) : (
        <ul className="flex-1 overflow-y-auto divide-y divide-card-border/50">
          {filtered.map(c => {
            const tone = c.direction === "buy" ? "text-bull-light" : "text-bear-light";
            const Icon = c.direction === "buy" ? TrendingUp : TrendingDown;
            return (
              <li
                key={`${c.symbol}-${c.direction}`}
                onClick={() => navigate(`/institutional?ticker=${c.symbol}`)}
                className="px-3 py-2 text-xs hover:bg-muted/30 transition-colors cursor-pointer"
                data-testid={`cluster-${c.symbol}-${c.direction}`}
              >
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-micro font-bold px-1.5 py-0.5 rounded bg-brand-accent/15 text-brand-accent tabular-nums">
                    {c.symbol}
                  </span>
                  <Icon className={`h-3 w-3 ${tone}`} />
                  <span className={`font-semibold ${tone}`}>
                    {c.insiderCount} insiders {c.direction === "buy" ? "buying" : "selling"}
                  </span>
                  <span className="text-muted-foreground tabular-nums ml-auto shrink-0">{fmtMoney(c.totalDollar)}</span>
                </div>
                <div className="text-micro text-muted-foreground truncate">
                  {c.topInsiders.join(" · ")}
                  {c.insiderCount > c.topInsiders.length && (
                    <span className="text-muted-foreground/60"> + {c.insiderCount - c.topInsiders.length} more</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
