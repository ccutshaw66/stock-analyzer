/**
 * ReverseSplitBadge — a self-contained, drop-anywhere warning pill that flags
 * tickers which have done large reverse splits.
 *
 * Why: the app charts SPLIT-ADJUSTED prices, so a heavily-reverse-split name
 * can show an absurd historical figure (e.g. WATT "$1,680 five years ago" when
 * it actually traded ~$2.80 — the gap is a cumulative 600-to-1 from a 1-for-20
 * in 2023 and a 1-for-30 in 2025). Without context that reads like a former
 * blue-chip that collapsed. This badge surfaces the reverse-split factor.
 *
 * Self-fetching + renders nothing when there's no qualifying reverse split, so
 * it can be placed in any ticker header without extra wiring (moveable-widget
 * rule). Multiple instances for the same symbol share one cached query.
 */
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ReverseSplitSummary {
  ticker: string;
  ratio: string;
  cumulativeFactor: number;
  sinceDate: string;
  splitCount: number;
  splits: Array<{ date: string; ratio: string }>;
}

/** "2023-08-16" → "Aug 2023". */
function monthYear(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

export function ReverseSplitBadge({
  symbol,
  className = "",
}: {
  symbol: string | null | undefined;
  className?: string;
}) {
  const { data } = useQuery<ReverseSplitSummary | null>({
    queryKey: ["/api/ticker", symbol, "reverse-split"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/ticker/${symbol}/reverse-split`);
      return res.json();
    },
    enabled: !!symbol,
    staleTime: 24 * 60 * 60 * 1000, // splits change rarely
    retry: 1,
  });

  if (!data) return null;

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={`inline-flex items-center gap-1 rounded-md bg-watch/15 text-watch-light border border-watch/30 px-1.5 py-0.5 text-2xs font-semibold whitespace-nowrap cursor-help shrink-0 ${className}`}
            data-testid="reverse-split-badge"
          >
            <AlertTriangle className="h-3 w-3 shrink-0" />
            {data.ratio} reverse split
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs text-left">
          <p className="font-semibold mb-1">
            {data.ticker} — {data.ratio} cumulative reverse split since {monthYear(data.sinceDate)}
          </p>
          <p className="text-xs text-muted-foreground">
            Prices shown here are split-adjusted, so an old price reflects today's
            share count — not what the stock actually traded at back then. Repeated
            reverse splits usually signal a collapsing share price, not a recovery.
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
