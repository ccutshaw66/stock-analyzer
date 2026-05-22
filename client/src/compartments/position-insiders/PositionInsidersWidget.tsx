import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Briefcase, Loader2, TrendingUp, TrendingDown } from "lucide-react";

interface InsiderTxn {
  symbol: string;
  date: string;
  insider: string;
  relation: string;
  direction: "buy" | "sell" | "other";
  shares: number;
  pricePer: number;
  value: number;
  txType: string;
}

interface PositionInsidersData {
  items: InsiderTxn[];
  heldTickers: string[];
  generatedAt: string;
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null || typeof n !== "number" || Number.isNaN(n)) return "$0";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtShares(n: number | null | undefined): string {
  if (n == null || typeof n !== "number" || Number.isNaN(n)) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function fmtPrice(n: number | null | undefined): string {
  if (n == null || typeof n !== "number" || Number.isNaN(n)) return "—";
  return n.toFixed(2);
}

function ageLabel(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const d = Math.floor(ms / 86_400_000);
  if (d < 1) return "today";
  if (d === 1) return "1d ago";
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function PositionInsidersWidget() {
  const { data, isLoading, error } = useQuery<PositionInsidersData>({
    queryKey: ["/api/dashboard/insiders/positions"],
    queryFn: async () => (await apiRequest("GET", "/api/dashboard/insiders/positions")).json(),
    refetchInterval: 15 * 60 * 1000,
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading insider activity…
      </div>
    );
  }
  if (error) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-bear-light px-4 text-center">
        Insider feed unavailable.
      </div>
    );
  }
  const items = data?.items ?? [];
  const heldTickers = data?.heldTickers ?? [];

  if (heldTickers.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 text-center px-4 py-6">
        <Briefcase className="h-8 w-8 text-muted-foreground/40" />
        <div className="text-sm font-semibold text-foreground">No open positions</div>
        <div className="text-xs text-muted-foreground max-w-xs">
          Insider transactions on your held tickers will appear here.
        </div>
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 text-center px-4 py-6">
        <Briefcase className="h-8 w-8 text-muted-foreground/40" />
        <div className="text-sm font-semibold text-foreground">No recent insider activity</div>
        <div className="text-xs text-muted-foreground max-w-xs">
          No filings on {heldTickers.join(", ")} in the last 30 days.
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto" data-testid="position-insiders">
      <div className="flex items-center justify-between px-3 py-2 border-b border-card-border">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider font-semibold text-muted-foreground">
          <Briefcase className="h-3.5 w-3.5" />
          Position Insiders
        </div>
        <span className="text-micro text-muted-foreground tabular-nums">
          {items.length} txn{items.length === 1 ? "" : "s"} · {heldTickers.length} ticker{heldTickers.length === 1 ? "" : "s"}
        </span>
      </div>
      <ul className="divide-y divide-card-border/50">
        {items.map((tx, i) => {
          const tone =
            tx.direction === "buy" ? "text-bull-light" :
            tx.direction === "sell" ? "text-bear-light" :
            "text-muted-foreground";
          const Icon = tx.direction === "buy" ? TrendingUp : tx.direction === "sell" ? TrendingDown : Briefcase;
          return (
            <li key={`${tx.symbol}-${tx.date}-${i}`} className="px-3 py-2 text-xs">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-micro font-bold px-1.5 py-0.5 rounded bg-brand-accent/15 text-brand-accent tabular-nums">
                  {tx.symbol}
                </span>
                <Icon className={`h-3 w-3 ${tone}`} />
                <span className={`font-semibold ${tone}`}>
                  {tx.direction === "buy" ? "BUY" : tx.direction === "sell" ? "SELL" : tx.txType}
                </span>
                <span className="text-muted-foreground tabular-nums ml-auto shrink-0">{ageLabel(tx.date)}</span>
              </div>
              <div className="text-foreground/90 truncate">
                {tx.insider}
                {tx.relation && <span className="text-muted-foreground"> · {tx.relation}</span>}
              </div>
              <div className="text-micro text-muted-foreground tabular-nums">
                {fmtShares(tx.shares)} shares · {fmtMoney(tx.value)} @ ${fmtPrice(tx.pricePer)}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
