import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  BarChart3,
  Activity,
  Radar,
  ChevronLeft,
  ChevronRight,
  Eye,
  Briefcase,
  Trash2,
  RefreshCw,
  Star,
  Search,
  Loader2,
  Menu,
  ChevronDown,
  ChevronUp,
  X,
  ClipboardList,
  Calculator,
  BookOpen,
  TrendingUp,
  TrendingDown,
  Building2,
} from "lucide-react";
import { useTicker } from "@/contexts/TickerContext";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getVerdictColor, getChangeColor, formatCurrency } from "@/lib/format";
import { PerplexityAttribution } from "@/components/PerplexityAttribution";
import { useIsMobile } from "@/hooks/use-mobile";

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

// ─── Sticky Header ─────────────────────────────────────────────────────────────

function StickyHeader({
  onToggleSidebar,
  sidebarOpen,
}: {
  onToggleSidebar: () => void;
  sidebarOpen: boolean;
}) {
  const { activeTicker, setActiveTicker, analysisData, isAnalysisLoading } =
    useTicker();
  const [input, setInput] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (trimmed) {
      setActiveTicker(trimmed);
      setInput("");
    }
  };

  const verdictColor = analysisData
    ? getVerdictColor(analysisData.verdict)
    : null;
  const changeColor = analysisData
    ? getChangeColor(analysisData.changePercent)
    : "";

  return (
    <header
      className="sticky top-0 z-50 h-14 bg-card border-b border-card-border flex items-center px-3 gap-3 shrink-0"
      data-testid="app-header"
    >
      {/* Sidebar toggle */}
      <button
        onClick={onToggleSidebar}
        className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground shrink-0"
        data-testid="button-toggle-sidebar"
        aria-label="Toggle sidebar"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Logo */}
      <Link href="/">
        <div className="flex items-center gap-2 shrink-0 cursor-pointer" data-testid="link-home-logo">
          <svg
            width="24"
            height="24"
            viewBox="0 0 32 32"
            fill="none"
            aria-label="Stock Analyzer Logo"
          >
            <rect
              x="2"
              y="2"
              width="28"
              height="28"
              rx="6"
              stroke="currentColor"
              strokeWidth="2"
              className="text-primary"
            />
            <polyline
              points="6,22 12,14 18,18 26,8"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-green-500"
              fill="none"
            />
            <circle cx="26" cy="8" r="2" fill="currentColor" className="text-green-500" />
          </svg>
          <span className="text-sm font-bold text-foreground tracking-tight hidden md:inline">
            Stock Analyzer
          </span>
        </div>
      </Link>

      {/* Search */}
      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 flex-1 max-w-xs ml-2"
        data-testid="header-search-form"
      >
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Ticker symbol..."
            value={input}
            onChange={(e) => setInput(e.target.value.toUpperCase())}
            className="w-full h-8 pl-8 pr-3 text-sm bg-background border border-card-border rounded-md font-mono tracking-wider focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary/50 text-foreground placeholder:text-muted-foreground"
            data-testid="input-ticker"
            disabled={isAnalysisLoading}
          />
        </div>
        <button
          type="submit"
          disabled={!input.trim() || isAnalysisLoading}
          className="h-8 px-3 text-xs font-semibold rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 shrink-0"
          data-testid="button-analyze"
        >
          {isAnalysisLoading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Search className="h-3 w-3" />
          )}
          Analyze
        </button>
      </form>

      {/* Active stock info — verdict banner style like the analysis card */}
      {analysisData && !isAnalysisLoading && verdictColor && (
        <div className={`hidden sm:flex items-center gap-4 ml-auto shrink-0 bg-card/80 border ${verdictColor.border} rounded-lg px-4 py-1.5`} data-testid="header-stock-info">
          {/* Verdict badge */}
          <span
            className={`${verdictColor.bg} text-white font-bold text-xs px-3 py-1 rounded-md shrink-0`}
            data-testid="header-verdict"
          >
            {analysisData.verdict}
          </span>

          {/* Company info */}
          <div className="min-w-0 hidden lg:block">
            <p className="text-sm font-bold text-foreground truncate max-w-[200px] leading-tight" data-testid="header-company">
              {analysisData.companyName}
            </p>
            <p className="text-[10px] text-muted-foreground leading-tight">
              <span className="font-mono font-semibold text-foreground" data-testid="header-ticker">{analysisData.ticker}</span>
              <span className="mx-1">·</span>{analysisData.assetType}
              <span className="mx-1">·</span>{analysisData.sector}
            </p>
          </div>

          {/* Price + Change */}
          <div className="text-right shrink-0">
            <div className="flex items-baseline gap-2">
              <span className="text-base font-bold tabular-nums text-foreground" data-testid="header-price">
                {formatCurrency(analysisData.price)}
              </span>
              <span className={`text-[11px] font-semibold tabular-nums ${changeColor}`} data-testid="header-change">
                {analysisData.changePercent !== null
                  ? (analysisData.changePercent >= 0 ? "+" : "") + analysisData.changePercent.toFixed(2) + "%"
                  : ""}
              </span>
            </div>
          </div>

          {/* Score */}
          <div className="text-right shrink-0" data-testid="header-score">
            <span className={`text-lg font-bold tabular-nums ${verdictColor.text}`}>
              {analysisData.score.toFixed(2)}
            </span>
            <span className="text-[9px] text-muted-foreground"> / 10</span>
          </div>
        </div>
      )}
      {isAnalysisLoading && activeTicker && (
        <div className="hidden sm:flex items-center gap-2 ml-auto shrink-0">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span className="text-xs text-muted-foreground">
            Analyzing {activeTicker}...
          </span>
        </div>
      )}
    </header>
  );
}

// ─── Sidebar ────────────────────────────────────────────────────────────────────

function ScoreBadge({
  score,
  verdict,
}: {
  score: number | null;
  verdict: string | null;
}) {
  if (score === null) return null;
  const colors = verdict
    ? getVerdictColor(verdict)
    : { bg: "bg-muted", text: "text-muted-foreground", border: "" };
  return (
    <div className="flex items-center gap-1">
      <span className={`text-[11px] font-bold tabular-nums ${colors.text}`}>
        {score.toFixed(1)}
      </span>
      {verdict && (
        <span
          className={`text-[9px] font-bold px-1 py-0.5 rounded ${colors.bg} text-white leading-none`}
        >
          {verdict}
        </span>
      )}
    </div>
  );
}

function Sidebar({
  expanded,
  onClose,
  isMobile,
}: {
  expanded: boolean;
  onClose: () => void;
  isMobile: boolean;
}) {
  const [location] = useLocation();
  const { activeTicker, setActiveTicker, analysisData, isAnalysisLoading } =
    useTicker();
  const [watchlistOpen, setWatchlistOpen] = useState(true);
  const [portfolioOpen, setPortfolioOpen] = useState(true);
  const [tradesOpen, setTradesOpen] = useState(true);

  // Fetch open trades for sidebar
  interface TradeItem {
    id: number;
    symbol: string;
    tradeType: string;
    tradeCategory: string;
    openPrice: number;
    currentPrice: number | null;
    contractsShares: number;
    creditDebit: string | null;
    closeDate: string | null;
    commIn: number | null;
  }
  const { data: allTrades = [] } = useQuery<TradeItem[]>({
    queryKey: ["/api/trades"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/trades");
      return res.json();
    },
  });
  const openTrades = allTrades.filter(t => !t.closeDate);

  const { data: watchlistItems = [] } = useQuery<FavoriteItem[]>({
    queryKey: ["/api/favorites", "watchlist"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/favorites/watchlist");
      return res.json();
    },
  });

  const { data: portfolioItems = [] } = useQuery<FavoriteItem[]>({
    queryKey: ["/api/favorites", "portfolio"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/favorites/portfolio");
      return res.json();
    },
  });

  const removeMutation = useMutation({
    mutationFn: async ({
      ticker,
      listType,
    }: {
      ticker: string;
      listType: string;
    }) => {
      await apiRequest("DELETE", `/api/favorites/${listType}/${ticker}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/favorites"] });
    },
  });

  const refreshMutation = useMutation({
    mutationFn: async (listType: string) => {
      const res = await apiRequest(
        "POST",
        `/api/favorites/${listType}/refresh`
      );
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/favorites"] });
    },
  });

  const addMutation = useMutation({
    mutationFn: async (data: {
      ticker: string;
      companyName: string;
      listType: string;
      score: number;
      verdict: string;
      sector: string;
    }) => {
      const res = await apiRequest("POST", "/api/favorites", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/favorites"] });
    },
  });

  const isInList = (listType: string) => {
    if (!analysisData) return false;
    const items = listType === "watchlist" ? watchlistItems : portfolioItems;
    return items.some((i) => i.ticker === analysisData.ticker);
  };

  const handleAddCurrent = (listType: "watchlist" | "portfolio") => {
    if (!analysisData) return;
    addMutation.mutate({
      ticker: analysisData.ticker,
      companyName: analysisData.companyName,
      listType,
      score: analysisData.score,
      verdict: analysisData.verdict,
      sector: analysisData.sector,
    });
  };

  const handleSelectTicker = (ticker: string) => {
    setActiveTicker(ticker);
    if (isMobile) onClose();
  };

  const navItems = [
    { path: "/", label: "Analyzer", icon: BarChart3 },
    { path: "/trade", label: "Trade Analysis", icon: Activity },
    { path: "/scanner", label: "Scanner", icon: Radar },
    { path: "/tracker", label: "Trade Tracker", icon: ClipboardList },
    { path: "/calculator", label: "Options Calc", icon: Calculator },
    { path: "/institutional", label: "Institutional", icon: Building2 },
    { path: "/help", label: "Help / FAQ", icon: BookOpen },
  ];

  const sortedWatchlist = [...watchlistItems].sort(
    (a, b) => (b.score ?? 0) - (a.score ?? 0)
  );
  const sortedPortfolio = [...portfolioItems].sort(
    (a, b) => (b.score ?? 0) - (a.score ?? 0)
  );

  const sidebarWidth = expanded ? "w-64" : "w-14";

  // Mobile overlay
  if (isMobile) {
    if (!expanded) return null;
    return (
      <>
        {/* Backdrop */}
        <div
          className="fixed inset-0 bg-black/50 z-40"
          onClick={onClose}
        />
        {/* Drawer */}
        <aside
          className="fixed top-14 left-0 bottom-0 w-72 bg-card border-r border-card-border z-50 flex flex-col overflow-hidden"
          data-testid="sidebar"
        >
          <SidebarContent
            expanded={true}
            location={location}
            navItems={navItems}
            watchlistOpen={watchlistOpen}
            setWatchlistOpen={setWatchlistOpen}
            portfolioOpen={portfolioOpen}
            setPortfolioOpen={setPortfolioOpen}
            sortedWatchlist={sortedWatchlist}
            sortedPortfolio={sortedPortfolio}
            removeMutation={removeMutation}
            refreshMutation={refreshMutation}
            handleSelectTicker={handleSelectTicker}
            activeTicker={activeTicker}
            analysisData={analysisData}
            isAnalysisLoading={isAnalysisLoading}
            isInList={isInList}
            handleAddCurrent={handleAddCurrent}
            addMutation={addMutation}
            onClose={onClose}
            openTrades={openTrades}
            tradesOpen={tradesOpen}
            setTradesOpen={setTradesOpen}
          />
        </aside>
      </>
    );
  }

  return (
    <aside
      className={`${sidebarWidth} bg-card border-r border-card-border flex flex-col shrink-0 transition-all duration-200 overflow-hidden`}
      data-testid="sidebar"
    >
      <SidebarContent
        expanded={expanded}
        location={location}
        navItems={navItems}
        watchlistOpen={watchlistOpen}
        setWatchlistOpen={setWatchlistOpen}
        portfolioOpen={portfolioOpen}
        setPortfolioOpen={setPortfolioOpen}
        sortedWatchlist={sortedWatchlist}
        sortedPortfolio={sortedPortfolio}
        removeMutation={removeMutation}
        refreshMutation={refreshMutation}
        handleSelectTicker={handleSelectTicker}
        activeTicker={activeTicker}
        analysisData={analysisData}
        isAnalysisLoading={isAnalysisLoading}
        isInList={isInList}
        handleAddCurrent={handleAddCurrent}
        addMutation={addMutation}
        onClose={onClose}
        openTrades={openTrades}
        tradesOpen={tradesOpen}
        setTradesOpen={setTradesOpen}
      />
    </aside>
  );
}

function SidebarContent({
  expanded,
  location,
  navItems,
  watchlistOpen,
  setWatchlistOpen,
  portfolioOpen,
  setPortfolioOpen,
  sortedWatchlist,
  sortedPortfolio,
  removeMutation,
  refreshMutation,
  handleSelectTicker,
  activeTicker,
  analysisData,
  isAnalysisLoading,
  isInList,
  handleAddCurrent,
  addMutation,
  onClose,
  openTrades = [],
  tradesOpen = true,
  setTradesOpen = () => {},
}: any) {
  return (
    <>
      {/* Navigation */}
      <nav className="p-2 space-y-0.5">
        {navItems.map((item: any) => {
          const Icon = item.icon;
          const isActive = location === item.path;
          return (
            <Link key={item.path} href={item.path}>
              <div
                className={`flex items-center gap-3 py-2 px-3 rounded-md cursor-pointer transition-colors ${
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
                data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
                title={expanded ? undefined : item.label}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {expanded && (
                  <span className="text-sm font-medium truncate">
                    {item.label}
                  </span>
                )}
              </div>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-card-border mx-2" />

      {/* Scrollable favorites area */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {/* Watchlist */}
        <div className="px-2 pt-2">
          <button
            onClick={() => setWatchlistOpen(!watchlistOpen)}
            className="flex items-center justify-between w-full px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
            data-testid="toggle-watchlist"
          >
            {expanded ? (
              <>
                <span className="flex items-center gap-2">
                  <Eye className="h-3.5 w-3.5" />
                  Watchlist
                  {sortedWatchlist.length > 0 && (
                    <span className="text-[10px] bg-primary/15 text-primary px-1.5 py-0.5 rounded-full tabular-nums">
                      {sortedWatchlist.length}
                    </span>
                  )}
                </span>
                {watchlistOpen ? (
                  <ChevronUp className="h-3 w-3" />
                ) : (
                  <ChevronDown className="h-3 w-3" />
                )}
              </>
            ) : (
              <Eye className="h-4 w-4 mx-auto" />
            )}
          </button>
          {watchlistOpen && expanded && (
            <div className="space-y-0.5 mt-1">
              {sortedWatchlist.length === 0 ? (
                <p className="text-[10px] text-muted-foreground text-center py-3">
                  No stocks on watchlist
                </p>
              ) : (
                sortedWatchlist.map((item: FavoriteItem) => (
                  <div
                    key={item.id}
                    onClick={() => handleSelectTicker(item.ticker)}
                    className={`flex items-center justify-between py-1.5 px-3 rounded-md cursor-pointer transition-colors group ${
                      activeTicker === item.ticker
                        ? "bg-primary/10"
                        : "hover:bg-muted/50"
                    }`}
                    data-testid={`watchlist-${item.ticker}`}
                  >
                    <div className="min-w-0">
                      <span className="font-mono font-bold text-xs text-foreground">
                        {item.ticker}
                      </span>
                      <p className="text-[10px] text-muted-foreground truncate max-w-[100px]">
                        {item.companyName}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <ScoreBadge score={item.score} verdict={item.verdict} />
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeMutation.mutate({
                            ticker: item.ticker,
                            listType: "watchlist",
                          });
                        }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-red-500 p-0.5"
                        data-testid={`button-remove-watchlist-${item.ticker}`}
                        aria-label={`Remove ${item.ticker} from watchlist`}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                ))
              )}
              {sortedWatchlist.length > 0 && (
                <button
                  onClick={() => refreshMutation.mutate("watchlist")}
                  disabled={refreshMutation.isPending}
                  className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                  data-testid="button-refresh-watchlist"
                >
                  <RefreshCw
                    className={`h-2.5 w-2.5 ${
                      refreshMutation.isPending ? "animate-spin" : ""
                    }`}
                  />
                  Refresh scores
                </button>
              )}
            </div>
          )}
        </div>

        {/* Portfolio */}
        <div className="px-2 pt-1">
          <button
            onClick={() => setPortfolioOpen(!portfolioOpen)}
            className="flex items-center justify-between w-full px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
            data-testid="toggle-portfolio"
          >
            {expanded ? (
              <>
                <span className="flex items-center gap-2">
                  <Briefcase className="h-3.5 w-3.5" />
                  Portfolio
                  {sortedPortfolio.length > 0 && (
                    <span className="text-[10px] bg-green-500/15 text-green-500 px-1.5 py-0.5 rounded-full tabular-nums">
                      {sortedPortfolio.length}
                    </span>
                  )}
                </span>
                {portfolioOpen ? (
                  <ChevronUp className="h-3 w-3" />
                ) : (
                  <ChevronDown className="h-3 w-3" />
                )}
              </>
            ) : (
              <Briefcase className="h-4 w-4 mx-auto" />
            )}
          </button>
          {portfolioOpen && expanded && (
            <div className="space-y-0.5 mt-1">
              {sortedPortfolio.length === 0 ? (
                <p className="text-[10px] text-muted-foreground text-center py-3">
                  No stocks in portfolio
                </p>
              ) : (
                sortedPortfolio.map((item: FavoriteItem) => (
                  <div
                    key={item.id}
                    onClick={() => handleSelectTicker(item.ticker)}
                    className={`flex items-center justify-between py-1.5 px-3 rounded-md cursor-pointer transition-colors group ${
                      activeTicker === item.ticker
                        ? "bg-primary/10"
                        : "hover:bg-muted/50"
                    }`}
                    data-testid={`portfolio-${item.ticker}`}
                  >
                    <div className="min-w-0">
                      <span className="font-mono font-bold text-xs text-foreground">
                        {item.ticker}
                      </span>
                      <p className="text-[10px] text-muted-foreground truncate max-w-[100px]">
                        {item.companyName}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <ScoreBadge score={item.score} verdict={item.verdict} />
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeMutation.mutate({
                            ticker: item.ticker,
                            listType: "portfolio",
                          });
                        }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-red-500 p-0.5"
                        data-testid={`button-remove-portfolio-${item.ticker}`}
                        aria-label={`Remove ${item.ticker} from portfolio`}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                ))
              )}
              {sortedPortfolio.length > 0 && (
                <button
                  onClick={() => refreshMutation.mutate("portfolio")}
                  disabled={refreshMutation.isPending}
                  className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                  data-testid="button-refresh-portfolio"
                >
                  <RefreshCw
                    className={`h-2.5 w-2.5 ${
                      refreshMutation.isPending ? "animate-spin" : ""
                    }`}
                  />
                  Refresh scores
                </button>
              )}
            </div>
          )}
        </div>

        {/* Active Options */}
        {(() => {
          const optionTrades = openTrades.filter((t: any) => t.tradeCategory === 'Option');
          const stockTrades = openTrades.filter((t: any) => t.tradeCategory === 'Stock');
          const renderTrade = (t: any) => {
            let pl = 0;
            if (t.currentPrice && t.tradeCategory === 'Stock') {
              const isShort = t.creditDebit === 'CREDIT' || t.tradeType === 'SHORT';
              pl = isShort
                ? (Math.abs(t.openPrice) - t.currentPrice) * t.contractsShares
                : (t.currentPrice - Math.abs(t.openPrice)) * t.contractsShares;
            }
            const isUp = pl >= 0;
            return (
              <div key={t.id} onClick={() => handleSelectTicker(t.symbol)}
                className="flex items-center justify-between py-1.5 px-3 rounded-md cursor-pointer hover:bg-muted/50 transition-colors">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono font-bold text-xs text-foreground">{t.symbol}</span>
                    <span className={`text-[9px] font-semibold px-1 py-0.5 rounded ${t.creditDebit === 'CREDIT' ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'}`}>{t.tradeType}</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    {t.contractsShares} {t.tradeCategory === 'Option' ? 'ct' : 'sh'} @ {t.openPrice > 0 ? '+' : ''}{t.openPrice.toFixed(2)}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  {t.currentPrice ? (
                    t.tradeCategory === 'Stock' ? (
                      <>
                        <div className={`text-[11px] font-bold tabular-nums ${isUp ? 'text-green-400' : 'text-red-400'}`}>
                          {isUp ? '+' : ''}{pl.toFixed(0)}
                        </div>
                        <div className="text-[9px] text-muted-foreground tabular-nums">${t.currentPrice.toFixed(2)}</div>
                      </>
                    ) : (
                      <div className="text-[9px] text-muted-foreground tabular-nums">${t.currentPrice.toFixed(2)}</div>
                    )
                  ) : (
                    <span className="text-[10px] text-muted-foreground">—</span>
                  )}
                </div>
              </div>
            );
          };
          return (
            <>
              <div className="px-2 pt-1">
                <button onClick={() => setTradesOpen(!tradesOpen)}
                  className="flex items-center justify-between w-full px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors" data-testid="toggle-trades">
                  {expanded ? (
                    <><span className="flex items-center gap-2">
                      <ClipboardList className="h-3.5 w-3.5" />Active Options
                      {optionTrades.length > 0 && <span className="text-[10px] bg-purple-500/15 text-purple-400 px-1.5 py-0.5 rounded-full tabular-nums">{optionTrades.length}</span>}
                    </span>{tradesOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}</>
                  ) : (<ClipboardList className="h-4 w-4 mx-auto" />)}
                </button>
                {tradesOpen && expanded && (
                  <div className="space-y-0.5 mt-1">
                    {optionTrades.length === 0 ? <p className="text-[10px] text-muted-foreground text-center py-2">No open options</p>
                    : optionTrades.slice(0, 10).map(renderTrade)}
                  </div>
                )}
              </div>
              <div className="px-2 pt-1">
                <button onClick={() => setTradesOpen(!tradesOpen)}
                  className="flex items-center justify-between w-full px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors">
                  {expanded ? (
                    <><span className="flex items-center gap-2">
                      <TrendingUp className="h-3.5 w-3.5" />Active Stocks
                      {stockTrades.length > 0 && <span className="text-[10px] bg-blue-500/15 text-blue-400 px-1.5 py-0.5 rounded-full tabular-nums">{stockTrades.length}</span>}
                    </span>{tradesOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}</>
                  ) : (<TrendingUp className="h-4 w-4 mx-auto" />)}
                </button>
                {tradesOpen && expanded && (
                  <div className="space-y-0.5 mt-1">
                    {stockTrades.length === 0 ? <p className="text-[10px] text-muted-foreground text-center py-2">No open stocks</p>
                    : stockTrades.slice(0, 10).map(renderTrade)}
                  </div>
                )}
              </div>
            </>
          );
        })()}
      </div>

      {/* Add to list buttons (bottom) */}
      {expanded && analysisData && !isAnalysisLoading && (
        <div className="p-2 border-t border-card-border space-y-1.5">
          <button
            onClick={() => handleAddCurrent("watchlist")}
            disabled={isInList("watchlist") || addMutation.isPending}
            className={`w-full flex items-center justify-center gap-1.5 py-2 rounded-md text-xs font-medium transition-colors ${
              isInList("watchlist")
                ? "bg-primary/10 text-primary cursor-default"
                : "bg-primary/80 hover:bg-primary text-white"
            }`}
            data-testid="button-add-watchlist"
          >
            <Eye className="h-3 w-3" />
            {isInList("watchlist") ? "On Watchlist" : "+ Watchlist"}
          </button>
          <button
            onClick={() => handleAddCurrent("portfolio")}
            disabled={isInList("portfolio") || addMutation.isPending}
            className={`w-full flex items-center justify-center gap-1.5 py-2 rounded-md text-xs font-medium transition-colors ${
              isInList("portfolio")
                ? "bg-green-500/10 text-green-500 cursor-default"
                : "bg-green-600/80 hover:bg-green-600 text-white"
            }`}
            data-testid="button-add-portfolio"
          >
            <Briefcase className="h-3 w-3" />
            {isInList("portfolio") ? "In Portfolio" : "+ Portfolio"}
          </button>
        </div>
      )}

      {/* Attribution */}
      {expanded && (
        <div className="p-2 border-t border-card-border">
          <PerplexityAttribution />
        </div>
      )}
    </>
  );
}

// ─── Main Layout ────────────────────────────────────────────────────────────────

export function AppLayout({ children }: { children: React.ReactNode }) {
  const isMobile = useIsMobile();
  const [sidebarExpanded, setSidebarExpanded] = useState(!isMobile);

  const toggleSidebar = () => setSidebarExpanded((v) => !v);
  const closeSidebar = () => setSidebarExpanded(false);

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <StickyHeader
        onToggleSidebar={toggleSidebar}
        sidebarOpen={sidebarExpanded}
      />
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <Sidebar
          expanded={sidebarExpanded}
          onClose={closeSidebar}
          isMobile={isMobile}
        />
        <main className="flex-1 overflow-y-auto" data-testid="main-content">
          {children}
        </main>
      </div>
    </div>
  );
}
