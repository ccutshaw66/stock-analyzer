import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Link } from "wouter";
import {
  Radar, ArrowLeft, Search, TrendingUp, TrendingDown, Minus,
  Activity, BarChart3, Volume2, Zap, ChevronDown, ChevronUp,
  SlidersHorizontal, Eye, EyeOff
} from "lucide-react";

const SECTORS = [
  "All Sectors", "Technology", "Healthcare", "Financial Services",
  "Consumer Cyclical", "Communication Services", "Industrials",
  "Consumer Defensive", "Energy", "Real Estate", "Utilities", "Basic Materials"
];

const MARKET_CAP_TIERS = [
  { value: "all", label: "All Caps" },
  { value: "mega", label: "Mega ($200B+)" },
  { value: "large", label: "Large ($10B-$200B)" },
  { value: "mid", label: "Mid ($2B-$10B)" },
  { value: "small", label: "Small ($300M-$2B)" },
];

const PRICE_RANGES = [
  { value: "all", label: "Any Price", min: 5, max: 10000 },
  { value: "penny", label: "Under $10", min: 1, max: 10 },
  { value: "low", label: "$10 - $50", min: 10, max: 50 },
  { value: "mid", label: "$50 - $150", min: 50, max: 150 },
  { value: "high", label: "$150 - $500", min: 150, max: 500 },
  { value: "premium", label: "$500+", min: 500, max: 10000 },
];

interface ScanResult {
  ticker: string;
  price: number;
  score: number;
  bbtc: { signal: string; trend: string; bias: string };
  dts: { signal: string; rsi: number | null };
  confirmation: {
    signal: string;
    macd: string;
    bollingerPosition: string;
    volumeSurge: boolean;
    adx: number | null;
    adxTrending: boolean;
  };
  alignmentLabel: string | null;
}

interface ScanResponse {
  scannedAt: string;
  totalScanned: number;
  filters: any;
  results: ScanResult[];
}

function SignalBadge({ signal, size = "sm" }: { signal: string; size?: "sm" | "md" }) {
  const base = size === "md" ? "px-3 py-1.5 text-sm" : "px-2 py-0.5 text-[11px]";
  let color = "bg-muted text-muted-foreground";
  if (signal === "ENTER" || signal === "CONFIRMED_BUY" || signal === "LEAN_BUY")
    color = signal === "CONFIRMED_BUY" ? "bg-green-500 text-white" : signal === "LEAN_BUY" ? "bg-green-500/20 text-green-400" : "bg-green-500/80 text-white";
  else if (signal === "SELL" || signal === "CONFIRMED_SELL" || signal === "LEAN_SELL")
    color = signal === "CONFIRMED_SELL" ? "bg-red-500 text-white" : signal === "LEAN_SELL" ? "bg-red-500/20 text-red-400" : "bg-red-500/80 text-white";
  else if (signal === "HOLD" || signal === "NEUTRAL")
    color = "bg-yellow-500/20 text-yellow-400";
  return <span className={`${base} font-bold rounded-md uppercase whitespace-nowrap`}>{signal.replace(/_/g, " ")}</span>;
}

function AlignmentBadge({ label, score }: { label: string | null; score: number }) {
  if (score >= 5) return <span className="bg-green-500 text-white px-3 py-1 text-xs font-bold rounded-md uppercase">Strong Buy</span>;
  if (score >= 3) return <span className="bg-green-500/70 text-white px-3 py-1 text-xs font-bold rounded-md uppercase">Buy</span>;
  if (score >= 2) return <span className="bg-green-500/30 text-green-300 px-3 py-1 text-xs font-bold rounded-md uppercase">Lean Buy</span>;
  if (score >= 0) return <span className="bg-yellow-500/20 text-yellow-400 px-3 py-1 text-xs font-bold rounded-md uppercase">Neutral</span>;
  if (score >= -2) return <span className="bg-red-500/20 text-red-400 px-3 py-1 text-xs font-bold rounded-md uppercase">Lean Sell</span>;
  return <span className="bg-red-500 text-white px-3 py-1 text-xs font-bold rounded-md uppercase">Sell</span>;
}

function ScoreBar({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(100, ((score + 7) / 14) * 100));
  const color = score >= 5 ? "bg-green-500" : score >= 3 ? "bg-green-400" : score >= 2 ? "bg-yellow-400" : score >= 0 ? "bg-yellow-500/50" : "bg-red-400";
  return (
    <div className="flex items-center gap-2">
      <span className={`text-sm font-bold tabular-nums w-8 ${score >= 2 ? "text-green-400" : score >= 0 ? "text-yellow-400" : "text-red-400"}`}>{score}/7</span>
      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden max-w-[80px]">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function ConfirmationDetail({ c }: { c: ScanResult["confirmation"] }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 pt-3 border-t border-card-border/50">
      <div className="flex items-center gap-1.5">
        <Activity className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">MACD:</span>
        <span className={`text-xs font-semibold ${c.macd === "bullish" ? "text-green-400" : c.macd === "bearish" ? "text-red-400" : "text-muted-foreground"}`}>{c.macd}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">BB:</span>
        <span className={`text-xs font-semibold ${c.bollingerPosition === "near_lower" ? "text-green-400" : c.bollingerPosition === "near_upper" ? "text-red-400" : "text-muted-foreground"}`}>{c.bollingerPosition.replace(/_/g, " ")}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <Volume2 className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">Vol:</span>
        <span className={`text-xs font-semibold ${c.volumeSurge ? "text-green-400" : "text-muted-foreground"}`}>{c.volumeSurge ? "Surge" : "Normal"}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <Zap className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">ADX:</span>
        <span className={`text-xs font-semibold ${c.adxTrending ? "text-green-400" : "text-muted-foreground"}`}>{c.adx ?? "N/A"} {c.adxTrending ? "↑" : ""}</span>
      </div>
    </div>
  );
}

function ScanResultCard({ result, rank }: { result: ScanResult; rank: number }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="bg-card border border-card-border rounded-lg p-4 hover:border-primary/30 transition-colors" data-testid={`scanner-result-${result.ticker}`}>
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-3">
          <span className="text-2xl font-bold text-muted-foreground/40 tabular-nums w-8">{rank}</span>
          <div>
            <div className="flex items-center gap-2">
              <Link href={`/trade/${result.ticker}`}>
                <span className="font-mono font-bold text-base text-foreground hover:text-primary cursor-pointer transition-colors">{result.ticker}</span>
              </Link>
              <span className="text-sm tabular-nums text-muted-foreground">${result.price.toFixed(2)}</span>
            </div>
            <div className="flex items-center gap-1 mt-0.5">
              {result.bbtc.trend === "UP" ? <TrendingUp className="h-3 w-3 text-green-500" /> :
               result.bbtc.trend === "DOWN" ? <TrendingDown className="h-3 w-3 text-red-500" /> :
               <Minus className="h-3 w-3 text-yellow-500" />}
              <span className="text-[10px] text-muted-foreground">{result.bbtc.trend} · {result.bbtc.bias}</span>
              {result.dts.rsi !== null && (
                <span className={`text-[10px] ml-1 ${result.dts.rsi < 30 ? "text-green-400" : result.dts.rsi > 70 ? "text-red-400" : "text-muted-foreground"}`}>· RSI {result.dts.rsi}</span>
              )}
            </div>
          </div>
        </div>
        <AlignmentBadge label={result.alignmentLabel} score={result.score} />
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex flex-col items-center gap-0.5">
          <SignalBadge signal={result.bbtc.signal} />
          <span className="text-[9px] text-muted-foreground uppercase">BBTC</span>
        </div>
        <div className="flex flex-col items-center gap-0.5">
          <SignalBadge signal={result.dts.signal} />
          <span className="text-[9px] text-muted-foreground uppercase">DTS</span>
        </div>
        <div className="flex flex-col items-center gap-0.5">
          <SignalBadge signal={result.confirmation.signal} />
          <span className="text-[9px] text-muted-foreground uppercase">Confirm</span>
        </div>
        <div className="ml-auto">
          <ScoreBar score={result.score} />
        </div>
      </div>
      <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center justify-center gap-1 mt-3 pt-2 border-t border-card-border/30 text-xs text-muted-foreground hover:text-foreground transition-colors">
        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        {expanded ? "Hide" : "Show"} details
      </button>
      {expanded && <ConfirmationDetail c={result.confirmation} />}
    </div>
  );
}

export default function Scanner() {
  const [sector, setSector] = useState("All Sectors");
  const [priceRange, setPriceRange] = useState("all");
  const [marketCap, setMarketCap] = useState("all");
  const [showAll, setShowAll] = useState(true);
  const [scanCount, setScanCount] = useState(75);
  const [filtersOpen, setFiltersOpen] = useState(true);

  // Build query params
  const priceConfig = PRICE_RANGES.find(p => p.value === priceRange) || PRICE_RANGES[0];
  const queryParams = new URLSearchParams({
    minPrice: String(priceConfig.min),
    maxPrice: String(priceConfig.max),
    sector: sector === "All Sectors" ? "all" : sector,
    marketCap,
    count: String(scanCount),
    showAll: String(showAll),
  }).toString();

  const { data, isFetching, refetch } = useQuery<ScanResponse>({
    queryKey: ["/api/scanner", queryParams],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/scanner?${queryParams}`);
      return res.json();
    },
    enabled: false,
    staleTime: 5 * 60 * 1000,
  });

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4 mb-2">
          <Link href="/"><span className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground cursor-pointer transition-colors"><ArrowLeft className="h-4 w-4" /> Back</span></Link>
          <div className="flex items-center gap-2">
            <Radar className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-bold text-foreground">Strategy Scanner</h1>
          </div>
        </div>

        {/* Filter Controls */}
        <div className="bg-card border border-card-border rounded-lg overflow-hidden">
          <button
            onClick={() => setFiltersOpen(!filtersOpen)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-foreground hover:bg-muted/30 transition-colors"
          >
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-primary" />
              Scan Filters
            </div>
            {filtersOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>

          {filtersOpen && (
            <div className="px-4 pb-4 space-y-4 border-t border-card-border">
              {/* Row 1: Sector + Market Cap */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3">
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1 block">Sector</label>
                  <select
                    value={sector}
                    onChange={(e) => setSector(e.target.value)}
                    className="w-full bg-background border border-card-border rounded-md px-3 py-2 text-sm text-foreground"
                    data-testid="select-sector"
                  >
                    {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1 block">Market Cap</label>
                  <select
                    value={marketCap}
                    onChange={(e) => setMarketCap(e.target.value)}
                    className="w-full bg-background border border-card-border rounded-md px-3 py-2 text-sm text-foreground"
                    data-testid="select-marketcap"
                  >
                    {MARKET_CAP_TIERS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
              </div>

              {/* Row 2: Price Range + Scan Size */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1 block">Price Range</label>
                  <select
                    value={priceRange}
                    onChange={(e) => setPriceRange(e.target.value)}
                    className="w-full bg-background border border-card-border rounded-md px-3 py-2 text-sm text-foreground"
                    data-testid="select-price"
                  >
                    {PRICE_RANGES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1 block">Stocks to Scan</label>
                  <div className="flex gap-2">
                    {[50, 75, 100, 150].map(n => (
                      <button
                        key={n}
                        onClick={() => setScanCount(n)}
                        className={`flex-1 py-2 text-xs font-semibold rounded-md transition-colors ${scanCount === n ? "bg-primary text-white" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Row 3: Show all toggle + Scan button */}
              <div className="flex items-center justify-between pt-1">
                <button
                  onClick={() => setShowAll(!showAll)}
                  className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  data-testid="toggle-show-all"
                >
                  {showAll ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                  {showAll ? "Showing all results (buy + neutral + sell)" : "Showing buy-aligned only (score 2+)"}
                </button>

                <button
                  onClick={() => refetch()}
                  disabled={isFetching}
                  className="inline-flex items-center gap-2 bg-primary hover:bg-primary/90 text-white font-semibold px-6 py-2.5 rounded-lg transition-colors disabled:opacity-50"
                  data-testid="button-scan"
                >
                  {isFetching ? (
                    <><Radar className="h-4 w-4 animate-spin" />Scanning...</>
                  ) : (
                    <><Search className="h-4 w-4" />Scan {scanCount} Stocks</>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Scan status */}
        {data && !isFetching && (
          <div className="text-center text-[11px] text-muted-foreground">
            Scanned {data.totalScanned} stocks at {new Date(data.scannedAt).toLocaleTimeString()} · {data.results.length} results shown
            {data.filters?.sector !== "all" && ` · ${data.filters.sector}`}
            {data.filters?.marketCapTier !== "all" && ` · ${data.filters.marketCapTier} cap`}
          </div>
        )}

        {/* Loading */}
        {isFetching && (
          <div className="space-y-3">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="bg-card border border-card-border rounded-lg p-6">
                <div className="flex items-center gap-4">
                  <div className="w-8 h-8 rounded bg-muted skeleton-shimmer" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-24 rounded bg-muted skeleton-shimmer" />
                    <div className="h-3 w-48 rounded bg-muted skeleton-shimmer" />
                  </div>
                  <div className="h-8 w-20 rounded bg-muted skeleton-shimmer" />
                </div>
              </div>
            ))}
            <p className="text-center text-sm text-muted-foreground animate-pulse">
              Screening {scanCount} stocks across 3 strategies...
            </p>
          </div>
        )}

        {/* Results */}
        {data && !isFetching && data.results.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                {showAll ? `All ${data.results.length} Results` : `Top ${data.results.length} Aligned`}
              </h3>
              <span className="text-xs text-muted-foreground">Ranked by strategy alignment</span>
            </div>
            {data.results.map((result, idx) => (
              <ScanResultCard key={result.ticker} result={result} rank={idx + 1} />
            ))}
          </div>
        )}

        {data && !isFetching && data.results.length === 0 && (
          <div className="bg-card border border-card-border rounded-lg p-8 text-center">
            <p className="text-muted-foreground">No stocks matched the current criteria.</p>
            <p className="text-sm text-muted-foreground mt-1">Try widening your filters or scanning more stocks.</p>
          </div>
        )}

        {!data && !isFetching && (
          <div className="text-center py-8 text-muted-foreground">
            <p className="text-sm">Set your filters above and press "Scan" to find aligned stocks</p>
          </div>
        )}
      </div>
    </div>
  );
}
