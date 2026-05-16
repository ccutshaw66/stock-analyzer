/**
 * Watchlist widget — compact dashboard view of the user's watchlist.
 *
 * Reads via `useFavorites("watchlist")` (the canonical hook). Clicking a row
 * publishes the ticker to the shared `TickerContext` bus so other widgets on
 * the same dashboard tab can react. No direct prop coupling.
 */
import { useTicker } from "@/contexts/TickerContext";
import { getVerdictColor } from "@/lib/format";
import { Star } from "lucide-react";
import { useFavorites, type FavoriteItem } from "./useFavorites";

function ScoreBadge({ score, verdict }: { score: number | null; verdict: string | null }) {
  if (score === null) {
    return <span className="text-micro text-muted-foreground">—</span>;
  }
  const colors = verdict
    ? getVerdictColor(verdict)
    : { bg: "bg-muted", text: "text-muted-foreground", border: "" };
  return (
    <div className="flex items-center gap-1">
      <span className={`text-xs font-bold tabular-nums ${colors.text}`}>{score.toFixed(2)}</span>
      {verdict && (
        <span className={`text-mini font-bold px-1 py-0.5 rounded ${colors.bg} text-white`}>{verdict}</span>
      )}
    </div>
  );
}

function Row({ item, onSelect }: { item: FavoriteItem; onSelect: () => void }) {
  return (
    <div
      className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/50 transition-colors cursor-pointer"
      onClick={onSelect}
      data-testid={`watchlist-widget-row-${item.ticker}`}
    >
      <span className="font-mono font-bold text-sm">{item.ticker}</span>
      <ScoreBadge score={item.score} verdict={item.verdict} />
    </div>
  );
}

export function WatchlistWidget() {
  const { data: items, isLoading, error } = useFavorites("watchlist");
  const { setActiveTicker } = useTicker();

  return (
    <div className="flex flex-col h-full p-2" data-testid="watchlist-widget">
      <div className="widget-drag-handle cursor-grab active:cursor-grabbing flex items-center gap-1.5 px-1 pb-2 border-b border-border">
        <Star className="h-3.5 w-3.5 text-yellow-500" />
        <span className="text-xs font-semibold text-foreground">Watchlist</span>
      </div>
      <div className="flex-1 overflow-y-auto pt-1">
        {isLoading && <div className="text-xs text-muted-foreground p-2">Loading…</div>}
        {error && <div className="text-xs text-red-500 p-2">Failed to load watchlist</div>}
        {!isLoading && !error && (!items || items.length === 0) && (
          <div className="text-xs text-muted-foreground p-2">Empty — add tickers from the Profile page.</div>
        )}
        {items?.map((item) => (
          <Row key={item.id} item={item} onSelect={() => setActiveTicker(item.ticker)} />
        ))}
      </div>
    </div>
  );
}
