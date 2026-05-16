import { BarChart3 } from "lucide-react";
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
import { LimitReached } from "@/components/LimitReached";
import InvalidSymbol, { isSymbolNotFound } from "@/components/InvalidSymbol";
import { useSubscription } from "@/hooks/useSubscription";
import { PageHeader } from "@/components/PageHeader";
import { Disclaimer } from "@/components/Disclaimer";
import { HelpBlock } from "@/components/HelpBlock";

export default function Home() {
  const { activeTicker, analysisData: data, isAnalysisLoading: isLoading, analysisError: error } = useTicker();
  const { isAnalysisExhausted } = useSubscription();

  return (
    <div className="max-w-5xl mx-auto px-3 sm:px-4 py-4 sm:py-6 space-y-6">
      {/* Title */}
      <PageHeader
        icon={BarChart3}
        title="Profile"
        subtitle={data ? `${data.companyName} (${data.ticker})` : "Snapshot, fundamentals, and red flags for any ticker."}
      />

      {/* Disclaimer */}
      <Disclaimer />

      {/* How It Works */}
      <HelpBlock title="How the Profile page works">
        <p>The Profile is the all-in-one company snapshot. Search a ticker in the header and this page pulls together the verdict, a quick trade-analysis bar, business quality, historical performance, income / dividends, the underlying scoring model, and any red flags we've detected.</p>
        <p><strong className="text-foreground">Verdict Summary</strong> — the top-line buy/hold/avoid grade and 0-10 score that's also shown in the header banner.</p>
        <p><strong className="text-foreground">Quick Trade Analysis</strong> — same 3-gate signal you see on the Trade Analysis page and the Scanner, so the grade lines up everywhere.</p>
        <p><strong className="text-foreground">Snapshot / Business Quality / Performance</strong> — fundamentals, growth, returns vs. peers.</p>
        <p><strong className="text-foreground">Income Analysis</strong> — dividend history, yield, payout ratio, ex-div date.</p>
        <p><strong className="text-foreground">Scoring Model</strong> — the factor breakdown that produced the verdict, so you can see <em>why</em> the score is what it is.</p>
        <p><strong className="text-foreground">Red Flags</strong> — anything that should give you pause (debt load, declining margins, accounting concerns).</p>
      </HelpBlock>

      {/* Limit reached — hide everything, show otter */}
      {isAnalysisExhausted && !isLoading ? (
        <LimitReached feature="Stock Analysis" />
      ) : (
        <>
          {/* Loading Skeleton */}
          {isLoading && <LoadingSkeleton />}

          {/* Error State */}
          {error && !isLoading && (
            isSymbolNotFound(error.message || "") ? (
              <InvalidSymbol ticker={activeTicker} />
            ) : (
              <div className="bg-bear/10 border border-bear/20 rounded-lg p-4 text-center" data-testid="error-message">
                <p className="text-bear-light font-medium">
                  {error.message?.replace(/^\d+:\s*/, "").replace(/[{}"]/g, "").replace(/error:/i, "").trim() || "Failed to analyze ticker. Please try again."}
                </p>
              </div>
            )
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
        </>
      )}
    </div>
  );
}
