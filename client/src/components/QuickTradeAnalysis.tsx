import { TrendingUp, TrendingDown, Minus, Activity, Users, BarChart3, Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatPercent, getChangeColor, getBadgeBgColor } from "@/lib/format";

interface QuickTradeAnalysisProps {
  data: any;
}

export function QuickTradeAnalysis({ data }: QuickTradeAnalysisProps) {
  const { analystData, sentiment } = data;
  const totalRatings = (analystData?.buy ?? 0) + (analystData?.hold ?? 0) + (analystData?.sell ?? 0);
  const buyPct = totalRatings > 0 ? ((analystData.buy / totalRatings) * 100) : 0;
  const holdPct = totalRatings > 0 ? ((analystData.hold / totalRatings) * 100) : 0;
  const sellPct = totalRatings > 0 ? ((analystData.sell / totalRatings) * 100) : 0;

  const sentimentColor = sentiment === "Bullish" ? "green" : sentiment === "Bearish" ? "red" : "yellow";
  const sentimentIcon = sentiment === "Bullish" ? TrendingUp : sentiment === "Bearish" ? TrendingDown : Minus;
  const SentimentIcon = sentimentIcon;

  // Short-term outlook
  const changePercent = data.changePercent ?? 0;
  let outlookLabel = "Neutral";
  let outlookColor = "yellow";
  if (changePercent > 2) { outlookLabel = "Positive"; outlookColor = "green"; }
  else if (changePercent < -2) { outlookLabel = "Negative"; outlookColor = "red"; }

  return (
    <div className="bg-card border border-card-border rounded-lg p-6" data-testid="quick-trade-analysis">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4 flex items-center gap-2">
        <Activity className="h-4 w-4" />
        Quick Trade Analysis
      </h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Price Action */}
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Price Action</div>
          <div className={`text-sm font-semibold tabular-nums ${getChangeColor(data.changePercent)}`} data-testid="text-day-change">
            {data.changePercent !== null ? (data.changePercent >= 0 ? "+" : "") + formatPercent(data.changePercent) : "N/A"} today
          </div>
        </div>

        {/* Sentiment */}
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Sentiment</div>
          <div className="flex items-center gap-2">
            <SentimentIcon className={`h-4 w-4 ${sentimentColor === "green" ? "text-green-500" : sentimentColor === "red" ? "text-red-500" : "text-yellow-500"}`} />
            <Badge variant="outline" className={`text-xs ${getBadgeBgColor(sentimentColor)}`} data-testid="text-sentiment">
              {sentiment}
            </Badge>
          </div>
        </div>

        {/* Short-term Outlook */}
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Short-term Outlook</div>
          <Badge variant="outline" className={`text-xs ${getBadgeBgColor(outlookColor)}`} data-testid="text-outlook">
            {outlookLabel}
          </Badge>
        </div>

        {/* Price Target */}
        <div className="space-y-1 sm:col-span-2 lg:col-span-3">
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <Target className="h-3 w-3" />
            Price Target
          </div>
          {analystData?.targetMean ? (
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <div className="flex justify-between text-xs text-muted-foreground mb-1 tabular-nums">
                  <span>{formatCurrency(analystData.targetLow)}</span>
                  <span className="font-semibold text-foreground">Avg: {formatCurrency(analystData.targetMean)}</span>
                  <span>{formatCurrency(analystData.targetHigh)}</span>
                </div>
                <div className="relative h-2 bg-muted rounded-full overflow-hidden">
                  {/* Current price position */}
                  {data.price && analystData.targetLow && analystData.targetHigh && (
                    <div
                      className="absolute top-0 h-full w-1 bg-primary rounded-full"
                      style={{
                        left: `${Math.max(0, Math.min(100, ((data.price - analystData.targetLow) / (analystData.targetHigh - analystData.targetLow)) * 100))}%`,
                      }}
                    />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-r from-red-500/30 via-yellow-500/30 to-green-500/30 rounded-full" />
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Current: <span className="font-semibold text-foreground tabular-nums">{formatCurrency(data.price)}</span>
                  {data.price && analystData.targetMean && (
                    <span className={`ml-2 ${data.price < analystData.targetMean ? "text-green-500" : "text-red-500"}`}>
                      ({data.price < analystData.targetMean ? "+" : ""}{(((analystData.targetMean - data.price) / data.price) * 100).toFixed(1)}% to target)
                    </span>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">No analyst data</span>
          )}
        </div>

        {/* Analyst Consensus */}
        <div className="space-y-2 sm:col-span-2 lg:col-span-3">
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <BarChart3 className="h-3 w-3" />
            Analyst Consensus ({totalRatings} ratings)
          </div>
          {totalRatings > 0 ? (
            <>
              <div className="flex h-4 rounded-full overflow-hidden">
                {buyPct > 0 && (
                  <div className="bg-green-500 transition-all" style={{ width: `${buyPct}%` }} />
                )}
                {holdPct > 0 && (
                  <div className="bg-yellow-500 transition-all" style={{ width: `${holdPct}%` }} />
                )}
                {sellPct > 0 && (
                  <div className="bg-red-500 transition-all" style={{ width: `${sellPct}%` }} />
                )}
              </div>
              <div className="flex justify-between text-xs tabular-nums">
                <span className="text-green-500">Buy: {analystData.buy} ({buyPct.toFixed(0)}%)</span>
                <span className="text-yellow-500">Hold: {analystData.hold} ({holdPct.toFixed(0)}%)</span>
                <span className="text-red-500">Sell: {analystData.sell} ({sellPct.toFixed(0)}%)</span>
              </div>
            </>
          ) : (
            <span className="text-sm text-muted-foreground">No analyst ratings available</span>
          )}
        </div>
      </div>
    </div>
  );
}
