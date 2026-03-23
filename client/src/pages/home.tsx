import { useTicker } from "@/contexts/TickerContext";
import { VerdictSummary } from "@/components/VerdictSummary";
import { QuickTradeAnalysis } from "@/components/QuickTradeAnalysis";
import { Snapshot } from "@/components/Snapshot";
import { BusinessQuality } from "@/components/BusinessQuality";
import { Performance } from "@/components/Performance";
import { IncomeAnalysis } from "@/components/IncomeAnalysis";
import { ScoringModel } from "@/components/ScoringModel";
import { RedFlags } from "@/components/RedFlags";
import { DecisionShortcut } from "@/components/DecisionShortcut";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";

export default function Home() {
  const { analysisData: data, isAnalysisLoading: isLoading, analysisError: error } = useTicker();

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      {/* Loading Skeleton */}
      {isLoading && <LoadingSkeleton />}

      {/* Error State */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-center" data-testid="error-message">
          <p className="text-red-400 font-medium">
            {error.message || "Failed to analyze ticker. Please try again."}
          </p>
        </div>
      )}

      {/* Analysis Results */}
      {data && !isLoading && (
        <div className="space-y-6">
          <VerdictSummary data={data} />
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
    </div>
  );
}
