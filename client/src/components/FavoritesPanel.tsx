import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";
import { Eye, Briefcase, Trash2, RefreshCw, TrendingUp, Star } from "lucide-react";
import { getVerdictColor, getScoreColor } from "@/lib/format";

interface FavoriteItem {
  id: number;
  ticker: string;
  companyName: string;
  listType: string;
  score: number | null;
  verdict: string | null;
  sector: string | null;
  addedAt: string;
}

interface FavoritesPanelProps {
  onSelectTicker: (ticker: string) => void;
  currentAnalysis: any | null;
}

function ScoreBadge({ score, verdict }: { score: number | null; verdict: string | null }) {
  if (score === null) {
    return (
      <span className="text-xs text-muted-foreground px-2 py-0.5 rounded bg-muted">
        No score
      </span>
    );
  }

  const colors = verdict ? getVerdictColor(verdict) : { bg: "bg-muted", text: "text-muted-foreground", border: "" };

  return (
    <div className="flex items-center gap-1.5">
      <span className={`text-sm font-bold tabular-nums ${colors.text}`}>
        {score.toFixed(2)}
      </span>
      {verdict && (
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${colors.bg} text-white`}>
          {verdict}
        </span>
      )}
    </div>
  );
}

function FavoriteRow({ item, onRemove, onSelect }: { item: FavoriteItem; onRemove: () => void; onSelect: () => void }) {
  return (
    <div
      className="flex items-center justify-between py-2.5 px-3 rounded-md hover:bg-muted/50 transition-colors cursor-pointer group"
      onClick={onSelect}
      data-testid={`favorite-${item.ticker}`}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono font-bold text-sm text-foreground">{item.ticker}</span>
            {item.sector && (
              <span className="text-[10px] text-muted-foreground truncate hidden sm:inline">{item.sector}</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground truncate max-w-[160px]">{item.companyName}</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <ScoreBadge score={item.score} verdict={item.verdict} />
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-red-500 p-1"
          data-testid={`button-remove-${item.ticker}`}
          aria-label={`Remove ${item.ticker}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

export function FavoritesPanel({ onSelectTicker, currentAnalysis }: FavoritesPanelProps) {
  const [activeTab, setActiveTab] = useState<"watchlist" | "portfolio">("watchlist");

  const { data: items = [], isLoading } = useQuery<FavoriteItem[]>({
    queryKey: ["/api/favorites", activeTab],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/favorites/${activeTab}`);
      return res.json();
    },
  });

  const removeMutation = useMutation({
    mutationFn: async ({ ticker, listType }: { ticker: string; listType: string }) => {
      await apiRequest("DELETE", `/api/favorites/${listType}/${ticker}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/favorites"] });
    },
  });

  const refreshMutation = useMutation({
    mutationFn: async (listType: string) => {
      const res = await apiRequest("POST", `/api/favorites/${listType}/refresh`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/favorites"] });
    },
  });

  const addMutation = useMutation({
    mutationFn: async (data: { ticker: string; companyName: string; listType: string; score: number; verdict: string; sector: string }) => {
      const res = await apiRequest("POST", "/api/favorites", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/favorites"] });
    },
  });

  const isInList = (listType: string) => {
    if (!currentAnalysis) return false;
    return items.some(i => i.ticker === currentAnalysis.ticker && i.listType === listType);
  };

  const handleAddCurrent = (listType: "watchlist" | "portfolio") => {
    if (!currentAnalysis) return;
    addMutation.mutate({
      ticker: currentAnalysis.ticker,
      companyName: currentAnalysis.companyName,
      listType,
      score: currentAnalysis.score,
      verdict: currentAnalysis.verdict,
      sector: currentAnalysis.sector,
    });
  };

  // Sort items by score descending (best first)
  const sortedItems = [...items].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  return (
    <div className="bg-card border border-card-border rounded-lg overflow-hidden" data-testid="favorites-panel">
      {/* Tabs */}
      <div className="flex border-b border-card-border">
        <button
          onClick={() => setActiveTab("watchlist")}
          className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-colors ${
            activeTab === "watchlist"
              ? "text-primary border-b-2 border-primary bg-primary/5"
              : "text-muted-foreground hover:text-foreground"
          }`}
          data-testid="tab-watchlist"
        >
          <Eye className="h-4 w-4" />
          Watchlist
          {items.length > 0 && activeTab === "watchlist" && (
            <span className="text-[10px] bg-primary/15 text-primary px-1.5 py-0.5 rounded-full tabular-nums">{items.length}</span>
          )}
        </button>
        <button
          onClick={() => setActiveTab("portfolio")}
          className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-colors ${
            activeTab === "portfolio"
              ? "text-primary border-b-2 border-primary bg-primary/5"
              : "text-muted-foreground hover:text-foreground"
          }`}
          data-testid="tab-portfolio"
        >
          <Briefcase className="h-4 w-4" />
          Portfolio
          {items.length > 0 && activeTab === "portfolio" && (
            <span className="text-[10px] bg-primary/15 text-primary px-1.5 py-0.5 rounded-full tabular-nums">{items.length}</span>
          )}
        </button>
      </div>

      {/* Add to list buttons */}
      {currentAnalysis && (
        <div className="p-3 border-b border-card-border bg-muted/30">
          <div className="flex gap-2">
            <button
              onClick={() => handleAddCurrent("watchlist")}
              disabled={isInList("watchlist") || addMutation.isPending}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-xs font-medium transition-colors ${
                isInList("watchlist")
                  ? "bg-primary/10 text-primary cursor-default"
                  : "bg-primary/80 hover:bg-primary text-white"
              }`}
              data-testid="button-add-watchlist"
            >
              <Eye className="h-3 w-3" />
              {isInList("watchlist") ? "On Watchlist" : `+ Watchlist`}
            </button>
            <button
              onClick={() => handleAddCurrent("portfolio")}
              disabled={isInList("portfolio") || addMutation.isPending}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-xs font-medium transition-colors ${
                isInList("portfolio")
                  ? "bg-green-500/10 text-green-500 cursor-default"
                  : "bg-green-600/80 hover:bg-green-600 text-white"
              }`}
              data-testid="button-add-portfolio"
            >
              <Briefcase className="h-3 w-3" />
              {isInList("portfolio") ? "In Portfolio" : `+ Portfolio`}
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground text-center mt-1.5">
            Add <span className="font-mono font-bold">{currentAnalysis.ticker}</span> ({currentAnalysis.score.toFixed(2)}/10)
          </p>
        </div>
      )}

      {/* List content */}
      <div className="p-2 min-h-[80px]">
        {isLoading ? (
          <div className="flex items-center justify-center py-6 text-muted-foreground text-sm">Loading...</div>
        ) : sortedItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
            <Star className="h-5 w-5 mb-2 opacity-30" />
            <p className="text-xs">
              {activeTab === "watchlist" ? "No stocks on your watchlist" : "No stocks in your portfolio"}
            </p>
            <p className="text-[10px] mt-0.5 opacity-70">Analyze a stock and add it here</p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {sortedItems.map((item, idx) => (
              <div key={item.id} className="flex items-center gap-1">
                <span className="text-[10px] text-muted-foreground w-4 text-right tabular-nums shrink-0">
                  {idx + 1}
                </span>
                <div className="flex-1">
                  <FavoriteRow
                    item={item}
                    onRemove={() => removeMutation.mutate({ ticker: item.ticker, listType: activeTab })}
                    onSelect={() => onSelectTicker(item.ticker)}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Refresh button */}
      {sortedItems.length > 0 && (
        <div className="p-2 pt-0 border-t border-card-border/50">
          <button
            onClick={() => refreshMutation.mutate(activeTab)}
            disabled={refreshMutation.isPending}
            className="w-full flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
            data-testid="button-refresh-scores"
          >
            <RefreshCw className={`h-3 w-3 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
            {refreshMutation.isPending ? "Refreshing scores..." : "Refresh all scores"}
          </button>
        </div>
      )}
    </div>
  );
}
