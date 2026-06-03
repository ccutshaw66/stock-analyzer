import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import iconUrl from "@/assets/icon.png";
import logoUrl from "@/assets/logo.png";
import logoTextUrl from "@/assets/logo-text.png";
// AppLayout only needs UI-chrome icons here. Page icons come from the
// page-registry (sidebar nav iterates over `getNavGroups` and renders
// each entry's icon dynamically).
import {
  ChevronDown,
  ChevronUp,
  Eye,
  Loader2,
  LogOut,
  Menu,
  RefreshCw,
  Search,
  Shield,
  Trash2,
  TrendingUp,
  UserCircle,
  X,
  BookOpen,
  ClipboardList,
} from "lucide-react";
import { useTicker } from "@/contexts/TickerContext";
import { useTimeframe } from "@/contexts/TimeframeContext";
import { getNavGroups } from "@/lib/page-registry";
import { useTickerNavigate, isCompanyResearchRoute } from "@/lib/useTickerNavigate";
import { TimeframePicker } from "@/components/TimeframePicker";
import { AlertsBell } from "@/components/AlertsBell";
import { TRADE_TYPES, type TradeTypeCode } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  API_TRADES,
  API_TRADES_SUMMARY,
  API_ACCOUNT_SETTINGS,
  API_FAVORITES,
  API_FAVORITES_WATCHLIST,
  API_FAVORITES_PORTFOLIO,
} from "@shared/api/endpoints";
import { getVerdictColor, getChangeColor, formatCurrency } from "@/lib/format";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/contexts/AuthContext";
import { useSubscription } from "@/hooks/useSubscription";
import { DatePicker } from "@/components/ui/date-picker";

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
  const { activeTicker, analysisData, isAnalysisLoading } = useTicker();
  const { user, logout } = useAuth();
  const { tier } = useSubscription();
  const [input, setInput] = useState("");
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [searchResults, setSearchResults] = useState<{ symbol: string; name: string; type: string }[]>([]);
  const [showSearch, setShowSearch] = useState(false);
  const [, navigate] = useLocation();
  // Shared ticker-navigate hook: any pick lands on /profile (unless the
  // user is already on a Company Research page).
  const tickerNavigate = useTickerNavigate();

  // Debounced search — triggers when user types 2+ chars that look like a name (not a pure ticker)
  const searchTimerRef = useRef<any>(null);
  // Request-generation counter — invalidates stale in-flight fetches so a
  // late response can't re-open the dropdown after the user hit Analyze.
  const searchGenRef = useRef(0);
  const handleInputChange = (val: string) => {
    setInput(val);
    const isName = val.length >= 2 && (/[a-z]/.test(val) || val.length >= 4);
    if (isName) {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      const myGen = ++searchGenRef.current;
      searchTimerRef.current = setTimeout(async () => {
        try {
          const res = await apiRequest("GET", `/api/search?q=${encodeURIComponent(val)}`);
          const data = await res.json();
          if (myGen !== searchGenRef.current) return;
          setSearchResults(data);
          setShowSearch(data.length > 0);
        } catch {
          if (myGen !== searchGenRef.current) return;
          setSearchResults([]);
          setShowSearch(false);
        }
      }, 300);
    } else {
      setShowSearch(false);
    }
  };

  const dismissSearch = () => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchGenRef.current++;
    setSearchResults([]);
    setShowSearch(false);
  };

  const selectResult = (symbol: string) => {
    tickerNavigate(symbol);
    setInput("");
    dismissSearch();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim().toUpperCase();
    if (trimmed) {
      tickerNavigate(trimmed);
      setInput("");
      dismissSearch();
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
        <div className="hidden sm:flex items-center shrink-0 cursor-pointer" data-testid="link-home-logo" style={{ backgroundColor: 'rgb(var(--brand-bg))' }}>
          <img src={logoTextUrl} alt="Stock Otter" className="h-8 w-auto" />
        </div>
      </Link>

      {/* Search */}
      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-1.5 sm:gap-2 flex-1 min-w-0 max-w-xs ml-1 sm:ml-2"
        data-testid="header-search-form"
      >
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Ticker or name..."
            value={input}
            onChange={(e) => handleInputChange(e.target.value)}
            onFocus={() => { if (searchResults.length > 0) setShowSearch(true); }}
            onBlur={() => setTimeout(() => setShowSearch(false), 200)}
            className="w-full h-8 pl-8 pr-3 text-sm bg-background border border-card-border rounded-md tracking-wider focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary/50 text-foreground placeholder:text-muted-foreground"
            data-testid="input-ticker"
            disabled={isAnalysisLoading}
          />
          {showSearch && searchResults.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-card-border rounded-lg shadow-lg z-50 max-h-60 overflow-y-auto">
              {searchResults.map((r) => (
                <div
                  key={r.symbol}
                  className="flex items-center justify-between px-3 py-2 hover:bg-muted/50 cursor-pointer transition-colors"
                  onMouseDown={(e) => { e.preventDefault(); selectResult(r.symbol); }}
                >
                  <div className="min-w-0">
                    <span className="font-mono font-bold text-xs text-foreground">{r.symbol}</span>
                    <span className="text-micro text-muted-foreground ml-2 truncate">{r.name}</span>
                  </div>
                  <span className="text-mini text-muted-foreground shrink-0 ml-2">{r.type}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <button
          type="submit"
          disabled={!input.trim() || isAnalysisLoading}
          className="h-8 px-2 sm:px-3 text-xs font-semibold rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 shrink-0"
          data-testid="button-analyze"
        >
          {isAnalysisLoading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Search className="h-3 w-3" />
          )}
          <span className="hidden sm:inline">Analyze</span>
        </button>
      </form>

      {/* Timeframe picker — site-wide; drives charts/scanners/indicators */}
      <TimeframePicker />

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
            <p className="text-micro text-muted-foreground leading-tight">
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
              <span className={`text-2xs font-semibold tabular-nums ${changeColor}`} data-testid="header-change">
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
            <span className="text-mini text-muted-foreground"> / 10</span>
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

      {/* Alerts bell */}
      {user && (
        <div className={`${!analysisData && !isAnalysisLoading ? "ml-auto" : "ml-2"}`}>
          <AlertsBell />
        </div>
      )}

      {/* User dropdown menu */}
      {user && (
        <div className="relative shrink-0 ml-1">
          <button
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-muted transition-colors"
            data-testid="button-user-menu"
          >
            <div className="h-7 w-7 rounded-full bg-primary/20 flex items-center justify-center">
              <span className="text-xs font-bold text-primary">
                {(user.displayName || user.email || "U")[0].toUpperCase()}
              </span>
            </div>
            <span className="hidden lg:inline text-xs font-medium text-foreground truncate max-w-[100px]">
              {user.displayName || "Account"}
            </span>
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          </button>

          {userMenuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setUserMenuOpen(false)} />
              <div className="absolute right-0 top-full mt-1 w-56 bg-card border border-card-border rounded-xl shadow-lg z-50 py-2">
                <div className="px-3 py-2 border-b border-card-border">
                  <p className="text-sm font-semibold text-foreground truncate">{user.displayName || "User"}</p>
                  <p className="text-2xs text-muted-foreground truncate">{user.email}</p>
                </div>
                <div className="py-1">
                  <div
                    onClick={() => { navigate("/account"); setUserMenuOpen(false); }}
                    className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
                  >
                    <UserCircle className="h-4 w-4" /> Account
                  </div>
                  {user.email === "awisper@me.com" && (
                    <div
                      onClick={() => { navigate("/admin"); setUserMenuOpen(false); }}
                      className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
                    >
                      <Shield className="h-4 w-4" /> Admin
                    </div>
                  )}
                </div>
                <div className="border-t border-card-border pt-1">
                  <div
                    onClick={() => { logout(); setUserMenuOpen(false); }}
                    className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:bg-bear/10 hover:text-bear-light cursor-pointer"
                    data-testid="button-logout"
                  >
                    <LogOut className="h-4 w-4" /> Sign Out
                  </div>
                </div>
              </div>
            </>
          )}
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
  if (score === null && !verdict) return null;

  // Gate-style signals (stored as gatesCleared 0-3 in score, signal in verdict)
  // Detect gate data: score must be 0-3 AND verdict starts with gate keywords
  const isGateData = verdict && score !== null && score >= 0 && score <= 3 &&
    (verdict.startsWith("READY") || verdict.startsWith("SET") || verdict.startsWith("GO") ||
     verdict.startsWith("GATES") || verdict.startsWith("PULLBACK") || verdict === "NO SETUP");

  if (isGateData && verdict) {
    const gatesCleared = Math.round(score ?? 0);
    const signalColor = verdict.startsWith("GO") ? "bg-bull" :
      verdict.startsWith("SET") ? "bg-blue-500" :
      verdict.startsWith("READY") ? "bg-amber-500" :
      verdict.startsWith("PULLBACK") ? "bg-orange-500" :
      verdict.startsWith("GATES") ? "bg-bear" :
      "bg-zinc-500";
    // For PULLBACK/GATES CLOSED, tint ALL the active pips to match the signal
    // color so the watchlist row reads as a single state (not mixed gate colors).
    const isExitState = verdict.startsWith("PULLBACK") || verdict.startsWith("GATES");
    const exitPipColor = verdict.startsWith("PULLBACK") ? "bg-orange-500" : "bg-bear";
    return (
      <div className="flex items-center gap-1">
        <div className="flex gap-0.5">
          {[1, 2, 3].map((g) => (
            <div key={g} className={`h-1 w-2 rounded-full ${
              g <= gatesCleared
                ? isExitState
                  ? exitPipColor
                  : g === 3 ? "bg-bull" : g === 2 ? "bg-blue-500" : "bg-amber-500"
                : "bg-muted-foreground/20"
            }`} />
          ))}
        </div>
        <span className={`text-mini font-bold px-1 py-0.5 rounded ${signalColor} text-white leading-none`}>
          {verdict}
        </span>
      </div>
    );
  }

  // Legacy profile score — show refresh indicator
  return (
    <span className="text-mini text-muted-foreground/50 italic">refresh</span>
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
  const { activeTicker, setActiveTicker, analysisData, tradeData, isAnalysisLoading } =
    useTicker();
  const { timeframe } = useTimeframe();
  const { tier } = useSubscription();
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
    queryKey: [API_TRADES],
    queryFn: async () => {
      const res = await apiRequest("GET", API_TRADES);
      return res.json();
    },
  });
  const openTrades = allTrades.filter(t => !t.closeDate);

  // Account settings for trade modals
  const { data: accountSettings } = useQuery<any>({
    queryKey: [API_ACCOUNT_SETTINGS],
    queryFn: async () => { const res = await apiRequest("GET", API_ACCOUNT_SETTINGS); return res.json(); },
  });

  const { data: watchlistItems = [] } = useQuery<FavoriteItem[]>({
    queryKey: [API_FAVORITES, "watchlist"],
    queryFn: async () => {
      const res = await apiRequest("GET", API_FAVORITES_WATCHLIST);
      return res.json();
    },
  });

  const { data: portfolioItems = [] } = useQuery<FavoriteItem[]>({
    queryKey: [API_FAVORITES, "portfolio"],
    queryFn: async () => {
      const res = await apiRequest("GET", API_FAVORITES_PORTFOLIO);
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
      queryClient.invalidateQueries({ queryKey: [API_FAVORITES] });
    },
  });

  const refreshMutation = useMutation({
    mutationFn: async (listType: string) => {
      // force=1 bypasses server-side 15min cache so manual Refresh
      // button always returns fresh gate signals.
      const res = await apiRequest(
        "POST",
        `/api/favorites/${listType}/refresh?force=1&timeframe=${timeframe}`
      );
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [API_FAVORITES] });
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
      const res = await apiRequest("POST", API_FAVORITES, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [API_FAVORITES] });
    },
  });

  const isInList = (listType: string) => {
    if (!analysisData) return false;
    const items = listType === "watchlist" ? watchlistItems : portfolioItems;
    return items.some((i) => i.ticker === analysisData.ticker);
  };

  const handleAddCurrent = (listType: "watchlist" | "portfolio") => {
    if (!analysisData) return;
    // Store gate system data instead of profile score for watchlist
    const gates = tradeData?.gates;
    addMutation.mutate({
      ticker: analysisData.ticker,
      companyName: analysisData.companyName,
      listType,
      score: gates ? gates.gatesCleared : analysisData.score,
      verdict: gates ? gates.signal : analysisData.verdict,
      sector: analysisData.sector,
    });
  };

  const tickerNavigate = useTickerNavigate();
  const handleSelectTicker = (ticker: string) => {
    tickerNavigate(ticker);
    if (isMobile) onClose();
  };

  // Sidebar nav comes from the page registry — single source of truth.
  // Adding a page = one entry in `client/src/lib/page-registry.ts`.
  // Help is split off because it renders separately at the bottom of the nav.
  const allGroups = getNavGroups(tier as "free" | "pro" | "elite" | "owner");
  const navGroups = allGroups.filter((g) => g.label !== "Help");
  const helpItem = allGroups
    .find((g) => g.label === "Help")
    ?.items[0] ?? { path: "/help", label: "Help / FAQ", icon: BookOpen };

  const sortedWatchlist = [...watchlistItems].sort(
    (a, b) => (b.score ?? 0) - (a.score ?? 0)
  );
  // Add/Close trade modal states
  const [showAddTrade, setShowAddTrade] = useState(false);
  const [showCloseTrade, setShowCloseTrade] = useState(false);
  // All groups collapsed by default; accordion behavior (only one open at a time).
  const [groupOpen, setGroupOpen] = useState<Record<string, boolean>>({});
  const toggleGroup = (label: string) => {
    setGroupOpen((prev) => (prev[label] ? {} : { [label]: true }));
  };
  // Auto-expand the Company Research group whenever the user lands on one
  // of its pages (either via a ticker click or direct navigation). Matches
  // the accordion behavior — opening CR closes whatever else was open.
  useEffect(() => {
    if (isCompanyResearchRoute(location)) {
      setGroupOpen({ "Company Research": true });
    }
  }, [location]);

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
          className="fixed top-14 left-0 bottom-0 w-72 bg-card border-r border-card-border z-50 flex flex-col sidebar-scroll overflow-y-auto"
          data-testid="sidebar"
        >
          <SidebarContent
            expanded={true}
            location={location}
            navGroups={navGroups}
            helpItem={helpItem}
            sortedWatchlist={sortedWatchlist}
            removeMutation={removeMutation}
            refreshMutation={refreshMutation}
            handleSelectTicker={handleSelectTicker}
            activeTicker={activeTicker}
            analysisData={analysisData}
            isAnalysisLoading={isAnalysisLoading}
            isInList={isInList}
            handleAddCurrent={handleAddCurrent}
            addMutation={addMutation}
            openTrades={openTrades}
            groupOpen={groupOpen}
            setGroupOpen={setGroupOpen}
            toggleGroup={toggleGroup}
            setShowAddTrade={setShowAddTrade}
            setShowCloseTrade={setShowCloseTrade}
          />
        </aside>

        {/* Add Trade Modal (mobile) */}
        {showAddTrade && accountSettings && (
          <SidebarAddTradeModal settings={accountSettings} onClose={() => setShowAddTrade(false)} />
        )}

        {/* Close Trade Modal (mobile) */}
        {showCloseTrade && (
          <SidebarCloseTradeModal openTrades={openTrades} settings={accountSettings} onClose={() => setShowCloseTrade(false)} />
        )}
      </>
    );
  }

  return (
    <>
    <aside
      className={`${sidebarWidth} bg-card border-r border-card-border flex flex-col shrink-0 transition-all duration-200 sidebar-scroll overflow-y-auto`}
      data-testid="sidebar"
    >
      <SidebarContent
        expanded={expanded}
        location={location}
        navGroups={navGroups}
        helpItem={helpItem}
        sortedWatchlist={sortedWatchlist}
        removeMutation={removeMutation}
        refreshMutation={refreshMutation}
        handleSelectTicker={handleSelectTicker}
        activeTicker={activeTicker}
        analysisData={analysisData}
        isAnalysisLoading={isAnalysisLoading}
        isInList={isInList}
        handleAddCurrent={handleAddCurrent}
        addMutation={addMutation}
        openTrades={openTrades}
        groupOpen={groupOpen}
        setGroupOpen={setGroupOpen}
        toggleGroup={toggleGroup}
        setShowAddTrade={setShowAddTrade}
        setShowCloseTrade={setShowCloseTrade}
      />
    </aside>

    {/* Add Trade Modal */}
    {showAddTrade && accountSettings && (
      <SidebarAddTradeModal settings={accountSettings} onClose={() => setShowAddTrade(false)} />
    )}

    {/* Close Trade Modal */}
    {showCloseTrade && (
      <SidebarCloseTradeModal openTrades={openTrades} settings={accountSettings} onClose={() => setShowCloseTrade(false)} />
    )}
    </>
  );
}

// ─── Sidebar Trade Modals ───────────────────────────────────────────────────────

const STOCK_TYPES: TradeTypeCode[] = ["LONG", "SHORT", "DTS"];
const OPTION_TYPES = Object.keys(TRADE_TYPES).filter(k => !STOCK_TYPES.includes(k as TradeTypeCode)) as TradeTypeCode[];

function SidebarAddTradeModal({ settings, onClose }: { settings: any; onClose: () => void }) {
  const [category, setCategory] = useState<"Stock" | "Option">("Option");
  const [tradeType, setTradeType] = useState<TradeTypeCode>("C");
  const [pilotOrAdd, setPilotOrAdd] = useState("Pilot");
  const [symbol, setSymbol] = useState("");
  const [tradeDate, setTradeDate] = useState(new Date().toISOString().split("T")[0]);
  const [expiration, setExpiration] = useState("");
  const [contractsShares, setContractsShares] = useState(1);
  const [openPrice, setOpenPrice] = useState("");
  const [strikes, setStrikes] = useState("");
  const [spreadWidth, setSpreadWidth] = useState("");
  const [allocation, setAllocation] = useState("");

  // DSF (Double Spread Fly) dual-vertical fields
  const [dsfBuyStrikes, setDsfBuyStrikes] = useState("");
  const [dsfBuyPrice, setDsfBuyPrice] = useState("");
  const [dsfSellStrikes, setDsfSellStrikes] = useState("");
  const [dsfSellPrice, setDsfSellPrice] = useState("");

  const typeDef = TRADE_TYPES[tradeType];
  const isCredit = typeDef?.isCredit ?? false;
  const isDualVertical = (typeDef as any)?.isDualVertical ?? false;
  const numLegs = typeDef?.legs || 0;
  const filteredTypes = category === "Stock" ? STOCK_TYPES : OPTION_TYPES;

  const createMut = useMutation({
    mutationFn: async (data: any) => { const res = await apiRequest("POST", API_TRADES, data); return res.json(); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: [API_TRADES] }); queryClient.invalidateQueries({ queryKey: [API_TRADES_SUMMARY] }); onClose(); },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    let rawPrice = parseFloat(openPrice) || 0;
    // DSF: net of the two verticals (buy debit + sell credit)
    if (isDualVertical && dsfBuyPrice && dsfSellPrice) {
      const buyP = parseFloat(dsfBuyPrice) || 0;
      const sellP = parseFloat(dsfSellPrice) || 0;
      rawPrice = sellP - buyP; // positive = net credit, negative = net debit
    }
    const signedPrice = isDualVertical
      ? rawPrice
      : (isCredit ? Math.abs(rawPrice) : -Math.abs(rawPrice));
    let commIn = category === "Option" ? contractsShares * numLegs * (settings.commPerOptionContract || 0.65) : (settings.commPerSharesTrade || 0);
    const sw = parseFloat(spreadWidth) || null;

    let maxProfit: number | null = null;
    if (sw && numLegs >= 2) {
      if (isCredit) maxProfit = rawPrice * contractsShares * 100;
      else maxProfit = (sw - rawPrice) * contractsShares * 100;
    }

    createMut.mutate({
      pilotOrAdd, tradeDate, expiration: expiration || null, contractsShares,
      symbol: symbol.toUpperCase(), tradeType, tradeCategory: category,
      strikes: isDualVertical ? `${dsfBuyStrikes}|${dsfSellStrikes}` : (strikes || null),
      openPrice: signedPrice, commIn,
      allocation: parseFloat(allocation) || null, spreadWidth: sw,
      maxProfit,
      creditDebit: isCredit ? "CREDIT" : "DEBIT", tradePlanNotes: null, behaviorTag: null,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border border-card-border rounded-xl w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-card-border">
          <h2 className="text-base font-bold text-foreground">Add Trade</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          <div className="flex gap-2">
            {(["Stock", "Option"] as const).map(cat => (
              <button key={cat} type="button" onClick={() => { setCategory(cat); setTradeType(cat === "Stock" ? "LONG" : "C"); }}
                className={`flex-1 py-2 rounded-lg text-sm font-semibold ${category === cat ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{cat}</button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Trade Type</label>
              <select value={tradeType} onChange={e => setTradeType(e.target.value as TradeTypeCode)} className="w-full h-9 px-3 text-sm bg-background border border-card-border rounded-md text-foreground">
                {filteredTypes.map(c => <option key={c} value={c}>{c} - {TRADE_TYPES[c].label}</option>)}
              </select></div>
            <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Pilot / Add</label>
              <select value={pilotOrAdd} onChange={e => setPilotOrAdd(e.target.value)} className="w-full h-9 px-3 text-sm bg-background border border-card-border rounded-md text-foreground">
                <option value="Pilot">Pilot</option><option value="Add">Add</option>
              </select></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Symbol</label>
              <input type="text" value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())} placeholder="AAPL" required
                className="w-full h-9 px-3 text-sm bg-background border border-card-border rounded-md font-mono text-foreground" /></div>
            <div><label className="text-xs font-medium text-muted-foreground mb-1 block">{category === "Option" ? "Contracts" : "Shares"}</label>
              <input type="number" value={contractsShares} onChange={e => setContractsShares(parseInt(e.target.value) || 1)} min={1}
                className="w-full h-9 px-3 text-sm bg-background border border-card-border rounded-md text-foreground" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Trade Date</label>
              <DatePicker value={tradeDate} onChange={setTradeDate} placeholder="Trade date" required /></div>
            {category === "Option" && <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Expiration</label>
              <DatePicker value={expiration} onChange={setExpiration} placeholder="Expiration" /></div>}
          </div>

          {/* DSF (Double Spread Fly) Dual Vertical Entry */}
          {isDualVertical ? (
            <div className="border border-primary/20 bg-primary/5 rounded-lg p-3 space-y-3">
              <p className="text-xs font-semibold text-primary">Dual Vertical Entry (2 spreads = butterfly)</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-bear-light mb-1 block">Buy Spread (Debit Leg)</label>
                  <input type="text" value={dsfBuyStrikes} onChange={e => setDsfBuyStrikes(e.target.value)}
                    placeholder="65/70" className="w-full h-8 px-3 text-xs bg-background border border-bear/30 rounded-md font-mono text-foreground mb-1" />
                  <div className="relative">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs font-bold text-bear-light">−$</span>
                    <input type="number" step="0.01" value={dsfBuyPrice} onChange={e => setDsfBuyPrice(e.target.value)}
                      placeholder="1.50" className="w-full h-8 pl-7 pr-3 text-xs bg-background border border-bear/30 rounded-md font-mono text-foreground" />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-bull-light mb-1 block">Sell Spread (Credit Leg)</label>
                  <input type="text" value={dsfSellStrikes} onChange={e => setDsfSellStrikes(e.target.value)}
                    placeholder="70/75" className="w-full h-8 px-3 text-xs bg-background border border-bull/30 rounded-md font-mono text-foreground mb-1" />
                  <div className="relative">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs font-bold text-bull-light">+$</span>
                    <input type="number" step="0.01" value={dsfSellPrice} onChange={e => setDsfSellPrice(e.target.value)}
                      placeholder="2.50" className="w-full h-8 pl-7 pr-3 text-xs bg-background border border-bull/30 rounded-md font-mono text-foreground" />
                  </div>
                </div>
              </div>
              {dsfBuyPrice && dsfSellPrice && (
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-muted-foreground">Net:</span>
                  <span className={`font-bold tabular-nums ${(parseFloat(dsfSellPrice) || 0) > (parseFloat(dsfBuyPrice) || 0) ? "text-bull-light" : "text-bear-light"}`}>
                    {(parseFloat(dsfSellPrice) || 0) > (parseFloat(dsfBuyPrice) || 0) ? "+" : "-"}${Math.abs((parseFloat(dsfSellPrice) || 0) - (parseFloat(dsfBuyPrice) || 0)).toFixed(2)} {(parseFloat(dsfSellPrice) || 0) > (parseFloat(dsfBuyPrice) || 0) ? "credit" : "debit"}
                  </span>
                  {dsfBuyStrikes && dsfSellStrikes && <span className="text-muted-foreground">Strikes: {dsfBuyStrikes}/{dsfSellStrikes}</span>}
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={`text-xs font-medium mb-1 block ${isCredit ? "text-bull-light" : "text-bear-light"}`}>{isCredit ? "Credit Received" : "Debit Paid"}</label>
                  <input type="number" step="0.01" value={openPrice} onChange={e => setOpenPrice(e.target.value)} placeholder="1.50" required
                    className={`w-full h-9 px-3 text-sm bg-background border rounded-md font-mono text-foreground ${isCredit ? "border-bull/30" : "border-bear/30"}`} /></div>
                {category === "Option" && numLegs >= 1 && <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Strike(s)</label>
                  <input type="text" value={strikes} onChange={e => setStrikes(e.target.value)} placeholder={numLegs >= 2 ? "55/60" : "55"}
                    className="w-full h-9 px-3 text-sm bg-background border border-card-border rounded-md font-mono text-foreground" /></div>}
              </div>
            </>
          )}

          <div className="grid grid-cols-2 gap-3">
            {numLegs >= 2 && !isDualVertical && <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Spread Width</label>
              <input type="number" step="0.5" value={spreadWidth} onChange={e => setSpreadWidth(e.target.value)} placeholder="5"
                className="w-full h-9 px-3 text-sm bg-background border border-card-border rounded-md text-foreground" /></div>}
            <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Allocation $</label>
              <input type="number" step="0.01" value={allocation} onChange={e => setAllocation(e.target.value)} placeholder="500"
                className="w-full h-9 px-3 text-sm bg-background border border-card-border rounded-md text-foreground" /></div>
          </div>
          <button type="submit" disabled={createMut.isPending || !symbol}
            className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 disabled:opacity-50">
            {createMut.isPending ? "Adding..." : "Add Trade"}
          </button>
        </form>
      </div>
    </div>
  );
}

function SidebarCloseTradeModal({ openTrades, settings, onClose }: { openTrades: any[]; settings: any; onClose: () => void }) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [closeDate, setCloseDate] = useState(new Date().toISOString().split("T")[0]);
  const [closePrice, setClosePrice] = useState("");

  const selected = openTrades.find(t => t.id === selectedId);
  const typeDef = selected ? TRADE_TYPES[selected.tradeType as TradeTypeCode] : null;
  const isCredit = typeDef?.isCredit ?? false;

  const closeMut = useMutation({
    mutationFn: async (data: any) => { const res = await apiRequest("POST", `/api/trades/${selectedId}/close`, data); return res.json(); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: [API_TRADES] }); queryClient.invalidateQueries({ queryKey: [API_TRADES_SUMMARY] }); onClose(); },
  });

  const handleClose = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedId || !selected) return;
    const rawClose = parseFloat(closePrice) || 0;
    const signedClose = isCredit ? -Math.abs(rawClose) : Math.abs(rawClose);
    const numLegs = typeDef?.legs || 0;
    let commOut = selected.tradeCategory === "Option" ? selected.contractsShares * numLegs * (settings?.commPerOptionContract || 0.65) : (settings?.commPerSharesTrade || 0);
    closeMut.mutate({ closeDate, closePrice: signedClose, commOut });
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border border-card-border rounded-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-card-border">
          <h2 className="text-base font-bold text-foreground">Close Trade</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>
        <form onSubmit={handleClose} className="p-4 space-y-4">
          {openTrades.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No open trades to close.</p>
          ) : (
            <>
              <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Select Position</label>
                <select value={selectedId || ""} onChange={e => setSelectedId(parseInt(e.target.value) || null)}
                  className="w-full h-9 px-3 text-sm bg-background border border-card-border rounded-md text-foreground">
                  <option value="">Choose a trade...</option>
                  {openTrades.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.symbol} {t.tradeType} — {t.contractsShares}{t.tradeCategory === "Option" ? "ct" : "sh"} @ {t.openPrice > 0 ? "+" : ""}{t.openPrice.toFixed(2)} ({t.tradeDate})
                    </option>
                  ))}
                </select>
              </div>
              {selected && (
                <>
                  <div className="bg-muted/30 border border-card-border/50 rounded-lg p-3">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-foreground">{selected.symbol}</span>
                      <span className={`text-micro font-semibold px-1.5 py-0.5 rounded ${isCredit ? "bg-bull/15 text-bull-light" : "bg-bear/15 text-bear-light"}`}>{selected.tradeType}</span>
                    </div>
                    <p className="text-2xs text-muted-foreground mt-1">{selected.contractsShares} {selected.tradeCategory === "Option" ? "contracts" : "shares"} · {selected.strikes || "no strikes"} · {selected.tradeDate}</p>
                  </div>
                  <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Close Date</label>
                    <DatePicker value={closeDate} onChange={setCloseDate} placeholder="Close date" required /></div>
                  <div><label className={`text-xs font-medium mb-1 block ${isCredit ? "text-bear-light" : "text-bull-light"}`}>
                    {isCredit ? "Cost to Close (Debit)" : "Proceeds (Credit)"}</label>
                    <input type="number" step="0.01" value={closePrice} onChange={e => setClosePrice(e.target.value)} placeholder="0.50" required
                      className="w-full h-9 px-3 text-sm bg-background border border-card-border rounded-md font-mono text-foreground" />
                    <p className="text-micro text-muted-foreground mt-1">{isCredit ? "Enter 0 if expired worthless" : "Enter 0 if expired worthless"}</p></div>
                  <button type="submit" disabled={closeMut.isPending}
                    className="w-full py-2.5 rounded-lg bg-watch text-white font-semibold text-sm hover:bg-watch disabled:opacity-50">
                    {closeMut.isPending ? "Closing..." : "Close Trade"}
                  </button>
                </>
              )}
            </>
          )}
        </form>
      </div>
    </div>
  );
}

function SidebarTradeRow({ t, handleSelectTicker }: { t: any; handleSelectTicker: (ticker: string) => void }) {
  let pl = 0;
  if (t.currentPrice && t.tradeCategory === 'Stock') {
    const isShort = t.creditDebit === 'CREDIT' || t.tradeType === 'SHORT';
    pl = isShort
      ? (Math.abs(t.openPrice) - t.currentPrice) * t.contractsShares
      : (t.currentPrice - Math.abs(t.openPrice)) * t.contractsShares;
  }
  const isUp = pl >= 0;
  return (
    <div onClick={() => handleSelectTicker(t.symbol)}
      className="flex items-center justify-between py-1.5 px-3 rounded-md cursor-pointer hover:bg-muted/50 transition-colors">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-mono font-bold text-xs text-foreground">{t.symbol}</span>
          <span className={`text-mini font-semibold px-1 py-0.5 rounded ${t.creditDebit === 'CREDIT' ? 'bg-bull/15 text-bull-light' : 'bg-bear/15 text-bear-light'}`}>{t.tradeType}</span>
        </div>
        <p className="text-micro text-muted-foreground">
          {t.contractsShares} {t.tradeCategory === 'Option' ? 'ct' : 'sh'} @ {t.openPrice > 0 ? '+' : ''}{t.openPrice.toFixed(2)}
        </p>
      </div>
      <div className="text-right shrink-0">
        {t.currentPrice ? (
          t.tradeCategory === 'Stock' ? (
            <>
              <div className={`text-2xs font-bold tabular-nums ${isUp ? 'text-bull-light' : 'text-bear-light'}`}>
                {isUp ? '+' : ''}{pl.toFixed(0)}
              </div>
              <div className="text-mini text-muted-foreground tabular-nums">${t.currentPrice.toFixed(2)}</div>
            </>
          ) : (
            <div className="text-mini text-muted-foreground tabular-nums">${t.currentPrice.toFixed(2)}</div>
          )
        ) : (
          <span className="text-micro text-muted-foreground">—</span>
        )}
      </div>
    </div>
  );
}

function SidebarContent({
  expanded,
  location,
  navGroups,
  helpItem,
  sortedWatchlist,
  removeMutation,
  refreshMutation,
  handleSelectTicker,
  activeTicker,
  analysisData,
  isAnalysisLoading,
  isInList,
  handleAddCurrent,
  addMutation,
  openTrades = [],
  groupOpen = {} as any,
  setGroupOpen = (_: any) => {},
  toggleGroup = (_: string) => {},
  setShowAddTrade = () => {},
  setShowCloseTrade = () => {},
}: any) {
  return (
    <>
      {/* Logo */}
      {expanded ? (
        <div className="px-2 py-3 border-b border-card-border" style={{ backgroundColor: 'rgb(var(--brand-bg))' }}>
          <img src={logoUrl} alt="Stock Otter" className="w-full h-auto" />
        </div>
      ) : (
        <div className="p-1.5 border-b border-card-border flex justify-center" style={{ backgroundColor: 'rgb(var(--brand-bg))' }}>
          <img src={iconUrl} alt="Stock Otter" className="w-full h-auto rounded-lg" />
        </div>
      )}

      {/* Grouped Navigation */}
      <nav className="p-2 space-y-1">
        {navGroups.map((group: any) => {
          const isOpen = groupOpen[group.label] === true;
          return (
            <div key={group.label}>
              {expanded && (
                <button
                  onClick={() => toggleGroup(group.label)}
                  className="flex items-center justify-between w-full px-3 py-2 mt-1 text-[12px] font-bold uppercase tracking-wider text-foreground/90 hover:text-foreground hover:bg-muted/40 rounded-md transition-colors"
                >
                  {group.label}
                  {isOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                </button>
              )}
              {(isOpen || !expanded) && group.items.map((item: any) => {
                const Icon = item.icon;
                const isActive = location === item.path;
                const isAction = item.path.startsWith("#");
                if (isAction) {
                  return (
                    <div
                      key={item.path}
                      onClick={() => {
                        if (item.path === "#add-trade") setShowAddTrade(true);
                        if (item.path === "#close-trade") setShowCloseTrade(true);
                      }}
                      className="flex items-center gap-3 py-1.5 px-3 rounded-md cursor-pointer transition-colors text-muted-foreground hover:bg-muted hover:text-foreground"
                      title={expanded ? undefined : item.label}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {expanded && <span className="text-sm font-medium truncate">{item.label}</span>}
                    </div>
                  );
                }
                return (
                  <Link key={item.path} href={item.path}>
                    <div
                      className={`flex items-center gap-3 py-1.5 px-3 rounded-md cursor-pointer transition-colors ${
                        isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      }`}
                      title={expanded ? undefined : item.label}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {expanded && <span className="text-sm font-medium truncate">{item.label}</span>}
                    </div>
                  </Link>
                );
              })}
            </div>
          );
        })}

        {/* Watchlist (collapsible group) */}
        {(() => {
          const isWatchlistOpen = groupOpen["Watchlist"] === true;
          return (
            <div>
              {expanded ? (
                <button
                  onClick={() => toggleGroup("Watchlist")}
                  className="flex items-center justify-between w-full px-3 py-2 mt-1 text-[12px] font-bold uppercase tracking-wider text-foreground/90 hover:text-foreground hover:bg-muted/40 rounded-md transition-colors"
                  data-testid="toggle-watchlist"
                >
                  <span className="flex items-center gap-2">
                    Watchlist
                    {sortedWatchlist.length > 0 && (
                      <span className="text-micro bg-primary/15 text-primary px-1.5 py-0.5 rounded-full tabular-nums">
                        {sortedWatchlist.length}
                      </span>
                    )}
                  </span>
                  {isWatchlistOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                </button>
              ) : (
                <div className="flex justify-center py-1.5 px-3" title="Watchlist">
                  <Eye className="h-4 w-4 text-muted-foreground" />
                </div>
              )}
              {isWatchlistOpen && expanded && (
                <div className="space-y-0.5 mt-1">
                  {sortedWatchlist.length === 0 ? (
                    <p className="text-micro text-muted-foreground text-center py-3">
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
                          <p className="text-micro text-muted-foreground truncate max-w-[100px]">
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
                            className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-bear p-0.5"
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
                      className="w-full flex items-center justify-center gap-1.5 py-1.5 text-micro text-muted-foreground hover:text-foreground transition-colors"
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
          );
        })()}

        {/* Active Options (collapsible group) */}
        {(() => {
          const optionTrades = openTrades.filter((t: any) => t.tradeCategory === 'Option');
          const isOptionsOpen = groupOpen["Active Options"] === true;
          return (
            <div>
              {expanded ? (
                <button
                  onClick={() => toggleGroup("Active Options")}
                  className="flex items-center justify-between w-full px-3 py-2 mt-1 text-[12px] font-bold uppercase tracking-wider text-foreground/90 hover:text-foreground hover:bg-muted/40 rounded-md transition-colors"
                  data-testid="toggle-trades"
                >
                  <span className="flex items-center gap-2">
                    Active Options
                    {optionTrades.length > 0 && <span className="text-micro bg-purple-500/15 text-purple-400 px-1.5 py-0.5 rounded-full tabular-nums">{optionTrades.length}</span>}
                  </span>
                  {isOptionsOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                </button>
              ) : (
                <div className="flex justify-center py-1.5 px-3" title="Active Options">
                  <ClipboardList className="h-4 w-4 text-muted-foreground" />
                </div>
              )}
              {isOptionsOpen && expanded && (
                <div className="space-y-0.5 mt-1">
                  {optionTrades.length === 0 ? <p className="text-micro text-muted-foreground text-center py-2">No open options</p>
                  : optionTrades.slice(0, 10).map((t: any) => <SidebarTradeRow key={t.id} t={t} handleSelectTicker={handleSelectTicker} />)}
                </div>
              )}
            </div>
          );
        })()}

        {/* Active Stocks (collapsible group) */}
        {(() => {
          const stockTrades = openTrades.filter((t: any) => t.tradeCategory === 'Stock');
          const isStocksOpen = groupOpen["Active Stocks"] === true;
          return (
            <div>
              {expanded ? (
                <button
                  onClick={() => toggleGroup("Active Stocks")}
                  className="flex items-center justify-between w-full px-3 py-2 mt-1 text-[12px] font-bold uppercase tracking-wider text-foreground/90 hover:text-foreground hover:bg-muted/40 rounded-md transition-colors"
                >
                  <span className="flex items-center gap-2">
                    Active Stocks
                    {stockTrades.length > 0 && <span className="text-micro bg-blue-500/15 text-blue-400 px-1.5 py-0.5 rounded-full tabular-nums">{stockTrades.length}</span>}
                  </span>
                  {isStocksOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                </button>
              ) : (
                <div className="flex justify-center py-1.5 px-3" title="Active Stocks">
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                </div>
              )}
              {isStocksOpen && expanded && (
                <div className="space-y-0.5 mt-1">
                  {stockTrades.length === 0 ? <p className="text-micro text-muted-foreground text-center py-2">No open stocks</p>
                  : stockTrades.slice(0, 10).map((t: any) => <SidebarTradeRow key={t.id} t={t} handleSelectTicker={handleSelectTicker} />)}
                </div>
              )}
            </div>
          );
        })()}
      </nav>

      {/* Pinned bottom */}
      <div className="mt-auto border-t border-card-border">
        {expanded && analysisData && !isAnalysisLoading && (
          <div className="p-2">
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
          </div>
        )}
        <Link href={helpItem.path}>
          <div className={`flex items-center gap-3 py-1.5 px-3 mx-2 mb-2 rounded-md cursor-pointer transition-colors ${
            location === helpItem.path ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}>
            <helpItem.icon className="h-4 w-4 shrink-0" />
            {expanded && <span className="text-sm font-medium truncate">{helpItem.label}</span>}
          </div>
        </Link>
      </div>
    </>
  );
}

// ─── Main Layout ────────────────────────────────────────────────────────────────

export function AppLayout({ children }: { children: React.ReactNode }) {
  const isMobile = useIsMobile();
  const [sidebarExpanded, setSidebarExpanded] = useState(!isMobile);
  const [location] = useLocation();
  const mainRef = useRef<HTMLElement>(null);

  // Reset scroll to top whenever the route changes — clicking a sidebar
  // link should always land at the top of the new page, never inherit
  // the previous page's scroll offset.
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [location]);

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
        <main ref={mainRef} className="flex-1 overflow-y-auto overflow-x-hidden" data-testid="main-content">
          {children}
        </main>
      </div>
    </div>
  );
}
