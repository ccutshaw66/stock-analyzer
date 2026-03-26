import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  DollarSign, TrendingUp, Calendar, Percent, Activity,
  AlertTriangle, Loader2, Plus, Trash2, X, Wallet,
  Clock, BarChart3, RefreshCw, PiggyBank, ChevronDown,
} from "lucide-react";
import { HelpBlock, Example, ScoreRange } from "@/components/HelpBlock";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useTicker } from "@/contexts/TickerContext";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DividendPosition {
  id: number;
  ticker: string;
  companyName: string;
  shares: number;
  avgCost: number;
  frequency: string | null;
  notes: string | null;
  addedAt: string;
  // Enriched fields from API
  currentPrice: number | null;
  dividendYield: number;
  dividendRate: number;
  exDividendDate: string | null;
  distributionDate: string | null;
  payoutRatio: number;
  fiveYearAvgYield: number | null;
  lastDividendValue: number | null;
  lastDividendDate: string | null;
  annualDividend: number;
  score: number;
  // Calculated
  marketValue: number | null;
  costBasis: number;
  unrealizedPL: number | null;
  annualIncome: number;
  yieldOnCost: number;
}

// ─── Add Position Modal ───────────────────────────────────────────────────────

function AddPositionModal({ onClose }: { onClose: () => void }) {
  const [ticker, setTicker] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [shares, setShares] = useState("");
  const [avgCost, setAvgCost] = useState("");
  const [notes, setNotes] = useState("");

  const createMut = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/dividend-portfolio", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dividend-portfolio"] });
      onClose();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMut.mutate({
      ticker: ticker.toUpperCase(),
      companyName: companyName || ticker.toUpperCase(),
      shares: parseFloat(shares),
      avgCost: parseFloat(avgCost),
      notes: notes || null,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border border-card-border rounded-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-card-border">
          <h2 className="text-base font-bold text-foreground">Add Dividend Position</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Ticker</label>
              <input type="text" value={ticker} onChange={e => setTicker(e.target.value.toUpperCase())} placeholder="AAPL" required
                className="w-full h-9 px-3 text-sm bg-background border border-card-border rounded-md font-mono text-foreground" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Company Name</label>
              <input type="text" value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="Apple Inc."
                className="w-full h-9 px-3 text-sm bg-background border border-card-border rounded-md text-foreground" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Shares</label>
              <input type="number" step="0.01" value={shares} onChange={e => setShares(e.target.value)} placeholder="100" required min="0.01"
                className="w-full h-9 px-3 text-sm bg-background border border-card-border rounded-md font-mono text-foreground" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Avg Cost / Share</label>
              <input type="number" step="0.01" value={avgCost} onChange={e => setAvgCost(e.target.value)} placeholder="150.00" required min="0.01"
                className="w-full h-9 px-3 text-sm bg-background border border-card-border rounded-md font-mono text-foreground" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Notes (optional)</label>
            <input type="text" value={notes} onChange={e => setNotes(e.target.value)} placeholder="DRIP enabled, long-term hold..."
              className="w-full h-9 px-3 text-sm bg-background border border-card-border rounded-md text-foreground" />
          </div>
          <button type="submit" disabled={createMut.isPending || !ticker || !shares || !avgCost}
            className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 disabled:opacity-50">
            {createMut.isPending ? "Adding..." : "Add Position"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── Position Detail Expansion ────────────────────────────────────────────────

function PositionDetail({ pos }: { pos: DividendPosition }) {
  const yieldColor = (y: number) =>
    y > 3 ? "text-green-400" : y >= 1 ? "text-yellow-400" : "text-red-400";
  const scoreColor = (s: number) =>
    s >= 60 ? "text-green-400" : s >= 35 ? "text-yellow-400" : "text-red-400";
  const payoutColor = (p: number) =>
    p >= 20 && p <= 60 ? "text-green-400" : p > 60 && p <= 80 ? "text-yellow-400" : "text-red-400";

  const daysUntilExDiv = useMemo(() => {
    if (!pos.exDividendDate) return null;
    const exDate = new Date(pos.exDividendDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    exDate.setHours(0, 0, 0, 0);
    return Math.ceil((exDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  }, [pos.exDividendDate]);

  // Estimated payouts per year based on frequency
  const payoutsPerYear = pos.frequency === "Monthly" ? 12 : pos.frequency === "Quarterly" ? 4 : pos.frequency === "Semi-Annual" ? 2 : pos.frequency === "Annual" ? 1 : 4;

  return (
    <div className="px-3 pb-3 space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <MiniStat label="Yield" value={`${pos.dividendYield.toFixed(2)}%`} color={yieldColor(pos.dividendYield)} icon={<Percent className="h-3 w-3" />} />
        <MiniStat label="Yield on Cost" value={`${pos.yieldOnCost.toFixed(2)}%`}
          color={pos.yieldOnCost > pos.dividendYield ? "text-green-400" : "text-foreground"}
          icon={<TrendingUp className="h-3 w-3" />} />
        <MiniStat label="Div Rate / Share" value={`$${pos.dividendRate.toFixed(2)}`} color="text-foreground" icon={<DollarSign className="h-3 w-3" />} />
        <MiniStat label="Payout Ratio" value={`${pos.payoutRatio.toFixed(1)}%`} color={payoutColor(pos.payoutRatio)} icon={<Activity className="h-3 w-3" />} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <MiniStat label="Frequency" value={pos.frequency || "Unknown"} color="text-primary" icon={<Clock className="h-3 w-3" />} />
        <MiniStat label="Payouts / Year" value={String(payoutsPerYear)} color="text-foreground" icon={<Calendar className="h-3 w-3" />} />
        <MiniStat
          label="Ex-Dividend"
          value={pos.exDividendDate || "N/A"}
          color={daysUntilExDiv !== null && daysUntilExDiv >= 0 && daysUntilExDiv <= 7 ? "text-yellow-400" : "text-foreground"}
          icon={<AlertTriangle className="h-3 w-3" />}
          subtitle={daysUntilExDiv !== null ? (daysUntilExDiv > 0 ? `${daysUntilExDiv}d away` : daysUntilExDiv === 0 ? "Today!" : "Passed") : undefined}
        />
        <MiniStat
          label="Distribution"
          value={pos.distributionDate || "N/A"}
          color="text-foreground"
          icon={<Calendar className="h-3 w-3" />}
          subtitle="When you get paid"
        />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <MiniStat label="5Y Avg Yield" value={pos.fiveYearAvgYield != null ? `${pos.fiveYearAvgYield.toFixed(2)}%` : "N/A"}
          color={pos.fiveYearAvgYield != null && pos.dividendYield > pos.fiveYearAvgYield ? "text-green-400" : "text-muted-foreground"}
          icon={<BarChart3 className="h-3 w-3" />}
          subtitle={pos.fiveYearAvgYield != null && pos.dividendYield > pos.fiveYearAvgYield ? "Above avg" : undefined}
        />
        <MiniStat label="Last Dividend" value={pos.lastDividendValue != null ? `$${pos.lastDividendValue.toFixed(4)}` : "N/A"}
          color="text-foreground" icon={<DollarSign className="h-3 w-3" />}
          subtitle={pos.lastDividendDate || undefined}
        />
        <MiniStat label="Quality Score" value={`${pos.score}`} color={scoreColor(pos.score)} icon={<Activity className="h-3 w-3" />} />
        <MiniStat label="Annual Income" value={`$${pos.annualIncome.toFixed(2)}`} color="text-green-400" icon={<PiggyBank className="h-3 w-3" />} />
      </div>
      {pos.notes && (
        <p className="text-[10px] text-muted-foreground italic px-1">Notes: {pos.notes}</p>
      )}
    </div>
  );
}

function MiniStat({ label, value, color, icon, subtitle }: {
  label: string; value: string; color: string; icon?: React.ReactNode; subtitle?: string;
}) {
  return (
    <div className="bg-muted/30 border border-card-border/50 rounded-lg p-2">
      <div className="flex items-center gap-1 mb-0.5">
        {icon && <span className={`${color} opacity-70`}>{icon}</span>}
        <span className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>
      <span className={`text-xs font-bold tabular-nums font-mono ${color}`}>{value}</span>
      {subtitle && <span className="block text-[9px] text-muted-foreground">{subtitle}</span>}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function DividendPortfolio() {
  const { setActiveTicker } = useTicker();
  const [showAddModal, setShowAddModal] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [sortBy, setSortBy] = useState<string>("annualIncome");

  const { data: positions = [], isLoading, isRefetching } = useQuery<DividendPosition[]>({
    queryKey: ["/api/dividend-portfolio", "enriched"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/dividend-portfolio/enriched");
      return res.json();
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/dividend-portfolio/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dividend-portfolio"] });
    },
  });

  // Sort positions
  const sorted = useMemo(() => {
    const copy = [...positions];
    switch (sortBy) {
      case "annualIncome": return copy.sort((a, b) => b.annualIncome - a.annualIncome);
      case "yield": return copy.sort((a, b) => b.dividendYield - a.dividendYield);
      case "yieldOnCost": return copy.sort((a, b) => b.yieldOnCost - a.yieldOnCost);
      case "score": return copy.sort((a, b) => b.score - a.score);
      case "marketValue": return copy.sort((a, b) => (b.marketValue ?? 0) - (a.marketValue ?? 0));
      case "ticker": return copy.sort((a, b) => a.ticker.localeCompare(b.ticker));
      default: return copy;
    }
  }, [positions, sortBy]);

  // Portfolio summary
  const summary = useMemo(() => {
    const totalCost = positions.reduce((s, p) => s + p.costBasis, 0);
    const totalMarket = positions.reduce((s, p) => s + (p.marketValue ?? p.costBasis), 0);
    const totalAnnualIncome = positions.reduce((s, p) => s + p.annualIncome, 0);
    const totalUnrealizedPL = positions.reduce((s, p) => s + (p.unrealizedPL ?? 0), 0);
    const avgYield = totalMarket > 0 ? (totalAnnualIncome / totalMarket) * 100 : 0;
    const avgYieldOnCost = totalCost > 0 ? (totalAnnualIncome / totalCost) * 100 : 0;
    const monthlyIncome = totalAnnualIncome / 12;
    return { totalCost, totalMarket, totalAnnualIncome, totalUnrealizedPL, avgYield, avgYieldOnCost, monthlyIncome, count: positions.length };
  }, [positions]);

  const plColor = (v: number) => v >= 0 ? "text-green-400" : "text-red-400";

  return (
    <div className="p-3 sm:p-4 md:p-6 space-y-6 max-w-[1200px] mx-auto" data-testid="dividend-portfolio-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-foreground">Dividend Portfolio</h1>
          <p className="text-xs text-muted-foreground">
            Track your dividend positions, income, distribution dates, and yield on cost.
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-1.5 h-8 px-3 text-xs font-semibold rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          data-testid="button-add-dividend"
        >
          <Plus className="h-3.5 w-3.5" /> Add Position
        </button>
      </div>

      {/* Help Block */}
      <HelpBlock title="Understanding Dividend Portfolio">
        <p><strong className="text-foreground">Yield on Cost (YoC):</strong> Your personal dividend yield based on what you actually paid. If a stock's yield is 3% but you bought it years ago at a lower price, your YoC could be much higher — this is the power of dividend growth investing.</p>
        <p><strong className="text-foreground">Annual Income:</strong> Total dividends expected per year based on shares owned and current dividend rate. Multiply by your tax rate to see after-tax income.</p>
        <p><strong className="text-foreground">Distribution Dates:</strong> When the dividend payment actually hits your account. Plan around these dates for income timing.</p>
        <p><strong className="text-foreground">Ex-Dividend Date:</strong> Must own shares BEFORE this date to receive the next payment.</p>
        <Example type="good">
          <strong className="text-green-400">DRIP Strategy:</strong> Reinvesting dividends automatically buys more shares at current prices, compounding your income over time.
        </Example>
        <ScoreRange label="Strong" range="60-100" color="green" description="High yield, sustainable payout, consistent growth" />
        <ScoreRange label="Moderate" range="35-59" color="yellow" description="Decent yield but may lack growth or consistency" />
        <ScoreRange label="Weak" range="0-34" color="red" description="Low yield, high payout risk, or inconsistent payments" />
      </HelpBlock>

      {/* Portfolio Summary Cards */}
      {positions.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="portfolio-summary">
          <div className="bg-card border border-card-border rounded-lg p-3">
            <div className="flex items-center gap-1 mb-1">
              <Wallet className="h-3 w-3 text-primary opacity-70" />
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Market Value</span>
            </div>
            <span className="text-sm font-bold tabular-nums font-mono text-foreground">${summary.totalMarket.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            <span className={`block text-[10px] font-mono tabular-nums ${plColor(summary.totalUnrealizedPL)}`}>
              {summary.totalUnrealizedPL >= 0 ? "+" : ""}{summary.totalUnrealizedPL.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} P/L
            </span>
          </div>
          <div className="bg-card border border-card-border rounded-lg p-3">
            <div className="flex items-center gap-1 mb-1">
              <PiggyBank className="h-3 w-3 text-green-400 opacity-70" />
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Annual Income</span>
            </div>
            <span className="text-sm font-bold tabular-nums font-mono text-green-400">${summary.totalAnnualIncome.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            <span className="block text-[10px] text-muted-foreground font-mono tabular-nums">
              ${summary.monthlyIncome.toFixed(2)} / mo
            </span>
          </div>
          <div className="bg-card border border-card-border rounded-lg p-3">
            <div className="flex items-center gap-1 mb-1">
              <Percent className="h-3 w-3 text-primary opacity-70" />
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Avg Yield</span>
            </div>
            <span className="text-sm font-bold tabular-nums font-mono text-foreground">{summary.avgYield.toFixed(2)}%</span>
            <span className="block text-[10px] text-muted-foreground font-mono tabular-nums">
              YoC: {summary.avgYieldOnCost.toFixed(2)}%
            </span>
          </div>
          <div className="bg-card border border-card-border rounded-lg p-3">
            <div className="flex items-center gap-1 mb-1">
              <BarChart3 className="h-3 w-3 text-primary opacity-70" />
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Positions</span>
            </div>
            <span className="text-sm font-bold tabular-nums font-mono text-foreground">{summary.count}</span>
            <span className="block text-[10px] text-muted-foreground font-mono tabular-nums">
              Cost: ${summary.totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
        </div>
      )}

      {/* Sort + Refresh */}
      {positions.length > 0 && (
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Sort by</label>
            <select value={sortBy} onChange={e => setSortBy(e.target.value)}
              className="h-7 px-2 text-xs bg-background border border-card-border rounded-md text-foreground"
              data-testid="sort-dividend-portfolio"
            >
              <option value="annualIncome">Annual Income</option>
              <option value="yield">Current Yield</option>
              <option value="yieldOnCost">Yield on Cost</option>
              <option value="score">Quality Score</option>
              <option value="marketValue">Market Value</option>
              <option value="ticker">Ticker</option>
            </select>
          </div>
          <button
            onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/dividend-portfolio"] })}
            disabled={isRefetching}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            data-testid="button-refresh-dividends"
          >
            <RefreshCw className={`h-3 w-3 ${isRefetching ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Loading dividend portfolio...</span>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && positions.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-center bg-card border border-card-border rounded-lg">
          <PiggyBank className="h-10 w-10 text-muted-foreground/30 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">No dividend positions yet</p>
          <p className="text-[11px] text-muted-foreground mt-1 max-w-xs">
            Add your dividend-paying stocks and ETFs to track income, distribution dates, and yield on cost.
          </p>
          <button
            onClick={() => setShowAddModal(true)}
            className="mt-4 flex items-center gap-1.5 h-8 px-4 text-xs font-semibold rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" /> Add Your First Position
          </button>
        </div>
      )}

      {/* Positions Table */}
      {!isLoading && sorted.length > 0 && (
        <div className="bg-card border border-card-border rounded-lg overflow-hidden" data-testid="dividend-positions-table">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-card-border text-muted-foreground bg-muted/20">
                <th className="text-left py-2.5 px-3 font-semibold">Ticker</th>
                <th className="text-right py-2.5 px-2 font-semibold hidden sm:table-cell">Shares</th>
                <th className="text-right py-2.5 px-2 font-semibold hidden md:table-cell">Avg Cost</th>
                <th className="text-right py-2.5 px-2 font-semibold">Price</th>
                <th className="text-right py-2.5 px-2 font-semibold hidden lg:table-cell">Mkt Value</th>
                <th className="text-right py-2.5 px-2 font-semibold hidden md:table-cell">P/L</th>
                <th className="text-right py-2.5 px-2 font-semibold">Yield</th>
                <th className="text-right py-2.5 px-2 font-semibold hidden lg:table-cell">YoC</th>
                <th className="text-right py-2.5 px-2 font-semibold">Annual $</th>
                <th className="text-center py-2.5 px-2 font-semibold hidden md:table-cell">Freq</th>
                <th className="text-center py-2.5 px-2 font-semibold hidden lg:table-cell">Ex-Div</th>
                <th className="text-center py-2.5 px-2 font-semibold hidden lg:table-cell">Dist Date</th>
                <th className="text-right py-2.5 px-2 font-semibold hidden md:table-cell">Score</th>
                <th className="text-center py-2.5 px-2 font-semibold w-8"></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(pos => {
                const isExpanded = expandedId === pos.id;
                const plVal = pos.unrealizedPL ?? 0;
                return (
                  <PositionRow
                    key={pos.id}
                    pos={pos}
                    isExpanded={isExpanded}
                    plVal={plVal}
                    onToggle={() => setExpandedId(isExpanded ? null : pos.id)}
                    onDelete={() => deleteMut.mutate(pos.id)}
                    onSelectTicker={() => setActiveTicker(pos.ticker)}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showAddModal && <AddPositionModal onClose={() => setShowAddModal(false)} />}
    </div>
  );
}

// ─── Position Row ─────────────────────────────────────────────────────────────

function PositionRow({ pos, isExpanded, plVal, onToggle, onDelete, onSelectTicker }: {
  pos: DividendPosition; isExpanded: boolean; plVal: number;
  onToggle: () => void; onDelete: () => void; onSelectTicker: () => void;
}) {
  const yieldColor = (y: number) =>
    y > 3 ? "text-green-400" : y >= 1 ? "text-yellow-400" : "text-red-400";
  const scoreColor = (s: number) =>
    s >= 60 ? "text-green-400" : s >= 35 ? "text-yellow-400" : "text-red-400";
  const plColor = plVal >= 0 ? "text-green-400" : "text-red-400";

  return (
    <>
      <tr
        className={`border-b border-card-border/30 hover:bg-muted/30 cursor-pointer transition-colors ${isExpanded ? "bg-muted/20" : ""}`}
        onClick={onToggle}
        data-testid={`dividend-row-${pos.ticker}`}
      >
        <td className="py-2.5 px-3">
          <div className="flex items-center gap-2">
            <ChevronDown className={`h-3 w-3 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`} />
            <div>
              <span className="font-mono font-bold text-foreground cursor-pointer hover:text-primary"
                onClick={e => { e.stopPropagation(); onSelectTicker(); }}>{pos.ticker}</span>
              <p className="text-[10px] text-muted-foreground truncate max-w-[120px]">{pos.companyName}</p>
            </div>
          </div>
        </td>
        <td className="py-2.5 px-2 text-right font-mono text-foreground hidden sm:table-cell">{pos.shares}</td>
        <td className="py-2.5 px-2 text-right font-mono text-foreground hidden md:table-cell">${pos.avgCost.toFixed(2)}</td>
        <td className="py-2.5 px-2 text-right font-mono text-foreground">
          {pos.currentPrice != null ? `$${pos.currentPrice.toFixed(2)}` : "—"}
        </td>
        <td className="py-2.5 px-2 text-right font-mono text-foreground hidden lg:table-cell">
          {pos.marketValue != null ? `$${pos.marketValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}
        </td>
        <td className={`py-2.5 px-2 text-right font-mono font-bold hidden md:table-cell ${plColor}`}>
          {pos.unrealizedPL != null ? `${plVal >= 0 ? "+" : ""}${plVal.toFixed(2)}` : "—"}
        </td>
        <td className={`py-2.5 px-2 text-right font-mono font-bold ${yieldColor(pos.dividendYield)}`}>
          {pos.dividendYield.toFixed(2)}%
        </td>
        <td className={`py-2.5 px-2 text-right font-mono hidden lg:table-cell ${pos.yieldOnCost > pos.dividendYield ? "text-green-400 font-bold" : "text-foreground"}`}>
          {pos.yieldOnCost.toFixed(2)}%
        </td>
        <td className="py-2.5 px-2 text-right font-mono font-bold text-green-400">
          ${pos.annualIncome.toFixed(2)}
        </td>
        <td className="py-2.5 px-2 text-center hidden md:table-cell">
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-primary/10 text-primary">
            {pos.frequency || "?"}
          </span>
        </td>
        <td className="py-2.5 px-2 text-center font-mono text-muted-foreground hidden lg:table-cell text-[10px]">
          {pos.exDividendDate || "—"}
        </td>
        <td className="py-2.5 px-2 text-center font-mono text-muted-foreground hidden lg:table-cell text-[10px]">
          {pos.distributionDate || "—"}
        </td>
        <td className={`py-2.5 px-2 text-right font-mono font-bold hidden md:table-cell ${scoreColor(pos.score)}`}>
          {pos.score}
        </td>
        <td className="py-2.5 px-2 text-center">
          <button
            onClick={e => { e.stopPropagation(); onDelete(); }}
            className="text-muted-foreground hover:text-red-400 transition-colors p-1"
            data-testid={`button-delete-dividend-${pos.ticker}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </td>
      </tr>
      {isExpanded && (
        <tr>
          <td colSpan={14} className="bg-muted/10 border-b border-card-border/30">
            <PositionDetail pos={pos} />
          </td>
        </tr>
      )}
    </>
  );
}
