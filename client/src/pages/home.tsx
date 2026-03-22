import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { TickerSearch } from "@/components/TickerSearch";
import { VerdictSummary } from "@/components/VerdictSummary";
import { QuickTradeAnalysis } from "@/components/QuickTradeAnalysis";
import { Snapshot } from "@/components/Snapshot";
import { BusinessQuality } from "@/components/BusinessQuality";
import { Performance } from "@/components/Performance";
import { IncomeAnalysis } from "@/components/IncomeAnalysis";
import { ScoringModel } from "@/components/ScoringModel";
import { RedFlags } from "@/components/RedFlags";
import { DecisionShortcut } from "@/components/DecisionShortcut";
import { FavoritesPanel } from "@/components/FavoritesPanel";
import { PerplexityAttribution } from "@/components/PerplexityAttribution";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";

export default function Home() {
  const [ticker, setTicker] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["/api/analyze", ticker],
    queryFn: async () => {
      if (!ticker) return null;
      const res = await apiRequest("GET", `/api/analyze/${ticker}`);
      return res.json();
    },
    enabled: !!ticker,
  });

  const handleAnalyze = (symbol: string) => {
    setTicker(symbol.toUpperCase());
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <header className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-2">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-label="Stock Analyzer Logo">
              <rect x="2" y="2" width="28" height="28" rx="6" stroke="currentColor" strokeWidth="2" className="text-primary" />
              <polyline points="6,22 12,14 18,18 26,8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-green-500" fill="none" />
              <circle cx="26" cy="8" r="2" fill="currentColor" className="text-green-500" />
            </svg>
            <h1 className="text-xl font-bold text-foreground tracking-tight">
              Stock Analyzer
            </h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Comprehensive investment analysis powered by real-time data
          </p>
        </header>

        {/* Main layout: Sidebar + Content */}
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Favorites Sidebar */}
          <aside className="w-full lg:w-72 shrink-0 order-2 lg:order-1">
            <div className="lg:sticky lg:top-8">
              <FavoritesPanel
                onSelectTicker={handleAnalyze}
                currentAnalysis={data && !isLoading ? data : null}
              />
            </div>
          </aside>

          {/* Main Content */}
          <main className="flex-1 min-w-0 space-y-6 order-1 lg:order-2">
            {/* Ticker Search */}
            <TickerSearch onAnalyze={handleAnalyze} isLoading={isLoading} />

            {/* Loading Skeleton */}
            {isLoading && <LoadingSkeleton />}

            {/* Error State */}
            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-center" data-testid="error-message">
                <p className="text-red-400 font-medium">
                  {(error as Error).message || "Failed to analyze ticker. Please try again."}
                </p>
              </div>
            )}

            {/* Analysis Results */}
            {data && !isLoading && (
              <div className="space-y-6">
                <VerdictSummary data={data} />
                <div className="flex justify-end">
                  <Link href={`/trade/${data.ticker}`}>
                    <button
                      className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors border border-primary/20"
                      data-testid="button-view-trade-analysis"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" />
                      </svg>
                      View Trade Analysis
                    </button>
                  </Link>
                </div>
                <QuickTradeAnalysis data={data} />
                <Snapshot data={data} />
                <BusinessQuality data={data} />
                <Performance data={data} />
                <IncomeAnalysis data={data} />
                <ScoringModel data={data} />
                <RedFlags data={data} />
                <DecisionShortcut data={data} />
              </div>
            )}

            {/* Empty State */}
            {!data && !isLoading && !error && (
              <div className="text-center py-16 text-muted-foreground" data-testid="empty-state">
                <div className="text-4xl mb-4 opacity-30">📊</div>
                <p className="text-lg">Enter a ticker symbol to get started</p>
                <p className="text-sm mt-1">Try AAPL, MSFT, GOOGL, or any stock symbol</p>
              </div>
            )}

            {/* Footer */}
            <footer className="pt-8 pb-4">
              <PerplexityAttribution />
            </footer>
          </main>
        </div>
      </div>
    </div>
  );
}
