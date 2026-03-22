import { CheckCircle2, XCircle, TrendingUp, TrendingDown, Shield, Target, Activity } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { formatCurrency, formatLargeNumber, getVerdictColor, getChangeColor, formatPercent } from "@/lib/format";

interface VerdictSummaryProps {
  data: any;
}

export function VerdictSummary({ data }: VerdictSummaryProps) {
  const verdictColor = getVerdictColor(data.verdict);
  const changeColor = getChangeColor(data.changePercent);

  return (
    <div className={`bg-card border rounded-lg overflow-hidden ${verdictColor.border}`} data-testid="verdict-summary">
      {/* Verdict Header */}
      <div className="p-6 pb-4">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex items-center gap-4">
            <div className={`${verdictColor.bg} text-white font-bold text-lg px-5 py-2 rounded-lg`} data-testid="verdict-badge">
              {data.verdict}
            </div>
            <div>
              <h2 className="text-lg font-bold text-foreground" data-testid="text-company-name">
                {data.companyName}
              </h2>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="font-mono font-semibold text-foreground">{data.ticker}</span>
                <span>·</span>
                <span>{data.assetType}</span>
                <span>·</span>
                <span>{data.sector}</span>
              </div>
            </div>
          </div>

          {/* Score */}
          <div className="text-right" data-testid="text-score">
            <div className={`text-3xl font-bold tabular-nums ${verdictColor.text}`}>
              {data.score.toFixed(2)}
            </div>
            <div className="text-xs text-muted-foreground uppercase tracking-wider">/ 10</div>
          </div>
        </div>

        {/* Ruling */}
        <p className="text-sm text-muted-foreground mb-4" data-testid="text-ruling">
          {data.ruling}
        </p>

        {/* Badges */}
        <div className="flex flex-wrap gap-2 mb-4">
          <Badge variant="outline" className="gap-1 text-xs">
            <Shield className="h-3 w-3" />
            {data.missionFit}
          </Badge>
          <Badge variant="outline" className="gap-1 text-xs">
            <Target className="h-3 w-3" />
            {data.bestUse}
          </Badge>
          <Link href={`/trade/${data.ticker}`}>
            <Badge variant="outline" className="gap-1 text-xs cursor-pointer hover:bg-primary/10 transition-colors" data-testid="link-trade-analysis">
              <Activity className="h-3 w-3" />
              Trade Analysis
            </Badge>
          </Link>
        </div>

        {/* Price */}
        <div className="flex items-baseline gap-3 mb-4">
          <span className="text-2xl font-bold tabular-nums text-foreground" data-testid="text-price">
            {formatCurrency(data.price)}
          </span>
          <span className={`text-sm font-semibold tabular-nums ${changeColor}`} data-testid="text-change">
            {data.change !== null && data.change >= 0 ? "+" : ""}
            {data.change !== null ? data.change.toFixed(2) : "N/A"}
            {" "}
            ({data.changePercent !== null ? (data.changePercent >= 0 ? "+" : "") + data.changePercent.toFixed(2) + "%" : "N/A"})
          </span>
          {data.changePercent !== null && (
            data.changePercent >= 0 
              ? <TrendingUp className="h-4 w-4 text-green-500" /> 
              : <TrendingDown className="h-4 w-4 text-red-500" />
          )}
        </div>
      </div>

      {/* Positives & Risks */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-0 border-t border-card-border">
        {/* Positives */}
        <div className="p-4 md:border-r border-card-border">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-green-500 mb-3">Top Positives</h3>
          <ul className="space-y-2">
            {data.positives?.map((p: string, i: number) => (
              <li key={i} className="flex items-start gap-2 text-sm text-foreground" data-testid={`text-positive-${i}`}>
                <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Risks */}
        <div className="p-4 border-t md:border-t-0 border-card-border">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-red-500 mb-3">Top Risks</h3>
          <ul className="space-y-2">
            {data.risks?.map((r: string, i: number) => (
              <li key={i} className="flex items-start gap-2 text-sm text-foreground" data-testid={`text-risk-${i}`}>
                <XCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
