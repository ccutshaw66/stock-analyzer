import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Link } from "wouter";
import {
  Radar, ArrowLeft, Search, TrendingUp, TrendingDown, Minus,
  Activity, BarChart3, Volume2, Zap, ChevronDown, ChevronUp
} from "lucide-react";

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
  if (!label) return null;
  const color = score >= 5 ? "bg-green-500 text-white" : score >= 3 ? "bg-green-500/70 text-white" : "bg-green-500/30 text-green-300";
  return <span className={`${color} px-3 py-1 text-xs font-bold rounded-md uppercase`}>{label}</span>;
}

function ScoreBar({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(100, ((score + 7) / 14) * 100));
  const color = score >= 5 ? "bg-green-500" : score >= 3 ? "bg-green-400" : score >= 2 ? "bg-yellow-400" : "bg-muted";
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm font-bold tabular-nums text-foreground w-8">{score}/7</span>
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
        <span className={`text-xs font-semibold ${c.macd === "bullish" ? "text-green-400" : c.macd === "bearish" ? "text-red-400" : "text-muted-foreground"}`}>
          {c.macd}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">BB:</span>
        <span className={`text-xs font-semibold ${c.bollingerPosition === "near_lower" ? "text-green-400" : c.bollingerPosition === "near_upper" ? "text-red-400" : "text-muted-foreground"}`}>
          {c.bollingerPosition.replace(/_/g, " ")}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <Volume2 className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">Vol:</span>
        <span className={`text-xs font-semibold ${c.volumeSurge ? "text-green-400" : "text-muted-foreground"}`}>
          {c.volumeSurge ? "Surge" : "Normal"}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <Zap className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">ADX:</span>
        <span className={`text-xs font-semibold ${c.adxTrending ? "text-green-400" : "text-muted-foreground"}`}>
          {c.adx ?? "N/A"} {c.adxTrending ? "↑" : ""}
        </span>
      </div>
    </div>
  );
}

function ScanResultCard({ result, rank }: { result: ScanResult; rank: number }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-card border border-card-border rounded-lg p-4 hover:border-primary/30 transition-colors" data-testid={`scanner-result-${result.ticker}`}>
      {/* Header row */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-3">
          <span className="text-2xl font-bold text-muted-foreground/40 tabular-nums w-8">{rank}</span>
          <div>
            <div className="flex items-center gap-2">
              <Link href={`/trade/${result.ticker}`}>
                <span className="font-mono font-bold text-base text-foreground hover:text-primary cursor-pointer transition-colors" data-testid={`link-ticker-${result.ticker}`}>
                  {result.ticker}
                </span>
              </Link>
              <span className="text-sm tabular-nums text-muted-foreground">${result.price.toFixed(2)}</span>
            </div>
            <div className="flex items-center gap-1 mt-0.5">
              {result.bbtc.trend === "UP" ? <TrendingUp className="h-3 w-3 text-green-500" /> :
               result.bbtc.trend === "DOWN" ? <TrendingDown className="h-3 w-3 text-red-500" /> :
               <Minus className="h-3 w-3 text-yellow-500" />}
              <span className="text-[10px] text-muted-foreground">{result.bbtc.trend} trend · {result.bbtc.bias} bias</span>
              {result.dts.rsi !== null && (
                <span className={`text-[10px] ml-1 ${result.dts.rsi < 30 ? "text-green-400" : result.dts.rsi > 70 ? "text-red-400" : "text-muted-foreground"}`}>
                  · RSI {result.dts.rsi}
                </span>
              )}
            </div>
          </div>
        </div>
        <AlignmentBadge label={result.alignmentLabel} score={result.score} />
      </div>

      {/* Signal badges row */}
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

      {/* Expand/collapse for details */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-center gap-1 mt-3 pt-2 border-t border-card-border/30 text-xs text-muted-foreground hover:text-foreground transition-colors"
        data-testid={`button-expand-${result.ticker}`}
      >
        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        {expanded ? "Hide" : "Show"} details
      </button>

      {expanded && <ConfirmationDetail c={result.confirmation} />}
    </div>
  );
}

export default function Scanner() {
  const { data, isLoading, isFetching, refetch } = useQuery<ScanResponse>({
    queryKey: ["/api/scanner"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/scanner");
      return res.json();
    },
    enabled: false,
    staleTime: 5 * 60 * 1000,
  });

  const handleScan = () => {
    refetch();
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Link href="/">
            <span className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground cursor-pointer transition-colors" data-testid="link-back">
              <ArrowLeft className="h-4 w-4" /> Back
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <Radar className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-bold text-foreground">Strategy Scanner</h1>
          </div>
        </div>

        {/* Scan description + button */}
        <div className="bg-card border border-card-border rounded-lg p-6 text-center">
          <Radar className="h-8 w-8 text-primary mx-auto mb-3 opacity-60" />
          <h2 className="text-base font-semibold text-foreground mb-1">3-Strategy Alignment Scanner</h2>
          <p className="text-sm text-muted-foreground mb-4 max-w-lg mx-auto">
            Scans 50 top stocks across all three strategies — BBTC EMA Pyramid, DTS Reversal Swing, and Triple Confluence (MACD + Bollinger + Volume + ADX). Shows the top 10 where strategies align on a buy signal.
          </p>

          <button
            onClick={handleScan}
            disabled={isFetching}
            className="inline-flex items-center gap-2 bg-primary hover:bg-primary/90 text-white font-semibold px-6 py-3 rounded-lg transition-colors disabled:opacity-50"
            data-testid="button-scan"
          >
            {isFetching ? (
              <>
                <Radar className="h-4 w-4 animate-spin" />
                Scanning 50 stocks...
              </>
            ) : (
              <>
                <Search className="h-4 w-4" />
                Scan Now
              </>
            )}
          </button>

          {data && !isFetching && (
            <p className="text-[11px] text-muted-foreground mt-3">
              Last scanned: {new Date(data.scannedAt).toLocaleTimeString()} · {data.totalScanned} stocks analyzed · {data.results.length} qualified
            </p>
          )}
        </div>

        {/* Loading state */}
        {isFetching && (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
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
              Analyzing strategies across 50 stocks... this takes about 30 seconds
            </p>
          </div>
        )}

        {/* Results */}
        {data && !isFetching && (
          <>
            {data.results.length === 0 ? (
              <div className="bg-card border border-card-border rounded-lg p-8 text-center">
                <p className="text-muted-foreground">No stocks currently meet the alignment criteria (score 2+).</p>
                <p className="text-sm text-muted-foreground mt-1">The market may be in a transitional phase. Try again later.</p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                    Top {data.results.length} Aligned Stocks
                  </h3>
                  <span className="text-xs text-muted-foreground">Ranked by strategy alignment score</span>
                </div>
                {data.results.map((result, idx) => (
                  <ScanResultCard key={result.ticker} result={result} rank={idx + 1} />
                ))}
              </div>
            )}
          </>
        )}

        {/* Empty state (no scan run yet) */}
        {!data && !isFetching && (
          <div className="text-center py-8 text-muted-foreground">
            <p className="text-sm">Press "Scan Now" to find stocks where all three strategies align</p>
          </div>
        )}
      </div>
    </div>
  );
}
