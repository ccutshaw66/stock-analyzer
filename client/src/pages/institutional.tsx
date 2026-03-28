import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useTicker } from "@/contexts/TickerContext";
import { formatCurrency, formatCompact } from "@/lib/format";
import {
  Building2, TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight,
  Users, Search, Loader2, ChevronDown, ChevronUp, X, Eye, DollarSign,
  BarChart3, Activity, UserCheck, Briefcase, AlertTriangle, Zap, RefreshCw
} from "lucide-react";
import { HelpBlock, Example, ScoreRange } from "@/components/HelpBlock";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Institution {
  name: string;
  shares: number;
  value: number;
  pctHeld: number;
  changeQoQ: number;
  reportDate: string | null;
}

interface InsiderTxn {
  insider: string;
  relation: string;
  type: string;
  shares: number;
  value: number;
  date: string | null;
}

interface InsiderHolder {
  name: string;
  relation: string;
  shares: number;
  sharesIndirect: number;
  latestTransaction: string | null;
  latestDate: string | null;
}

interface InstitutionalData {
  ticker: string;
  companyName: string;
  currentPrice: number;
  marketCap: number;
  volume: number;
  avgVolume: number;
  insiderPct: number;
  institutionPct: number;
  institutionCount: number;
  floatPct: number;
  flowScore: number;
  signal: string;
  instInflow: number;
  instOutflow: number;
  instIncreased: number;
  instDecreased: number;
  instNew: number;
  instSoldOut: number;
  insiderBuyCount: number;
  insiderSellCount: number;
  insiderBuyShares: number;
  insiderSellShares: number;
  netInsiderShares: number;
  insiderBuyPct: number;
  insiderSellPct: number;
  topInstitutions: Institution[];
  topFunds: Institution[];
  insiders: InsiderHolder[];
  recentInsiderTxns: InsiderTxn[];
}

interface ScanResult {
  scannedAt: string;
  totalScanned: number;
  results: InstitutionalData[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function flowColor(score: number): string {
  if (score >= 40) return "text-green-400";
  if (score >= 15) return "text-green-400/70";
  if (score <= -40) return "text-red-400";
  if (score <= -15) return "text-red-400/70";
  return "text-yellow-400";
}

function signalBadge(signal: string) {
  const colors: Record<string, string> = {
    "STRONG INFLOW": "bg-green-500 text-white",
    "ACCUMULATING": "bg-green-500/20 text-green-400",
    "DISTRIBUTING": "bg-red-500/20 text-red-400",
    "STRONG OUTFLOW": "bg-red-500 text-white",
    "NEUTRAL": "bg-yellow-500/20 text-yellow-400",
  };
  return (
    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md uppercase ${colors[signal] || colors.NEUTRAL}`}>
      {signal}
    </span>
  );
}

function FlowBar({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(100, (score + 100) / 2));
  return (
    <div className="flex items-center gap-2">
      <span className={`text-sm font-bold tabular-nums w-10 text-right ${flowColor(score)}`}>{score}</span>
      <div className="flex-1 h-2.5 bg-muted rounded-full overflow-hidden relative max-w-[120px]">
        <div className="absolute inset-0 flex">
          <div className="w-1/2 bg-red-500/20" />
          <div className="w-1/2 bg-green-500/20" />
        </div>
        <div
          className={`absolute top-0 h-full w-1.5 rounded-full ${score >= 0 ? "bg-green-500" : "bg-red-500"}`}
          style={{ left: `${pct}%`, transform: "translateX(-50%)" }}
        />
      </div>
    </div>
  );
}

// ─── Detail Modal ─────────────────────────────────────────────────────────────

function DetailModal({ data, onClose }: { data: InstitutionalData; onClose: () => void }) {
  const [tab, setTab] = useState<"institutions" | "funds" | "insiders" | "transactions">("institutions");

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border border-card-border rounded-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-card-border shrink-0">
          <div>
            <div className="flex items-center gap-3">
              <span className="font-mono font-bold text-lg text-foreground">{data.ticker}</span>
              {signalBadge(data.signal)}
              <FlowBar score={data.flowScore} />
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{data.companyName} · {formatCurrency(data.currentPrice)} · MCap {formatCompact(data.marketCap)}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4 border-b border-card-border shrink-0">
          <MiniCard label="Institutional Ownership" value={`${data.institutionPct.toFixed(1)}%`} sub={`${data.institutionCount.toLocaleString()} holders`} />
          <MiniCard label="Insider Ownership" value={`${data.insiderPct.toFixed(1)}%`} sub={`Float: ${data.floatPct.toFixed(1)}%`} />
          <MiniCard label="Inst. Increasing" value={`${data.instIncreased + data.instNew}`} sub={`${data.instNew} new positions`} color="text-green-400" />
          <MiniCard label="Inst. Decreasing" value={`${data.instDecreased + data.instSoldOut}`} sub={`${data.instSoldOut} sold out`} color="text-red-400" />
        </div>

        {/* Insider Activity Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-4 py-3 border-b border-card-border shrink-0 bg-muted/20">
          <MiniCard label="Insider Buys (6mo)" value={String(data.insiderBuyCount)} sub={`${formatCompact(data.insiderBuyShares)} shares`} color="text-green-400" />
          <MiniCard label="Insider Sells (6mo)" value={String(data.insiderSellCount)} sub={`${formatCompact(data.insiderSellShares)} shares`} color="text-red-400" />
          <MiniCard label="Net Insider Shares" value={formatCompact(data.netInsiderShares)} color={data.netInsiderShares >= 0 ? "text-green-400" : "text-red-400"} />
          <MiniCard label="Est. Inst Inflow" value={`$${formatCompact(data.instInflow)}`} sub={`Outflow: $${formatCompact(data.instOutflow)}`} color="text-primary" />
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-4 pt-3 shrink-0">
          {([
            ["institutions", "Top Institutions", Building2],
            ["funds", "Fund Holders", Briefcase],
            ["insiders", "Insiders", UserCheck],
            ["transactions", "Recent Txns", Activity],
          ] as const).map(([key, label, Icon]) => (
            <button key={key} onClick={() => setTab(key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-t-md transition-colors ${
                tab === key ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}>
              <Icon className="h-3 w-3" />{label}
            </button>
          ))}
        </div>

        {/* Table Content */}
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {tab === "institutions" && (
            <table className="w-full text-xs">
              <thead><tr className="text-muted-foreground border-b border-card-border">
                <th className="text-left py-2 font-semibold">#</th>
                <th className="text-left py-2 font-semibold">Institution</th>
                <th className="text-right py-2 font-semibold">Shares</th>
                <th className="text-right py-2 font-semibold">Value</th>
                <th className="text-right py-2 font-semibold">% Held</th>
                <th className="text-right py-2 font-semibold">QoQ Change</th>
              </tr></thead>
              <tbody>
                {data.topInstitutions.map((inst, i) => (
                  <tr key={i} className="border-b border-card-border/30 hover:bg-muted/20">
                    <td className="py-1.5 text-muted-foreground">{i + 1}</td>
                    <td className="py-1.5 font-semibold text-foreground max-w-[250px] truncate">{inst.name}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatCompact(inst.shares)}</td>
                    <td className="py-1.5 text-right tabular-nums">${formatCompact(inst.value)}</td>
                    <td className="py-1.5 text-right tabular-nums">{(inst.pctHeld * 100).toFixed(2)}%</td>
                    <td className={`py-1.5 text-right font-semibold tabular-nums ${inst.changeQoQ > 0 ? "text-green-400" : inst.changeQoQ < 0 ? "text-red-400" : "text-muted-foreground"}`}>
                      {inst.changeQoQ > 0 ? "+" : ""}{inst.changeQoQ.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {tab === "funds" && (
            <table className="w-full text-xs">
              <thead><tr className="text-muted-foreground border-b border-card-border">
                <th className="text-left py-2 font-semibold">#</th>
                <th className="text-left py-2 font-semibold">Fund</th>
                <th className="text-right py-2 font-semibold">Shares</th>
                <th className="text-right py-2 font-semibold">Value</th>
                <th className="text-right py-2 font-semibold">% Held</th>
                <th className="text-right py-2 font-semibold">QoQ Change</th>
              </tr></thead>
              <tbody>
                {data.topFunds.map((fund, i) => (
                  <tr key={i} className="border-b border-card-border/30 hover:bg-muted/20">
                    <td className="py-1.5 text-muted-foreground">{i + 1}</td>
                    <td className="py-1.5 font-semibold text-foreground max-w-[250px] truncate">{fund.name}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatCompact(fund.shares)}</td>
                    <td className="py-1.5 text-right tabular-nums">${formatCompact(fund.value)}</td>
                    <td className="py-1.5 text-right tabular-nums">{(fund.pctHeld * 100).toFixed(2)}%</td>
                    <td className={`py-1.5 text-right font-semibold tabular-nums ${fund.changeQoQ > 0 ? "text-green-400" : fund.changeQoQ < 0 ? "text-red-400" : "text-muted-foreground"}`}>
                      {fund.changeQoQ > 0 ? "+" : ""}{fund.changeQoQ.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {tab === "insiders" && (
            <table className="w-full text-xs">
              <thead><tr className="text-muted-foreground border-b border-card-border">
                <th className="text-left py-2 font-semibold">Name</th>
                <th className="text-left py-2 font-semibold">Role</th>
                <th className="text-right py-2 font-semibold">Direct Shares</th>
                <th className="text-right py-2 font-semibold">Indirect</th>
                <th className="text-left py-2 font-semibold">Last Action</th>
                <th className="text-right py-2 font-semibold">Date</th>
              </tr></thead>
              <tbody>
                {data.insiders.map((ins, i) => (
                  <tr key={i} className="border-b border-card-border/30 hover:bg-muted/20">
                    <td className="py-1.5 font-semibold text-foreground">{ins.name}</td>
                    <td className="py-1.5 text-muted-foreground">{ins.relation}</td>
                    <td className="py-1.5 text-right tabular-nums">{ins.shares > 0 ? formatCompact(ins.shares) : "—"}</td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">{ins.sharesIndirect > 0 ? formatCompact(ins.sharesIndirect) : "—"}</td>
                    <td className={`py-1.5 ${ins.latestTransaction === "Sale" ? "text-red-400" : ins.latestTransaction === "Purchase" ? "text-green-400" : "text-muted-foreground"}`}>
                      {ins.latestTransaction || "—"}
                    </td>
                    <td className="py-1.5 text-right text-muted-foreground tabular-nums">{ins.latestDate || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {tab === "transactions" && (
            <table className="w-full text-xs">
              <thead><tr className="text-muted-foreground border-b border-card-border">
                <th className="text-left py-2 font-semibold">Date</th>
                <th className="text-left py-2 font-semibold">Insider</th>
                <th className="text-left py-2 font-semibold">Type</th>
                <th className="text-right py-2 font-semibold">Shares</th>
                <th className="text-right py-2 font-semibold">Value</th>
              </tr></thead>
              <tbody>
                {data.recentInsiderTxns.map((tx, i) => {
                  const isSale = tx.type.toLowerCase().includes("sale") || tx.type.toLowerCase().includes("sell");
                  const isBuy = tx.type.toLowerCase().includes("purchase") || tx.type.toLowerCase().includes("buy");
                  return (
                    <tr key={i} className="border-b border-card-border/30 hover:bg-muted/20">
                      <td className="py-1.5 tabular-nums text-muted-foreground">{tx.date || "—"}</td>
                      <td className="py-1.5 font-semibold text-foreground">{tx.insider}</td>
                      <td className={`py-1.5 font-semibold ${isSale ? "text-red-400" : isBuy ? "text-green-400" : "text-yellow-400"}`}>
                        {tx.type}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{formatCompact(Math.abs(tx.shares))}</td>
                      <td className="py-1.5 text-right tabular-nums">{tx.value > 0 ? `$${formatCompact(tx.value)}` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function MiniCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="bg-muted/30 border border-card-border/50 rounded-lg p-2.5">
      <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider block mb-0.5">{label}</span>
      <span className={`text-sm font-bold tabular-nums ${color || "text-foreground"}`}>{value}</span>
      {sub && <span className="block text-[10px] text-muted-foreground">{sub}</span>}
    </div>
  );
}

// ─── Scanner Result Card ──────────────────────────────────────────────────────

function ResultCard({ data, rank, onClick }: { data: InstitutionalData; rank: number; onClick: () => void }) {
  const volRatio = data.avgVolume > 0 ? data.volume / data.avgVolume : 0;
  const volSurge = volRatio > 1.5;

  return (
    <div onClick={onClick} className="bg-card border border-card-border rounded-lg p-4 hover:bg-muted/20 cursor-pointer transition-colors" data-testid={`inst-card-${data.ticker}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-lg font-bold text-muted-foreground/50 tabular-nums w-7 shrink-0">{rank}</span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono font-bold text-base text-foreground">{data.ticker}</span>
              {signalBadge(data.signal)}
              {volSurge && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400 flex items-center gap-0.5">
                  <Zap className="h-2.5 w-2.5" />{volRatio.toFixed(1)}x Vol
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground truncate">{data.companyName} · {formatCurrency(data.currentPrice)} · MCap {formatCompact(data.marketCap)}</p>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <FlowBar score={data.flowScore} />
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 pt-3 border-t border-card-border/50">
        <div className="flex items-center gap-1.5">
          <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Inst:</span>
          <span className="text-xs font-semibold text-foreground">{data.institutionPct.toFixed(1)}%</span>
        </div>
        <div className="flex items-center gap-1.5">
          <UserCheck className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Insider:</span>
          <span className="text-xs font-semibold text-foreground">{data.insiderPct.toFixed(1)}%</span>
        </div>
        <div className="flex items-center gap-1.5">
          <ArrowUpRight className="h-3.5 w-3.5 text-green-400" />
          <span className="text-xs font-semibold text-green-400">{data.instIncreased + data.instNew} in</span>
          <ArrowDownRight className="h-3.5 w-3.5 text-red-400 ml-1" />
          <span className="text-xs font-semibold text-red-400">{data.instDecreased + data.instSoldOut} out</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Activity className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Insider Net:</span>
          <span className={`text-xs font-semibold ${data.netInsiderShares >= 0 ? "text-green-400" : "text-red-400"}`}>
            {data.netInsiderShares >= 0 ? "+" : ""}{formatCompact(data.netInsiderShares)}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Institutional() {
  const { activeTicker, setActiveTicker } = useTicker();
  const [customTickers, setCustomTickers] = useState("");
  const [selectedData, setSelectedData] = useState<InstitutionalData | null>(null);
  const [scanMode, setScanMode] = useState<"default" | "custom">("default");

  // Single ticker lookup (follows active ticker)
  const { data: singleData, isFetching: singleFetching } = useQuery<InstitutionalData>({
    queryKey: ["/api/institutional", activeTicker],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/institutional/${activeTicker}`);
      return res.json();
    },
    enabled: !!activeTicker,
    staleTime: 5 * 60 * 1000,
  });

  // Batch scan — persisted via queryClient cache
  const [scanData, setScanData] = useState<ScanResult | null>(() => queryClient.getQueryData(["/api/institutional-scan"]) || null);
  const [scanFetching, setScanFetching] = useState(false);

  const scanRefetch = async () => {
    setScanFetching(true);
    try {
      const params = scanMode === "custom" && customTickers.trim()
        ? `?tickers=${encodeURIComponent(customTickers.trim())}`
        : "";
      const res = await apiRequest("GET", `/api/institutional-scan${params}`);
      const result = await res.json();
      setScanData(result);
      queryClient.setQueryData(["/api/institutional-scan"], result);
    } catch (err: any) {
      console.error("Institutional scan failed:", err);
    } finally {
      setScanFetching(false);
    }
  };

  return (
    <div className="p-3 sm:p-4 md:p-6 space-y-5 max-w-[1200px] mx-auto" data-testid="institutional-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            Institutional Money Flow
          </h1>
          <p className="text-xs text-muted-foreground">Track institutional buying/selling, insider moves, and smart money flow signals.</p>
        </div>
      </div>

      {/* ─── FAQ / How It Works ──────────────────────────────────────── */}
      <HelpBlock title="How Institutional Money Flow Scoring Works">
        <p><strong className="text-foreground">Flow Score</strong> measures the net direction of institutional money movement on a scale from <strong className="text-red-400">-100</strong> (all selling) to <strong className="text-green-400">+100</strong> (all buying).</p>

        <p className="font-semibold text-foreground mt-2">How it's calculated:</p>
        <p>1. We look at each institution's <strong className="text-foreground">quarter-over-quarter position change</strong> — how much they increased or decreased their holdings.</p>
        <p>2. <strong className="text-foreground">Inflow</strong> = dollar value of increased positions. <strong className="text-foreground">Outflow</strong> = dollar value of decreased positions.</p>
        <p>3. <strong className="text-foreground">Base Flow Score</strong> = ((Inflow − Outflow) / Total Flow) × 100</p>
        <p>4. We then add an <strong className="text-foreground">Insider Activity Bonus</strong>: each net insider buy adds +10, each net insider sell subtracts -10. This rewards insider confidence.</p>
        <p>5. The combined score is clamped to -100 to +100.</p>

        <p className="font-semibold text-foreground mt-2">Signal Thresholds:</p>
        <ScoreRange label="STRONG INFLOW" range="+40 to +100" color="green" description="Heavy institutional buying + insider support. Smart money is aggressively accumulating." />
        <ScoreRange label="ACCUMULATING" range="+15 to +39" color="green" description="Moderate net buying. Institutions are building positions but not rushing." />
        <ScoreRange label="NEUTRAL" range="-14 to +14" color="yellow" description="Balanced activity. No clear directional bias from institutions." />
        <ScoreRange label="DISTRIBUTING" range="-15 to -39" color="red" description="Moderate net selling. Institutions are reducing positions." />
        <ScoreRange label="STRONG OUTFLOW" range="-40 to -100" color="red" description="Heavy institutional selling + insider dumping. Smart money is exiting." />

        <p className="font-semibold text-foreground mt-2">Real Examples:</p>
        <Example type="good">
          <p><strong className="text-green-400">BAC (Flow Score +62, STRONG INFLOW):</strong> Most top institutions increased positions by 5-15% QoQ. 3 new institutions initiated positions. Insiders bought 50,000 shares. Net inflow far exceeds outflow → strong accumulation signal.</p>
        </Example>
        <Example type="neutral">
          <p><strong className="text-yellow-400">INTC (Flow Score +5, NEUTRAL):</strong> Some institutions increased, others decreased. Roughly equal inflow and outflow. 1 insider buy, 1 insider sell. No clear direction from the smart money.</p>
        </Example>
        <Example type="bad">
          <p><strong className="text-red-400">SNAP (Flow Score -55, STRONG OUTFLOW):</strong> Major funds cut positions by 20-40%. Several institutions sold out entirely. Multiple insider sales. Smart money is heading for the exit.</p>
        </Example>

        <p className="font-semibold text-foreground mt-2">Key Metrics Explained:</p>
        <p><strong className="text-foreground">Institutional %</strong> — Percentage of outstanding shares held by institutions (hedge funds, mutual funds, pension funds). Higher = more institutional interest. Most large-caps are 60-90%.</p>
        <p><strong className="text-foreground">Insider %</strong> — Percentage held by company insiders (executives, board members). High insider ownership (5%+) means management has skin in the game.</p>
        <p><strong className="text-foreground">Inst. Increasing / Decreasing</strong> — Count of institutions that grew vs. shrank their positions this quarter. More increasing = bullish signal.</p>
        <p><strong className="text-foreground">New / Sold Out</strong> — Institutions that initiated brand new positions (&gt;50% change) or completely exited (&gt;90% reduction). New positions = fresh conviction. Sold out = lost faith.</p>
        <p><strong className="text-foreground">Insider Buys / Sells</strong> — Net insider transaction count over the past 6 months. Insider buying is one of the strongest bullish signals because they know the company best.</p>
      </HelpBlock>

      {/* Active Ticker Detail (if one is selected) */}
      {activeTicker && singleData && !singleFetching && (
        <div className="bg-card border border-card-border rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <span className="font-mono font-bold text-lg text-foreground">{singleData.ticker}</span>
              {signalBadge(singleData.signal)}
              <FlowBar score={singleData.flowScore} />
            </div>
            <button onClick={() => setSelectedData(singleData)}
              className="text-xs text-primary hover:underline flex items-center gap-1">
              <Eye className="h-3 w-3" />Full Detail
            </button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <MiniCard label="Institutional" value={`${singleData.institutionPct.toFixed(1)}%`} sub={`${singleData.institutionCount.toLocaleString()} holders`} />
            <MiniCard label="Insider" value={`${singleData.insiderPct.toFixed(1)}%`} />
            <MiniCard label="Increasing" value={`${singleData.instIncreased + singleData.instNew}`} sub={`${singleData.instNew} new`} color="text-green-400" />
            <MiniCard label="Decreasing" value={`${singleData.instDecreased + singleData.instSoldOut}`} sub={`${singleData.instSoldOut} exited`} color="text-red-400" />
            <MiniCard label="Insider Buys" value={String(singleData.insiderBuyCount)} sub={`${formatCompact(singleData.insiderBuyShares)} sh`} color="text-green-400" />
            <MiniCard label="Insider Sells" value={String(singleData.insiderSellCount)} sub={`${formatCompact(singleData.insiderSellShares)} sh`} color="text-red-400" />
          </div>
        </div>
      )}
      {activeTicker && singleFetching && (
        <div className="bg-card border border-card-border rounded-lg p-6 flex items-center justify-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span className="text-sm text-muted-foreground">Loading institutional data for {activeTicker}...</span>
        </div>
      )}

      {/* Scanner Controls */}
      <div className="bg-card border border-card-border rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <Search className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold text-foreground">Money Flow Scanner</h3>
        </div>

        <div className="flex gap-2 mb-3">
          <button onClick={() => setScanMode("default")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${scanMode === "default" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
            Top 30 Stocks
          </button>
          <button onClick={() => setScanMode("custom")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${scanMode === "custom" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
            Custom Tickers
          </button>
        </div>

        {scanMode === "custom" && (
          <div className="mb-3">
            <input
              type="text"
              value={customTickers}
              onChange={e => setCustomTickers(e.target.value.toUpperCase())}
              placeholder="AAPL,NVDA,TSLA,AMD,PLTR..."
              className="w-full h-9 px-3 text-sm bg-background border border-card-border rounded-md font-mono text-foreground placeholder:text-muted-foreground"
              data-testid="input-custom-tickers"
            />
            <p className="text-[10px] text-muted-foreground mt-1">Comma-separated, max 30. Scans each ticker for institutional activity.</p>
          </div>
        )}

        <button onClick={() => scanRefetch()} disabled={scanFetching}
          className="inline-flex items-center gap-2 bg-primary hover:bg-primary/90 text-white font-semibold px-6 py-2.5 rounded-lg transition-colors disabled:opacity-50"
          data-testid="button-inst-scan">
          {scanFetching ? (
            <><Loader2 className="h-4 w-4 animate-spin" />Scanning...</>
          ) : (
            <><Search className="h-4 w-4" />{scanData ? "New Scan" : "Scan Institutional Flow"}</>
          )}
        </button>
      </div>

      {/* Scan Status */}
      {scanData && !scanFetching && (
        <div className="text-center text-[11px] text-muted-foreground">
          Scanned {scanData.totalScanned} stocks at {new Date(scanData.scannedAt).toLocaleTimeString()} · {scanData.results.length} results · Ranked by money flow strength
        </div>
      )}

      {/* Loading */}
      {scanFetching && (
        <div className="space-y-3">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="bg-card border border-card-border rounded-lg p-6">
              <div className="flex items-center gap-4">
                <div className="w-8 h-8 rounded bg-muted skeleton-shimmer" />
                <div className="flex-1 space-y-2"><div className="h-4 w-24 rounded bg-muted skeleton-shimmer" /><div className="h-3 w-48 rounded bg-muted skeleton-shimmer" /></div>
              </div>
            </div>
          ))}
          <p className="text-center text-sm text-muted-foreground animate-pulse">
            Analyzing institutional holdings across {scanMode === "custom" ? "your tickers" : "30 stocks"}... This takes 30-60 seconds.
          </p>
        </div>
      )}

      {/* Results */}
      {scanData && !scanFetching && scanData.results.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              {scanData.results.length} Results
            </h3>
            <span className="text-xs text-muted-foreground">Click any card for full institutional breakdown</span>
          </div>
          {scanData.results.map((result, idx) => (
            <ResultCard key={result.ticker} data={result} rank={idx + 1} onClick={() => setSelectedData(result)} />
          ))}
        </div>
      )}

      {scanData && !scanFetching && scanData.results.length === 0 && (
        <div className="bg-card border border-card-border rounded-lg p-8 text-center">
          <p className="text-muted-foreground">No institutional data found for the scanned tickers.</p>
        </div>
      )}

      {!scanData && !scanFetching && !activeTicker && (
        <div className="text-center py-8 text-muted-foreground">
          <Building2 className="h-8 w-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">Search a ticker above or click "Scan Institutional Flow" to analyze the top 30 stocks.</p>
        </div>
      )}

      {/* Detail Modal */}
      {selectedData && <DetailModal data={selectedData} onClose={() => setSelectedData(null)} />}
    </div>
  );
}
