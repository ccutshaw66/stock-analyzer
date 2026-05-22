import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Activity, Loader2 } from "lucide-react";

interface MorningBriefData {
  generatedAt: string;
  marketRegime: { tier: string | null; score: number | null; explainer: string | null };
  book: {
    openPositionCount: number;
    realizedPnLDollar: number;
    unrealizedPnLDollar: number;
    totalPnLDollar: number;
  };
  attention: { itemCount: number; criticalCount: number };
  freshSetups: { htfCount: number };
  lossBudget: { dollarsBudgeted: number; dollarsAtRisk: number; pctUsed: number };
}

function fmtMoney(n: number, signed = false): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : signed && n > 0 ? "+" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function regimeTone(tier: string | null): string {
  switch (tier) {
    case "RISK-ON": return "text-bull-light";
    case "RISK-OFF": return "text-bear-light";
    case "DEFENSIVE": return "text-orange-300";
    case "EUPHORIC": return "text-fuchsia-300";
    default: return "text-foreground";
  }
}

function pnlTone(n: number): string {
  if (n > 0) return "text-bull-light";
  if (n < 0) return "text-bear-light";
  return "text-muted-foreground";
}

function budgetTone(pct: number): string {
  if (pct >= 1) return "text-bear-light";
  if (pct >= 0.6) return "text-watch-light";
  return "text-muted-foreground";
}

export function MorningBriefWidget() {
  const { data, isLoading, error } = useQuery<MorningBriefData>({
    queryKey: ["/api/dashboard/morning-brief"],
    queryFn: async () => (await apiRequest("GET", "/api/dashboard/morning-brief")).json(),
    refetchInterval: 5 * 60 * 1000, // 5 min
    staleTime: 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Building today's brief…
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
        Brief unavailable — Market Pulse cache may be warming.
      </div>
    );
  }

  const { marketRegime, book, attention, freshSetups, lossBudget } = data;
  const tierLabel = marketRegime.tier ?? "Unknown";
  const totalPnL = book.totalPnLDollar;

  return (
    <div className="h-full flex items-center gap-4 px-4 py-2" data-testid="morning-brief">
      <div className="shrink-0 flex items-center gap-2 text-muted-foreground">
        <Activity className="h-4 w-4" />
        <span className="text-xs font-semibold uppercase tracking-wider">Brief</span>
      </div>
      <p className="text-sm text-foreground leading-relaxed flex-1">
        Market is{" "}
        <span className={`font-semibold ${regimeTone(marketRegime.tier)}`}>{tierLabel}</span>
        {marketRegime.score != null && (
          <span className="text-muted-foreground"> ({marketRegime.score}/100)</span>
        )}
        .{" "}
        Book {book.openPositionCount > 0
          ? <>{book.openPositionCount} open · <span className={`font-semibold tabular-nums ${pnlTone(totalPnL)}`}>{fmtMoney(totalPnL, true)}</span></>
          : "flat (no open positions)"}.{" "}
        {attention.itemCount > 0
          ? <><span className={`font-semibold ${attention.criticalCount > 0 ? "text-bear-light" : "text-watch-light"}`}>{attention.itemCount}</span> need{attention.itemCount === 1 ? "s" : ""} attention{attention.criticalCount > 0 && <> ({attention.criticalCount} critical)</>}. </>
          : <span className="text-bull-light font-semibold">All clear today. </span>}
        {freshSetups.htfCount > 0 && (
          <>{freshSetups.htfCount} fresh HTF setup{freshSetups.htfCount === 1 ? "" : "s"} overnight. </>
        )}
        Loss budget{" "}
        <span className={`font-semibold tabular-nums ${budgetTone(lossBudget.pctUsed)}`}>
          {fmtMoney(lossBudget.dollarsAtRisk)} of {fmtMoney(lossBudget.dollarsBudgeted)}
        </span>{" "}
        used ({Math.round(lossBudget.pctUsed * 100)}%).
      </p>
    </div>
  );
}
