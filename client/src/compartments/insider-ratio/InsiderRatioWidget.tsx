import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Scale, Loader2, ArrowUpRight, ArrowDownRight } from "lucide-react";

interface MarketRatio {
  windowDays: number;
  buyDollar: number;
  sellDollar: number;
  buyCount: number;
  sellCount: number;
  buySellRatio: number;
  sellShare: number;
}

interface RatioResponse {
  market: { current: MarketRatio; prior: MarketRatio; momDelta: number };
  perSymbol: unknown[];
  scannedAt: string;
}

function fmtRatio(r: number): string {
  if (!isFinite(r)) return "∞";
  if (r >= 10) return r.toFixed(1);
  return r.toFixed(2);
}

function fmtMoney(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function ratioTone(r: number): string {
  if (!isFinite(r) || r >= 1.5) return "text-bull-light";
  if (r >= 0.66) return "text-watch-light";
  return "text-bear-light";
}

function ratioLabel(r: number): string {
  if (!isFinite(r) || r >= 2) return "strong buying";
  if (r >= 1.2) return "buying skew";
  if (r >= 0.83) return "balanced";
  if (r >= 0.5) return "selling skew";
  return "strong selling";
}

export function InsiderRatioWidget() {
  const [, navigate] = useLocation();
  const { data, isLoading, error } = useQuery<RatioResponse>({
    queryKey: ["/api/dashboard/insiders/ratio"],
    queryFn: async () => (await apiRequest("GET", "/api/dashboard/insiders/ratio")).json(),
    refetchInterval: 60 * 60 * 1000,
    staleTime: 30 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Computing insider ratio…
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-bear-light px-4 text-center">
        Insider ratio unavailable.
      </div>
    );
  }

  const { current, prior, momDelta } = data.market;
  const tone = ratioTone(current.buySellRatio);
  const trendUp = momDelta > 0;

  return (
    <button
      type="button"
      onClick={() => navigate("/insiders")}
      className="h-full w-full flex flex-col text-left cursor-pointer hover:bg-muted/20 transition-colors"
      data-testid="insider-ratio-widget"
      title="Click to open the full insider page"
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-card-border">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider font-semibold text-muted-foreground">
          <Scale className="h-3.5 w-3.5" />
          Insider B/S Ratio
        </div>
        <span className="text-micro text-muted-foreground tabular-nums">
          last {current.windowDays}d
        </span>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-3 py-3 gap-1.5">
        <div className={`text-4xl font-bold tabular-nums ${tone}`}>{fmtRatio(current.buySellRatio)}</div>
        <div className={`text-sm font-semibold ${tone}`}>{ratioLabel(current.buySellRatio)}</div>

        <div className="flex items-center gap-1.5 text-micro text-muted-foreground tabular-nums">
          {trendUp ? <ArrowUpRight className="h-3 w-3 text-bull-light" /> : <ArrowDownRight className="h-3 w-3 text-bear-light" />}
          <span>{momDelta > 0 ? "+" : ""}{momDelta.toFixed(2)} vs prior 30d ({fmtRatio(prior.buySellRatio)})</span>
        </div>
      </div>

      <div className="px-3 py-2 border-t border-card-border grid grid-cols-2 gap-x-3 text-micro">
        <div>
          <div className="text-muted-foreground uppercase tracking-wider font-semibold">Buys</div>
          <div className="text-bull-light font-semibold tabular-nums">{fmtMoney(current.buyDollar)}</div>
          <div className="text-muted-foreground/70 tabular-nums">{current.buyCount} insiders</div>
        </div>
        <div>
          <div className="text-muted-foreground uppercase tracking-wider font-semibold">Sells</div>
          <div className="text-bear-light font-semibold tabular-nums">{fmtMoney(current.sellDollar)}</div>
          <div className="text-muted-foreground/70 tabular-nums">{current.sellCount} insiders</div>
        </div>
      </div>
    </button>
  );
}
