import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Newspaper, Loader2, ExternalLink } from "lucide-react";

interface NewsItem {
  symbol: string;
  publishedAt: string;
  title: string;
  url: string;
  publisher: string | null;
  site: string | null;
  text: string | null;
  imageUrl: string | null;
  kind: "news" | "press-release";
}

interface PositionNewsData {
  items: NewsItem[];
  heldTickers: string[];
  generatedAt: string;
}

function ageLabel(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

export function PositionNewsWidget() {
  const { data, isLoading, error } = useQuery<PositionNewsData>({
    queryKey: ["/api/dashboard/news-for-positions"],
    queryFn: async () => (await apiRequest("GET", "/api/dashboard/news-for-positions")).json(),
    refetchInterval: 10 * 60 * 1000, // 10 min
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading position news…
      </div>
    );
  }
  if (error) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-bear-light px-4 text-center">
        News feed unavailable. Refresh in a moment.
      </div>
    );
  }
  const items = data?.items ?? [];
  const heldTickers = data?.heldTickers ?? [];

  if (heldTickers.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 text-center px-4 py-6">
        <Newspaper className="h-8 w-8 text-muted-foreground/40" />
        <div className="text-sm font-semibold text-foreground">No open positions</div>
        <div className="text-xs text-muted-foreground max-w-xs">
          Add a position in Trade Tracker to see news headlines for that ticker here.
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 text-center px-4 py-6">
        <Newspaper className="h-8 w-8 text-muted-foreground/40" />
        <div className="text-sm font-semibold text-foreground">Quiet overnight</div>
        <div className="text-xs text-muted-foreground max-w-xs">
          No new headlines on {heldTickers.join(", ")} in the last 24 hours.
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto" data-testid="position-news">
      <div className="flex items-center justify-between px-3 py-2 border-b border-card-border">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider font-semibold text-muted-foreground">
          <Newspaper className="h-3.5 w-3.5" />
          Position News
        </div>
        <span className="text-micro text-muted-foreground tabular-nums">
          {items.length} · {heldTickers.length} ticker{heldTickers.length === 1 ? "" : "s"}
        </span>
      </div>
      <ul className="divide-y divide-card-border/50">
        {items.map(item => (
          <li key={item.url} className="hover:bg-muted/30 transition-colors">
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block px-3 py-2.5"
              data-testid={`news-item-${item.symbol}`}
            >
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-micro font-bold px-1.5 py-0.5 rounded bg-brand-accent/15 text-brand-accent tabular-nums">
                  {item.symbol}
                </span>
                {item.kind === "press-release" && (
                  <span className="text-micro font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                    PR
                  </span>
                )}
                <span className="text-micro text-muted-foreground ml-auto tabular-nums shrink-0">
                  {ageLabel(item.publishedAt)}
                </span>
              </div>
              <div className="text-sm text-foreground leading-snug">
                {item.title}
                <ExternalLink className="h-3 w-3 inline-block ml-1 text-muted-foreground/60" />
              </div>
              {item.publisher && (
                <div className="text-micro text-muted-foreground mt-0.5">{item.publisher}</div>
              )}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
