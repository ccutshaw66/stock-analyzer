import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import iconUrl from "@/assets/icon.png";
import logoUrl from "@/assets/logo.png";
import logoTextUrl from "@/assets/logo-text.png";
import {
  BarChart3,
  Activity,
  Radar,
  ChevronLeft,
  ChevronRight,
  Eye,
  Trash2,
  RefreshCw,
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
  Award,
  Plus,
  CheckCircle2,
  LineChart,
  Sigma,
  Grid3X3,
  Calendar,
  PieChart,
  Percent,
  LogOut,
  UserCircle,
  Shield,
  DollarSign,
  Landmark,
  Crosshair,
  Trophy,
} from "lucide-react";
import { useTicker } from "@/contexts/TickerContext";
import { TRADE_TYPES, type TradeTypeCode } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
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
  const { activeTicker, setActiveTicker, analysisData, isAnalysisLoading } =
    useTicker();
  const { user, logout } = useAuth();
  const { tier } = useSubscription();
  const [input, setInput] = useState("");
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [searchResults, setSearchResults] = useState<{ symbol: string; name: string; type: string }[]>([]);
  const [showSearch, setShowSearch] = useState(false);
  const [, navigate] = useLocation();

  // Debounced search — triggers when user types 2+ chars that look like a name (not a pure ticker)
  const searchTimerRef = useRef<any>(null);
  const handleInputChange = (val: string) => {
    setInput(val);
    // If it looks like a company name (has lowercase, or 5+ chars), search
    const isName = val.length >= 2 && (/[a-z]/.test(val) || val.length >= 4);
    if (isName) {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      searchTimerRef.current = setTimeout(async () => {
        try {
          const res = await apiRequest("GET", `/api/search?q=${encodeURIComponent(val)}`);
          const data = await res.json();
          setSearchResults(data);
          setShowSearch(data.length > 0);
        } catch { setSearchResults([]); setShowSearch(false); }
      }, 300);
    } else {
      setShowSearch(false);
    }
  };

  const selectResult = (symbol: string) => {
    setActiveTicker(symbol);
    setInput("");
    setShowSearch(false);
    setSearchResults([]);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim().toUpperCase();
    if (trimmed) {
      setActiveTicker(trimmed);
      setInput("");
      setShowSearch(false);
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
        <div className="hidden sm:flex items-center shrink-0 cursor-pointer" data-testid="link-home-logo" style={{ backgroundColor: '#040d22' }}>
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
                    <span className="text-[10px] text-muted-foreground ml-2 truncate">{r.name}</span>
                  </div>
                  <span className="text-[9px] text-muted-foreground shrink-0 ml-2">{r.type}</span>
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

      {/* User dropdown menu */}
      {user && (
        <div className={`relative shrink-0 ${!analysisData && !isAnalysisLoading ? "ml-auto" : "ml-2"}`}>
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
                  <p className="text-[11px] text-muted-foreground truncate">{user.email}</p>
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
                    className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:bg-red-500/10 hover:text-red-400 cursor-pointer"
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
    const signalColor = verdict.startsWith("GO") ? "bg-green-500" :
      verdict.startsWith("SET") ? "bg-blue-500" :
      verdict.startsWith("READY") ? "bg-amber-500" :
      verdict.startsWith("PULLBACK") ? "bg-orange-500" :
      verdict.startsWith("GATES") ? "bg-red-500" :
      "bg-zinc-500";
    // For PULLBACK/GATES CLOSED, tint ALL the active pips to match the signal
    // color so the watchlist row reads as a single state (not mixed gate colors).
    const isExitState = verdict.startsWith("PULLBACK") || verdict.startsWith("GATES");
    const exitPipColor = verdict.startsWith("PULLBACK") ? "bg-orange-500" : "bg-red-500";
    return (
      <div className="flex items-center gap-1">
        <div className="flex gap-0.5">
          {[1, 2, 3].map((g) => (
            <div key={g} className={`h-1 w-2 rounded-full ${
              g <= gatesCleared
                ? isExitState
                  ? exitPipColor
                  : g === 3 ? "bg-green-500" : g === 2 ? "bg-blue-500" : "bg-amber-500"
                : "bg-muted-foreground/20"
            }`} />
          ))}
        </div>
        <span className={`text-[9px] font-bold px-1 py-0.5 rounded ${signalColor} text-white leading-none`}>
          {verdict}
        </span>
      </div>
    );
  }

  // Legacy profile score — show refresh indicator
  return (
    <span className="text-[9px] text-muted-foreground/50 italic">refresh</span>
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
    queryKey: ["/api/trades"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/trades");
      return res.json();
    },
  });
  const openTrades = allTrades.filter(t => !t.closeDate);

  // Account settings for trade modals
  const { data: accountSettings } = useQuery<any>({
    queryKey: ["/api/account/settings"],
    queryFn: async () => { const res = await apiRequest("GET", "/api/account/settings"); return res.json(); },
  });

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
      // force=1 bypasses server-side 15min cache so manual Refresh
      // button always returns fresh gate signals.
      const res = await apiRequest(
        "POST",
        `/api/favorites/${listType}/refresh?force=1`
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

  const handleSelectTicker = (ticker: string) => {
    setActiveTicker(ticker);
    if (isMobile) onClose();
  };

  // Grouped nav structure
  const navGroups = [
    {
      label: "Trade Tracker",
      items: [
        { path: "/tracker", label: "Current Positions", icon: ClipboardList },
        { path: "/dividend-portfolio", label: "Dividend Positions", icon: Landmark },
        { path: "#add-trade", label: "Add Trade", icon: Plus },
        { path: "#close-trade", label: "Close Trade", icon: CheckCircle2 },
        { path: "/analytics", label: "Performance Analytics", icon: PieChart },
      ],
    },
    {
      label: "Company Research",
      items: [
        { path: "/profile", label: "Profile", icon: BarChart3 },
        { path: "/trade", label: "Trade Analysis", icon: Activity },
        ...(tier !== "free" ? [{ path: "/mm-exposure", label: "MM Exposure", icon: Crosshair }] : []),
        { path: "/institutional", label: "Institutions", icon: Building2 },
        { path: "/verdict", label: "Long-Term Outlook", icon: Award },
      ],
    },
    {
      label: "Investment Opportunities",
      items: [
        { path: "/scanner", label: "Scanner", icon: Radar },
        { path: "/sectors", label: "Sector Heatmap", icon: Grid3X3 },
        { path: "/earnings", label: "Earnings Calendar", icon: Calendar },
        { path: "/dividends", label: "Dividend Finder", icon: DollarSign },
        { path: "/track-record", label: "Track Record", icon: Trophy },
      ],
    },
    {
      label: "Calculators",
      items: [
        { path: "/calculator", label: "Options Calculator", icon: Calculator },
        { path: "/payoff", label: "Payoff Diagram", icon: LineChart },
        { path: "/greeks", label: "Greeks Calculator", icon: Sigma },
        { path: "/kelly", label: "Kelly Criterion", icon: Percent },
        { path: "/wheel", label: "Wheel Strategy", icon: RefreshCw },
      ],
    },
  ];
  const helpItem = { path: "/help", label: "Help / FAQ", icon: BookOpen };

  const sortedWatchlist = [...watchlistItems].sort(
    (a, b) => (b.score ?? 0) - (a.score ?? 0)
  );
  // Add/Close trade modal states
  const [showAddTrade, setShowAddTrade] = useState(false);
  const [showCloseTrade, setShowCloseTrade] = useState(false);
  const [groupOpen, setGroupOpen] = useState<Record<string, boolean>>({ "Company Information": true, "Research": true, "Calculators": true, "Trade Tracker": true, "Watchlist": true, "Active Options": true, "Active Stocks": true });

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

  // CTV dual-vertical fields
  const [ctvBuyStrikes, setCtvBuyStrikes] = useState("");
  const [ctvBuyPrice, setCtvBuyPrice] = useState("");
  const [ctvSellStrikes, setCtvSellStrikes] = useState("");
  const [ctvSellPrice, setCtvSellPrice] = useState("");

  const typeDef = TRADE_TYPES[tradeType];
  const isCredit = typeDef?.isCredit ?? false;
  const isDualVertical = (typeDef as any)?.isDualVertical ?? false;
  const numLegs = typeDef?.legs || 0;
  const filteredTypes = category === "Stock" ? STOCK_TYPES : OPTION_TYPES;

  const createMut = useMutation({
    mutationFn: async (data: any) => { const res = await apiRequest("POST", "/api/trades", data); return res.json(); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/trades"] }); queryClient.invalidateQueries({ queryKey: ["/api/trades/summary"] }); onClose(); },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    let rawPrice = parseFloat(openPrice) || 0;
    // CTV: calculate net from two legs
    if (isDualVertical && ctvBuyPrice && ctvSellPrice) {
      const buyP = parseFloat(ctvBuyPrice) || 0;
      const sellP = parseFloat(ctvSellPrice) || 0;
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
      strikes: isDualVertical ? `${ctvBuyStrikes}|${ctvSellStrikes}` : (strikes || null),
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

          {/* CTV Dual Vertical Entry */}
          {isDualVertical ? (
            <div className="border border-primary/20 bg-primary/5 rounded-lg p-3 space-y-3">
              <p className="text-xs font-semibold text-primary">Dual Vertical Entry (2 spreads = butterfly)</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-red-400 mb-1 block">Buy Spread (Debit Leg)</label>
                  <input type="text" value={ctvBuyStrikes} onChange={e => setCtvBuyStrikes(e.target.value)}
                    placeholder="65/70" className="w-full h-8 px-3 text-xs bg-background border border-red-500/30 rounded-md font-mono text-foreground mb-1" />
                  <div className="relative">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs font-bold text-red-400">−$</span>
                    <input type="number" step="0.01" value={ctvBuyPrice} onChange={e => setCtvBuyPrice(e.target.value)}
                      placeholder="1.50" className="w-full h-8 pl-7 pr-3 text-xs bg-background border border-red-500/30 rounded-md font-mono text-foreground" />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-green-400 mb-1 block">Sell Spread (Credit Leg)</label>
                  <input type="text" value={ctvSellStrikes} onChange={e => setCtvSellStrikes(e.target.value)}
                    placeholder="70/75" className="w-full h-8 px-3 text-xs bg-background border border-green-500/30 rounded-md font-mono text-foreground mb-1" />
                  <div className="relative">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs font-bold text-green-400">+$</span>
                    <input type="number" step="0.01" value={ctvSellPrice} onChange={e => setCtvSellPrice(e.target.value)}
                      placeholder="2.50" className="w-full h-8 pl-7 pr-3 text-xs bg-background border border-green-500/30 rounded-md font-mono text-foreground" />
                  </div>
                </div>
              </div>
              {ctvBuyPrice && ctvSellPrice && (
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-muted-foreground">Net:</span>
                  <span className={`font-bold tabular-nums ${(parseFloat(ctvSellPrice) || 0) > (parseFloat(ctvBuyPrice) || 0) ? "text-green-400" : "text-red-400"}`}>
                    {(parseFloat(ctvSellPrice) || 0) > (parseFloat(ctvBuyPrice) || 0) ? "+" : "-"}${Math.abs((parseFloat(ctvSellPrice) || 0) - (parseFloat(ctvBuyPrice) || 0)).toFixed(2)} {(parseFloat(ctvSellPrice) || 0) > (parseFloat(ctvBuyPrice) || 0) ? "credit" : "debit"}
                  </span>
                  {ctvBuyStrikes && ctvSellStrikes && <span className="text-muted-foreground">Strikes: {ctvBuyStrikes}/{ctvSellStrikes}</span>}
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={`text-xs font-medium mb-1 block ${isCredit ? "text-green-400" : "text-red-400"}`}>{isCredit ? "Credit Received" : "Debit Paid"}</label>
                  <input type="number" step="0.01" value={openPrice} onChange={e => setOpenPrice(e.target.value)} placeholder="1.50" required
                    className={`w-full h-9 px-3 text-sm bg-background border rounded-md font-mono text-foreground ${isCredit ? "border-green-500/30" : "border-red-500/30"}`} /></div>
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
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/trades"] }); queryClient.invalidateQueries({ queryKey: ["/api/trades/summary"] }); onClose(); },
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
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${isCredit ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"}`}>{selected.tradeType}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1">{selected.contractsShares} {selected.tradeCategory === "Option" ? "contracts" : "shares"} · {selected.strikes || "no strikes"} · {selected.tradeDate}</p>
                  </div>
                  <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Close Date</label>
                    <DatePicker value={closeDate} onChange={setCloseDate} placeholder="Close date" required /></div>
                  <div><label className={`text-xs font-medium mb-1 block ${isCredit ? "text-red-400" : "text-green-400"}`}>
                    {isCredit ? "Cost to Close (Debit)" : "Proceeds (Credit)"}</label>
                    <input type="number" step="0.01" value={closePrice} onChange={e => setClosePrice(e.target.value)} placeholder="0.50" required
                      className="w-full h-9 px-3 text-sm bg-background border border-card-border rounded-md font-mono text-foreground" />
                    <p className="text-[10px] text-muted-foreground mt-1">{isCredit ? "Enter 0 if expired worthless" : "Enter 0 if expired worthless"}</p></div>
                  <button type="submit" disabled={closeMut.isPending}
                    className="w-full py-2.5 rounded-lg bg-yellow-600 text-white font-semibold text-sm hover:bg-yellow-700 disabled:opacity-50">
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
  setShowAddTrade = () => {},
  setShowCloseTrade = () => {},
}: any) {
  return (
    <>
      {/* Logo */}
      {expanded ? (
        <div className="px-2 py-3 border-b border-card-border" style={{ backgroundColor: '#040d22' }}>
          <img src={logoUrl} alt="Stock Otter" className="w-full h-auto" />
        </div>
      ) : (
        <div className="p-1.5 border-b border-card-border flex justify-center" style={{ backgroundColor: '#040d22' }}>
          <img src={iconUrl} alt="Stock Otter" className="w-full h-auto rounded-lg" />
        </div>
      )}

      {/* Grouped Navigation */}
      <nav className="p-2 space-y-1">
        {navGroups.map((group: any) => {
          const isOpen = groupOpen[group.label] !== false;
          return (
            <div key={group.label}>
              {expanded && (
                <button
                  onClick={() => setGroupOpen((prev: any) => ({ ...prev, [group.label]: !isOpen }))}
                  className="flex items-center justify-between w-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60 hover:text-muted-foreground"
                >
                  {group.label}
                  {isOpen ? <ChevronUp className="h-2.5 w-2.5" /> : <ChevronDown className="h-2.5 w-2.5" />}
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
          const isWatchlistOpen = groupOpen["Watchlist"] !== false;
          return (
            <div>
              {expanded ? (
                <button
                  onClick={() => setGroupOpen((prev: any) => ({ ...prev, Watchlist: !isWatchlistOpen }))}
                  className="flex items-center justify-between w-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60 hover:text-muted-foreground"
                  data-testid="toggle-watchlist"
                >
                  <span className="flex items-center gap-2">
                    Watchlist
                    {sortedWatchlist.length > 0 && (
                      <span className="text-[10px] bg-primary/15 text-primary px-1.5 py-0.5 rounded-full tabular-nums">
                        {sortedWatchlist.length}
                      </span>
                    )}
                  </span>
                  {isWatchlistOpen ? <ChevronUp className="h-2.5 w-2.5" /> : <ChevronDown className="h-2.5 w-2.5" />}
                </button>
              ) : (
                <div className="flex justify-center py-1.5 px-3" title="Watchlist">
                  <Eye className="h-4 w-4 text-muted-foreground" />
                </div>
              )}
              {isWatchlistOpen && expanded && (
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
          );
        })()}

        {/* Active Options (collapsible group) */}
        {(() => {
          const optionTrades = openTrades.filter((t: any) => t.tradeCategory === 'Option');
          const isOptionsOpen = groupOpen["Active Options"] !== false;
          return (
            <div>
              {expanded ? (
                <button
                  onClick={() => setGroupOpen((prev: any) => ({ ...prev, "Active Options": !isOptionsOpen }))}
                  className="flex items-center justify-between w-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60 hover:text-muted-foreground"
                  data-testid="toggle-trades"
                >
                  <span className="flex items-center gap-2">
                    Active Options
                    {optionTrades.length > 0 && <span className="text-[10px] bg-purple-500/15 text-purple-400 px-1.5 py-0.5 rounded-full tabular-nums">{optionTrades.length}</span>}
                  </span>
                  {isOptionsOpen ? <ChevronUp className="h-2.5 w-2.5" /> : <ChevronDown className="h-2.5 w-2.5" />}
                </button>
              ) : (
                <div className="flex justify-center py-1.5 px-3" title="Active Options">
                  <ClipboardList className="h-4 w-4 text-muted-foreground" />
                </div>
              )}
              {isOptionsOpen && expanded && (
                <div className="space-y-0.5 mt-1">
                  {optionTrades.length === 0 ? <p className="text-[10px] text-muted-foreground text-center py-2">No open options</p>
                  : optionTrades.slice(0, 10).map((t: any) => <SidebarTradeRow key={t.id} t={t} handleSelectTicker={handleSelectTicker} />)}
                </div>
              )}
            </div>
          );
        })()}

        {/* Active Stocks (collapsible group) */}
        {(() => {
          const stockTrades = openTrades.filter((t: any) => t.tradeCategory === 'Stock');
          const isStocksOpen = groupOpen["Active Stocks"] !== false;
          return (
            <div>
              {expanded ? (
                <button
                  onClick={() => setGroupOpen((prev: any) => ({ ...prev, "Active Stocks": !isStocksOpen }))}
                  className="flex items-center justify-between w-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60 hover:text-muted-foreground"
                >
                  <span className="flex items-center gap-2">
                    Active Stocks
                    {stockTrades.length > 0 && <span className="text-[10px] bg-blue-500/15 text-blue-400 px-1.5 py-0.5 rounded-full tabular-nums">{stockTrades.length}</span>}
                  </span>
                  {isStocksOpen ? <ChevronUp className="h-2.5 w-2.5" /> : <ChevronDown className="h-2.5 w-2.5" />}
                </button>
              ) : (
                <div className="flex justify-center py-1.5 px-3" title="Active Stocks">
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                </div>
              )}
              {isStocksOpen && expanded && (
                <div className="space-y-0.5 mt-1">
                  {stockTrades.length === 0 ? <p className="text-[10px] text-muted-foreground text-center py-2">No open stocks</p>
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
        <main className="flex-1 overflow-y-auto overflow-x-hidden" data-testid="main-content">
          {children}
        </main>
      </div>
    </div>
  );
}
