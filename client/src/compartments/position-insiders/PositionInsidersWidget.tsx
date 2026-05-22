import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Briefcase, Loader2, TrendingUp, TrendingDown } from "lucide-react";

type DirectionFilter = "all" | "buy" | "sell";
const MIN_DOLLAR_OPTIONS = [
  { value: 0, label: "All" },
  { value: 10_000, label: "$10K" },
  { value: 50_000, label: "$50K" },
  { value: 100_000, label: "$100K" },
  { value: 500_000, label: "$500K" },
  { value: 1_000_000, label: "$1M" },
];

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
  // Defaults: $50K min (filters out small grants and gifts that aren't
  // conviction trades) + all directions. User can flip to buy-only or
  // sell-only or drop the dollar floor entirely.
  const [minDollar, setMinDollar] = useState<number>(50_000);
  const [direction, setDirection] = useState<DirectionFilter>("all");

  const queryStr = new URLSearchParams();
  if (minDollar > 0) queryStr.set("minDollar", String(minDollar));
  if (direction !== "all") queryStr.set("direction", direction);
  const queryPath = `/api/dashboard/insiders/positions${queryStr.toString() ? "?" + queryStr : ""}`;

  const { data, isLoading, error } = useQuery<PositionInsidersData>({
    queryKey: [queryPath],
    queryFn: async () => (await apiRequest("GET", queryPath)).json(),
    refetchInterval: 15 * 60 * 1000,
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  const items = data?.items ?? [];
  const heldTickers = data?.heldTickers ?? [];

  // Header is always rendered so the filters stay visible even when zero
  // results — otherwise the user can't tell why the list is empty (no
  // matches vs filter too strict).
  const header = (
    <div className="flex items-center justify-between px-3 py-2 border-b border-card-border flex-wrap gap-2">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider font-semibold text-muted-foreground">
        <Briefcase className="h-3.5 w-3.5" />
        Position Insiders
      </div>
      <div className="flex items-center gap-2 text-micro">
        <select
          value={minDollar}
          onChange={e => setMinDollar(Number(e.target.value))}
          className="bg-background border border-card-border rounded px-1.5 py-0.5 text-foreground text-micro"
          data-testid="position-insiders-min-dollar"
          title="Hide transactions below this dollar amount"
        >
          {MIN_DOLLAR_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>≥{o.label}</option>
          ))}
        </select>
        <div className="flex items-center gap-1">
          {(["buy", "sell", "all"] as const).map(f => (
            <button
              key={f}
              onClick={() => setDirection(f)}
              className={`px-1.5 py-0.5 rounded transition-colors ${
                direction === f
                  ? f === "buy" ? "bg-bull/20 text-bull-light"
                  : f === "sell" ? "bg-bear/20 text-bear-light"
                  : "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              data-testid={`position-insiders-direction-${f}`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  if (isLoading) {
    return (
      <div className="h-full flex flex-col" data-testid="position-insiders">
        {header}
        <div className="flex-1 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading insider activity…
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="h-full flex flex-col" data-testid="position-insiders">
        {header}
        <div className="flex-1 flex items-center justify-center text-xs text-bear-light px-4 text-center">
          Insider feed unavailable.
        </div>
      </div>
    );
  }

  if (heldTickers.length === 0) {
    return (
      <div className="h-full flex flex-col" data-testid="position-insiders">
        {header}
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-4 py-6">
          <Briefcase className="h-8 w-8 text-muted-foreground/40" />
          <div className="text-sm font-semibold text-foreground">No open positions</div>
          <div className="text-xs text-muted-foreground max-w-xs">
            Insider transactions on your held tickers will appear here.
          </div>
        </div>
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="h-full flex flex-col" data-testid="position-insiders">
        {header}
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-4 py-6">
          <Briefcase className="h-8 w-8 text-muted-foreground/40" />
          <div className="text-sm font-semibold text-foreground">No matches</div>
          <div className="text-xs text-muted-foreground max-w-xs">
            No {direction === "all" ? "filings" : `${direction} transactions`} on {heldTickers.join(", ")} {minDollar > 0 ? `at or above ${MIN_DOLLAR_OPTIONS.find(o => o.value === minDollar)?.label}` : ""} in the last 30 days. Try loosening the filter.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col" data-testid="position-insiders">
      {header}
      <div className="px-3 py-1 text-micro text-muted-foreground tabular-nums border-b border-card-border/30">
        {items.length} txn{items.length === 1 ? "" : "s"} · {heldTickers.length} ticker{heldTickers.length === 1 ? "" : "s"}
      </div>
      <ul className="flex-1 overflow-y-auto divide-y divide-card-border/50">
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
