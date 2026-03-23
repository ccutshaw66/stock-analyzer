import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/format";
import { TRADE_TYPES, BEHAVIOR_TAGS, type TradeTypeCode } from "@shared/schema";
import {
  Plus, Trash2, RefreshCw, X, ChevronDown, ChevronUp, Edit2,
  TrendingUp, TrendingDown, DollarSign, BarChart3, Target, Settings,
  CheckCircle2, XCircle, Loader2, Filter, ArrowUpDown
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Trade {
  id: number;
  pilotOrAdd: string;
  tradeDate: string;
  expiration: string | null;
  contractsShares: number;
  symbol: string;
  currentPrice: number | null;
  target: number | null;
  tradeType: string;
  tradeCategory: string;
  strikes: string | null;
  openPrice: number;
  commIn: number | null;
  allocation: number | null;
  maxProfit: number | null;
  closeDate: string | null;
  closePrice: number | null;
  commOut: number | null;
  spreadWidth: number | null;
  creditDebit: string | null;
  tradePlanNotes: string | null;
  behaviorTag: string | null;
  createdAt: string;
}

interface Summary {
  totalTrades: number;
  openTrades: number;
  totalProfit: number;
  totalWins: number;
  winRate: number;
  accountValue: number;
  openPL: number;
  allocated: number;
  allocatedPct: number;
  byType: Record<string, { profit: number; loss: number; count: number; wins: number; investment: number }>;
  equityCurve: { date: string; value: number }[];
  behaviorCounts: Record<string, number>;
  settings: any;
}

interface AccountSettings {
  id: number;
  startingAccountValue: number;
  commPerSharesTrade: number;
  commPerOptionContract: number;
  maxAllocationPerTrade: number;
  totalAllocatedLimit: number;
}

type FilterTab = "all" | "open" | "closed" | "stocks" | "options";
type SortField = "tradeDate" | "symbol" | "tradeType" | "openPrice" | "profit";

const STOCK_TYPES: TradeTypeCode[] = ["LONG", "SHORT", "DTS"];
const OPTION_TYPES = Object.keys(TRADE_TYPES).filter(k => !STOCK_TYPES.includes(k as TradeTypeCode)) as TradeTypeCode[];

function computeTradeProfit(t: Trade): number {
  if (!t.closeDate) return 0;
  const mult = t.tradeCategory === "Option" ? 100 : 1;
  const open = t.openPrice * t.contractsShares * mult;
  const close = (t.closePrice || 0) * t.contractsShares * mult;
  return open + close - (t.commIn || 0) - (t.commOut || 0);
}

function computeOpenPL(t: Trade): number {
  if (!t.currentPrice || t.closeDate) return 0;
  const mult = t.tradeCategory === "Option" ? 100 : 1;
  const costOpen = t.openPrice * t.contractsShares * mult;
  const currentVal = t.currentPrice * t.contractsShares * mult;
  if (t.creditDebit === "CREDIT") {
    return costOpen - currentVal - (t.commIn || 0);
  }
  return currentVal + costOpen - (t.commIn || 0);
}

function daysInTrade(t: Trade): number {
  const start = new Date(t.tradeDate);
  const end = t.closeDate ? new Date(t.closeDate) : new Date();
  return Math.max(0, Math.ceil((end.getTime() - start.getTime()) / 86400000));
}

// ─── Add Trade Modal ──────────────────────────────────────────────────────────

function AddTradeModal({ onClose, settings }: { onClose: () => void; settings: AccountSettings }) {
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
  const [notes, setNotes] = useState("");
  const [behaviorTag, setBehaviorTag] = useState("");

  const typeDef = TRADE_TYPES[tradeType];
  const isCredit = openPrice !== "" && parseFloat(openPrice) > 0;
  const numLegs = typeDef?.legs || 0;

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/trades", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trades"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trades/summary"] });
      onClose();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const price = parseFloat(openPrice) || 0;
    const sw = parseFloat(spreadWidth) || null;
    const alloc = parseFloat(allocation) || null;

    // Auto-calculate commission
    let commIn = 0;
    if (category === "Option") {
      commIn = contractsShares * numLegs * (settings.commPerOptionContract || 0.65);
    } else {
      commIn = settings.commPerSharesTrade || 0;
    }

    // Auto-calculate max profit for spreads
    let maxProfit: number | null = null;
    if (sw && numLegs >= 2) {
      if (isCredit) {
        maxProfit = price * contractsShares * 100;
      } else {
        maxProfit = (sw - Math.abs(price)) * contractsShares * 100;
      }
    }

    // Auto-calculate target
    const targetROI = typeDef?.targetROI || 0;
    const target = targetROI > 0 ? Math.abs(price) * (targetROI / 100) : null;

    createMutation.mutate({
      pilotOrAdd,
      tradeDate,
      expiration: expiration || null,
      contractsShares,
      symbol: symbol.toUpperCase(),
      tradeType,
      tradeCategory: category,
      strikes: strikes || null,
      openPrice: price,
      commIn,
      allocation: alloc,
      maxProfit,
      target,
      spreadWidth: sw,
      creditDebit: price > 0 ? "CREDIT" : "DEBIT",
      tradePlanNotes: notes || null,
      behaviorTag: behaviorTag || null,
    });
  };

  const filteredTypes = category === "Stock" ? STOCK_TYPES : OPTION_TYPES;

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border border-card-border rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-card-border">
          <h2 className="text-base font-bold text-foreground">Add Trade</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Category Toggle */}
          <div className="flex gap-2">
            {(["Stock", "Option"] as const).map(cat => (
              <button
                key={cat}
                type="button"
                onClick={() => {
                  setCategory(cat);
                  setTradeType(cat === "Stock" ? "LONG" : "C");
                }}
                className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${
                  category === cat
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Row 1: Type + Pilot/Add */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Trade Type</label>
              <select
                value={tradeType}
                onChange={e => setTradeType(e.target.value as TradeTypeCode)}
                className="w-full h-9 px-3 text-sm bg-background border border-card-border rounded-md text-foreground"
                data-testid="select-trade-type"
              >
                {filteredTypes.map(code => (
                  <option key={code} value={code}>{code} - {TRADE_TYPES[code].label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Pilot / Add</label>
              <select
                value={pilotOrAdd}
                onChange={e => setPilotOrAdd(e.target.value)}
                className="w-full h-9 px-3 text-sm bg-background border border-card-border rounded-md text-foreground"
              >
                <option value="Pilot">Pilot</option>
                <option value="Add">Add</option>
              </select>
            </div>
          </div>

          {/* Row 2: Symbol + Contracts/Shares */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Symbol</label>
              <input
                type="text"
                value={symbol}
                onChange={e => setSymbol(e.target.value.toUpperCase())}
                placeholder="AAPL"
                className="w-full h-9 px-3 text-sm bg-background border border-card-border rounded-md font-mono text-foreground"
                required
                data-testid="input-trade-symbol"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                {category === "Option" ? "Contracts" : "Shares"}
              </label>
              <input
                type="number"
                value={contractsShares}
                onChange={e => setContractsShares(parseInt(e.target.value) || 1)}
                min={1}
                className="w-full h-9 px-3 text-sm bg-background border border-card-border rounded-md text-foreground"
              />
            </div>
          </div>

          {/* Row 3: Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Trade Date</label>
              <input
                type="date"
                value={tradeDate}
                onChange={e => setTradeDate(e.target.value)}
                className="w-full h-9 px-3 text-sm bg-background border border-card-border rounded-md text-foreground"
                required
              />
            </div>
            {category === "Option" && (
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Expiration</label>
                <input
                  type="date"
                  value={expiration}
                  onChange={e => setExpiration(e.target.value)}
                  className="w-full h-9 px-3 text-sm bg-background border border-card-border rounded-md text-foreground"
                />
              </div>
            )}
          </div>

          {/* Row 4: Open Price + Strikes */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                Open Price <span className="text-[10px]">(+ credit, - debit)</span>
              </label>
              <input
                type="number"
                step="0.01"
                value={openPrice}
                onChange={e => setOpenPrice(e.target.value)}
                placeholder="-2.50"
                className="w-full h-9 px-3 text-sm bg-background border border-card-border rounded-md font-mono text-foreground"
                required
              />
            </div>
            {category === "Option" && numLegs >= 1 && (
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">
                  Strike(s) <span className="text-[10px]">e.g. 55/60</span>
                </label>
                <input
                  type="text"
                  value={strikes}
                  onChange={e => setStrikes(e.target.value)}
                  placeholder={numLegs >= 3 ? "55/60/65" : numLegs >= 2 ? "55/60" : "55"}
                  className="w-full h-9 px-3 text-sm bg-background border border-card-border rounded-md font-mono text-foreground"
                />
              </div>
            )}
          </div>

          {/* Row 5: Spread Width + Allocation */}
          <div className="grid grid-cols-2 gap-3">
            {numLegs >= 2 && (
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Spread Width</label>
                <input
                  type="number"
                  step="0.5"
                  value={spreadWidth}
                  onChange={e => setSpreadWidth(e.target.value)}
                  placeholder="5"
                  className="w-full h-9 px-3 text-sm bg-background border border-card-border rounded-md text-foreground"
                />
              </div>
            )}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Allocation / Risk $</label>
              <input
                type="number"
                step="0.01"
                value={allocation}
                onChange={e => setAllocation(e.target.value)}
                placeholder="500"
                className="w-full h-9 px-3 text-sm bg-background border border-card-border rounded-md text-foreground"
              />
            </div>
          </div>

          {/* Behavior Tag */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Behavior Tag</label>
            <select
              value={behaviorTag}
              onChange={e => setBehaviorTag(e.target.value)}
              className="w-full h-9 px-3 text-sm bg-background border border-card-border rounded-md text-foreground"
            >
              <option value="">None</option>
              {BEHAVIOR_TAGS.map(tag => (
                <option key={tag} value={tag}>{tag}</option>
              ))}
            </select>
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Trade Plan Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 text-sm bg-background border border-card-border rounded-md text-foreground resize-none"
              placeholder="Entry rule, catalyst, setup..."
            />
          </div>

          {/* Info badges */}
          <div className="flex flex-wrap gap-2">
            <span className={`text-[11px] px-2 py-1 rounded-md font-semibold ${isCredit ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"}`}>
              {isCredit ? "CREDIT" : "DEBIT"}
            </span>
            <span className="text-[11px] px-2 py-1 rounded-md bg-muted text-muted-foreground">
              {numLegs} leg{numLegs !== 1 ? "s" : ""}
            </span>
            {typeDef?.targetROI > 0 && (
              <span className="text-[11px] px-2 py-1 rounded-md bg-primary/15 text-primary">
                Target ROI: {typeDef.targetROI}%
              </span>
            )}
          </div>

          <button
            type="submit"
            disabled={createMutation.isPending || !symbol}
            className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
            data-testid="button-submit-trade"
          >
            {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Add Trade
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── Close Trade Modal ────────────────────────────────────────────────────────

function CloseTradeModal({ trade, onClose, settings }: { trade: Trade; onClose: () => void; settings: AccountSettings }) {
  const [closeDate, setCloseDate] = useState(new Date().toISOString().split("T")[0]);
  const [closePrice, setClosePrice] = useState("");

  const closeMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", `/api/trades/${trade.id}/close`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trades"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trades/summary"] });
      onClose();
    },
  });

  const handleClose = (e: React.FormEvent) => {
    e.preventDefault();
    const typeDef = TRADE_TYPES[trade.tradeType as TradeTypeCode];
    const numLegs = typeDef?.legs || 0;
    let commOut = 0;
    if (trade.tradeCategory === "Option") {
      commOut = trade.contractsShares * numLegs * (settings.commPerOptionContract || 0.65);
    } else {
      commOut = settings.commPerSharesTrade || 0;
    }
    closeMutation.mutate({
      closeDate,
      closePrice: parseFloat(closePrice) || 0,
      commOut,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border border-card-border rounded-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-card-border">
          <h2 className="text-base font-bold text-foreground">Close Trade: {trade.symbol} ({trade.tradeType})</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>
        <form onSubmit={handleClose} className="p-4 space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Close Date</label>
            <input type="date" value={closeDate} onChange={e => setCloseDate(e.target.value)}
              className="w-full h-9 px-3 text-sm bg-background border border-card-border rounded-md text-foreground" required />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Close Price (+ credit, - debit)</label>
            <input type="number" step="0.01" value={closePrice} onChange={e => setClosePrice(e.target.value)}
              placeholder="0.00" className="w-full h-9 px-3 text-sm bg-background border border-card-border rounded-md font-mono text-foreground" required />
          </div>
          <button type="submit" disabled={closeMutation.isPending}
            className="w-full py-2.5 rounded-lg bg-yellow-600 text-white font-semibold text-sm hover:bg-yellow-700 disabled:opacity-50 flex items-center justify-center gap-2">
            {closeMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Close Trade
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── Settings Panel ───────────────────────────────────────────────────────────

function SettingsPanel({ settings, onClose }: { settings: AccountSettings; onClose: () => void }) {
  const [vals, setVals] = useState(settings);

  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("PATCH", "/api/account/settings", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/account/settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trades/summary"] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border border-card-border rounded-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-card-border">
          <h2 className="text-base font-bold text-foreground">Account Settings</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>
        <div className="p-4 space-y-3">
          {([
            ["startingAccountValue", "Starting Account Value ($)"],
            ["commPerSharesTrade", "Commission per Stock Trade ($)"],
            ["commPerOptionContract", "Commission per Option Contract ($)"],
            ["maxAllocationPerTrade", "Max Allocation per Trade ($)"],
            ["totalAllocatedLimit", "Total Allocated Limit (decimal)"],
          ] as const).map(([key, label]) => (
            <div key={key}>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">{label}</label>
              <input
                type="number"
                step="0.01"
                value={vals[key] ?? ""}
                onChange={e => setVals(v => ({ ...v, [key]: parseFloat(e.target.value) || 0 }))}
                className="w-full h-9 px-3 text-sm bg-background border border-card-border rounded-md text-foreground"
              />
            </div>
          ))}
          <button
            onClick={() => saveMutation.mutate(vals)}
            disabled={saveMutation.isPending}
            className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 disabled:opacity-50"
          >
            {saveMutation.isPending ? "Saving..." : "Save Settings"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function TradeTracker() {
  const [showAddModal, setShowAddModal] = useState(false);
  const [closingTrade, setClosingTrade] = useState<Trade | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [filterTab, setFilterTab] = useState<FilterTab>("all");
  const [sortField, setSortField] = useState<SortField>("tradeDate");
  const [sortAsc, setSortAsc] = useState(false);

  const { data: trades = [], isLoading } = useQuery<Trade[]>({
    queryKey: ["/api/trades"],
    queryFn: async () => { const r = await apiRequest("GET", "/api/trades"); return r.json(); },
  });

  const { data: summary } = useQuery<Summary>({
    queryKey: ["/api/trades/summary"],
    queryFn: async () => { const r = await apiRequest("GET", "/api/trades/summary"); return r.json(); },
  });

  const { data: settings } = useQuery<AccountSettings>({
    queryKey: ["/api/account/settings"],
    queryFn: async () => { const r = await apiRequest("GET", "/api/account/settings"); return r.json(); },
  });

  const refreshMutation = useMutation({
    mutationFn: async () => { const r = await apiRequest("POST", "/api/trades/refresh-prices"); return r.json(); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trades"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trades/summary"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => { await apiRequest("DELETE", `/api/trades/${id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trades"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trades/summary"] });
    },
  });

  // Filter & sort
  const filtered = useMemo(() => {
    let list = [...trades];
    if (filterTab === "open") list = list.filter(t => !t.closeDate);
    else if (filterTab === "closed") list = list.filter(t => !!t.closeDate);
    else if (filterTab === "stocks") list = list.filter(t => t.tradeCategory === "Stock");
    else if (filterTab === "options") list = list.filter(t => t.tradeCategory === "Option");

    list.sort((a, b) => {
      let cmp = 0;
      if (sortField === "tradeDate") cmp = a.tradeDate.localeCompare(b.tradeDate);
      else if (sortField === "symbol") cmp = a.symbol.localeCompare(b.symbol);
      else if (sortField === "tradeType") cmp = a.tradeType.localeCompare(b.tradeType);
      else if (sortField === "openPrice") cmp = a.openPrice - b.openPrice;
      else if (sortField === "profit") cmp = computeTradeProfit(a) - computeTradeProfit(b);
      return sortAsc ? cmp : -cmp;
    });
    return list;
  }, [trades, filterTab, sortField, sortAsc]);

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortAsc(!sortAsc);
    else { setSortField(field); setSortAsc(false); }
  };

  const SortButton = ({ field, label }: { field: SortField; label: string }) => (
    <button
      onClick={() => handleSort(field)}
      className={`flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider hover:text-foreground ${
        sortField === field ? "text-primary" : "text-muted-foreground"
      }`}
    >
      {label}
      {sortField === field && (sortAsc ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
    </button>
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-[1400px] mx-auto" data-testid="trade-tracker-page">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-lg font-bold text-foreground">Trade Tracker</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending}
            className="h-8 px-3 text-xs font-medium rounded-md bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80 flex items-center gap-1.5"
            data-testid="button-refresh-prices"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
            Refresh P/L
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="h-8 px-3 text-xs font-medium rounded-md bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80 flex items-center gap-1.5"
          >
            <Settings className="h-3.5 w-3.5" />
            Settings
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="h-8 px-4 text-xs font-semibold rounded-md bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-1.5"
            data-testid="button-add-trade"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Trade
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <SummaryCard
            label="Account Value"
            value={formatCurrency(summary.accountValue)}
            icon={<DollarSign className="h-4 w-4" />}
            color="text-foreground"
          />
          <SummaryCard
            label="Total P/L"
            value={formatCurrency(summary.totalProfit)}
            icon={summary.totalProfit >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
            color={summary.totalProfit >= 0 ? "text-green-400" : "text-red-400"}
          />
          <SummaryCard
            label="Open P/L"
            value={formatCurrency(summary.openPL)}
            icon={<BarChart3 className="h-4 w-4" />}
            color={summary.openPL >= 0 ? "text-green-400" : "text-red-400"}
          />
          <SummaryCard
            label="Win Rate"
            value={`${(summary.winRate * 100).toFixed(1)}%`}
            icon={<Target className="h-4 w-4" />}
            color={summary.winRate >= 0.55 ? "text-green-400" : summary.winRate >= 0.45 ? "text-yellow-400" : "text-red-400"}
          />
          <SummaryCard
            label="Open Trades"
            value={String(summary.openTrades)}
            icon={<BarChart3 className="h-4 w-4" />}
            color="text-primary"
          />
          <SummaryCard
            label="Allocated"
            value={`${(summary.allocatedPct * 100).toFixed(1)}%`}
            icon={<DollarSign className="h-4 w-4" />}
            color={summary.allocatedPct > (summary.settings?.totalAllocatedLimit || 0.3) ? "text-red-400" : "text-foreground"}
          />
        </div>
      )}

      {/* Summary by Type (if there are closed trades) */}
      {summary && Object.keys(summary.byType).length > 0 && (
        <div className="bg-card border border-card-border rounded-lg p-4">
          <h3 className="text-sm font-bold text-foreground mb-3">Performance by Type</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground border-b border-card-border">
                  <th className="text-left pb-2 pr-4">Type</th>
                  <th className="text-right pb-2 px-3">Trades</th>
                  <th className="text-right pb-2 px-3">Wins</th>
                  <th className="text-right pb-2 px-3">Win %</th>
                  <th className="text-right pb-2 px-3">Profit</th>
                  <th className="text-right pb-2 px-3">Loss</th>
                  <th className="text-right pb-2 px-3">Net</th>
                  <th className="text-right pb-2 px-3">ROI</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(summary.byType).map(([type, data]) => {
                  const net = data.profit + data.loss;
                  const winPct = data.count > 0 ? (data.wins / data.count * 100) : 0;
                  const roi = data.investment > 0 ? (net / data.investment * 100) : 0;
                  const label = TRADE_TYPES[type as TradeTypeCode]?.label || type;
                  return (
                    <tr key={type} className="border-b border-card-border/50">
                      <td className="py-1.5 pr-4 font-semibold text-foreground">{label}</td>
                      <td className="text-right px-3 text-foreground tabular-nums">{data.count}</td>
                      <td className="text-right px-3 text-foreground tabular-nums">{data.wins}</td>
                      <td className={`text-right px-3 font-semibold tabular-nums ${winPct >= 55 ? "text-green-400" : winPct >= 45 ? "text-yellow-400" : "text-red-400"}`}>
                        {winPct.toFixed(1)}%
                      </td>
                      <td className="text-right px-3 text-green-400 tabular-nums">{formatCurrency(data.profit)}</td>
                      <td className="text-right px-3 text-red-400 tabular-nums">{formatCurrency(data.loss)}</td>
                      <td className={`text-right px-3 font-semibold tabular-nums ${net >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {formatCurrency(net)}
                      </td>
                      <td className={`text-right px-3 font-semibold tabular-nums ${roi >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {roi.toFixed(1)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        {(["all", "open", "closed", "stocks", "options"] as FilterTab[]).map(tab => (
          <button
            key={tab}
            onClick={() => setFilterTab(tab)}
            className={`h-7 px-3 text-xs font-medium rounded-md transition-colors ${
              filterTab === tab
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
            {tab !== "all" && ` (${
              tab === "open" ? trades.filter(t => !t.closeDate).length :
              tab === "closed" ? trades.filter(t => !!t.closeDate).length :
              tab === "stocks" ? trades.filter(t => t.tradeCategory === "Stock").length :
              trades.filter(t => t.tradeCategory === "Option").length
            })`}
          </button>
        ))}
      </div>

      {/* Trades Table */}
      <div className="bg-card border border-card-border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs" data-testid="trades-table">
            <thead>
              <tr className="bg-muted/30 border-b border-card-border">
                <th className="text-left py-2.5 px-3"><SortButton field="tradeDate" label="Date" /></th>
                <th className="text-left py-2.5 px-3"><SortButton field="symbol" label="Symbol" /></th>
                <th className="text-left py-2.5 px-3"><SortButton field="tradeType" label="Type" /></th>
                <th className="text-left py-2.5 px-3 text-muted-foreground font-semibold uppercase tracking-wider text-[11px]">P/A</th>
                <th className="text-right py-2.5 px-3 text-muted-foreground font-semibold uppercase tracking-wider text-[11px]">Qty</th>
                <th className="text-left py-2.5 px-3 text-muted-foreground font-semibold uppercase tracking-wider text-[11px]">Strikes</th>
                <th className="text-right py-2.5 px-3"><SortButton field="openPrice" label="Open" /></th>
                <th className="text-right py-2.5 px-3 text-muted-foreground font-semibold uppercase tracking-wider text-[11px]">Close</th>
                <th className="text-right py-2.5 px-3 text-muted-foreground font-semibold uppercase tracking-wider text-[11px]">Price</th>
                <th className="text-right py-2.5 px-3"><SortButton field="profit" label="P/L" /></th>
                <th className="text-right py-2.5 px-3 text-muted-foreground font-semibold uppercase tracking-wider text-[11px]">Days</th>
                <th className="text-center py-2.5 px-3 text-muted-foreground font-semibold uppercase tracking-wider text-[11px]">Status</th>
                <th className="text-right py-2.5 px-3 text-muted-foreground font-semibold uppercase tracking-wider text-[11px]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={13} className="text-center py-12 text-muted-foreground">
                    No trades yet. Click "Add Trade" to get started.
                  </td>
                </tr>
              ) : (
                filtered.map(t => {
                  const profit = t.closeDate ? computeTradeProfit(t) : computeOpenPL(t);
                  const isOpen = !t.closeDate;
                  const days = daysInTrade(t);
                  const profitPct = t.allocation && t.allocation > 0 ? (profit / t.allocation * 100) : 0;
                  const isWin = profit >= 0;
                  const typeDef = TRADE_TYPES[t.tradeType as TradeTypeCode];
                  const typeLabel = typeDef?.label || t.tradeType;

                  return (
                    <tr key={t.id} className="border-b border-card-border/30 hover:bg-muted/20 transition-colors" data-testid={`trade-row-${t.id}`}>
                      <td className="py-2 px-3 text-foreground tabular-nums">{t.tradeDate}</td>
                      <td className="py-2 px-3 font-mono font-bold text-foreground">{t.symbol}</td>
                      <td className="py-2 px-3">
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                          t.tradeCategory === "Option" ? "bg-purple-500/15 text-purple-400" : "bg-blue-500/15 text-blue-400"
                        }`}>
                          {t.tradeType}
                        </span>
                        <span className="text-muted-foreground ml-1">{typeLabel}</span>
                      </td>
                      <td className="py-2 px-3 text-muted-foreground">{t.pilotOrAdd === "Pilot" ? "P" : "A"}</td>
                      <td className="py-2 px-3 text-right text-foreground tabular-nums">{t.contractsShares}</td>
                      <td className="py-2 px-3 font-mono text-muted-foreground">{t.strikes || "—"}</td>
                      <td className={`py-2 px-3 text-right tabular-nums font-mono ${
                        t.openPrice > 0 ? "text-green-400" : "text-red-400"
                      }`}>
                        {t.openPrice > 0 ? "+" : ""}{t.openPrice.toFixed(2)}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums font-mono text-foreground">
                        {t.closePrice !== null ? t.closePrice.toFixed(2) : "—"}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums font-mono text-muted-foreground">
                        {t.currentPrice ? `$${t.currentPrice.toFixed(2)}` : "—"}
                      </td>
                      <td className={`py-2 px-3 text-right font-semibold tabular-nums ${isWin ? "text-green-400" : "text-red-400"}`}>
                        {profit !== 0 ? formatCurrency(profit) : "—"}
                        {profitPct !== 0 && <span className="text-[10px] ml-1 opacity-70">({profitPct.toFixed(0)}%)</span>}
                      </td>
                      <td className="py-2 px-3 text-right text-muted-foreground tabular-nums">{days}</td>
                      <td className="py-2 px-3 text-center">
                        {isOpen ? (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-yellow-500/15 text-yellow-400">OPEN</span>
                        ) : (
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                            isWin ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"
                          }`}>
                            {isWin ? "WIN" : "LOSS"}
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {isOpen && (
                            <button
                              onClick={() => setClosingTrade(t)}
                              className="p-1 rounded hover:bg-yellow-500/15 text-muted-foreground hover:text-yellow-400 transition-colors"
                              title="Close trade"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                          <button
                            onClick={() => deleteMutation.mutate(t.id)}
                            className="p-1 rounded hover:bg-red-500/15 text-muted-foreground hover:text-red-400 transition-colors"
                            title="Delete trade"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Behavior Tag Summary */}
      {summary && Object.keys(summary.behaviorCounts).length > 0 && (
        <div className="bg-card border border-card-border rounded-lg p-4">
          <h3 className="text-sm font-bold text-foreground mb-3">Behavior Analysis</h3>
          <div className="flex flex-wrap gap-2">
            {Object.entries(summary.behaviorCounts).map(([tag, count]) => (
              <span key={tag} className={`text-xs px-3 py-1.5 rounded-md font-medium ${
                tag === "All to Plan" ? "bg-green-500/15 text-green-400" :
                tag.includes("Panic") || tag.includes("FOMO") ? "bg-red-500/15 text-red-400" :
                "bg-yellow-500/15 text-yellow-400"
              }`}>
                {tag}: {count}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Modals */}
      {showAddModal && settings && <AddTradeModal onClose={() => setShowAddModal(false)} settings={settings} />}
      {closingTrade && settings && <CloseTradeModal trade={closingTrade} onClose={() => setClosingTrade(null)} settings={settings} />}
      {showSettings && settings && <SettingsPanel settings={settings} onClose={() => setShowSettings(false)} />}
    </div>
  );
}

// ─── Reusable Components ──────────────────────────────────────────────────────

function SummaryCard({ label, value, icon, color }: { label: string; value: string; icon: React.ReactNode; color: string }) {
  return (
    <div className="bg-card border border-card-border rounded-lg p-3">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-muted-foreground">{icon}</span>
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>
      <span className={`text-base font-bold tabular-nums ${color}`}>{value}</span>
    </div>
  );
}
