import { Briefcase, ArrowUp, ArrowDown, ArrowRight } from "lucide-react";
import { formatPercent, formatLargeNumber, formatNumber } from "@/lib/format";

interface BusinessQualityProps {
  data: any;
}

function TrendIcon({ direction }: { direction: string }) {
  if (direction === "up") return <ArrowUp className="h-4 w-4 text-green-500" />;
  if (direction === "down") return <ArrowDown className="h-4 w-4 text-red-500" />;
  return <ArrowRight className="h-4 w-4 text-yellow-500" />;
}

function DotIndicator({ direction }: { direction: string }) {
  const color = direction === "up" ? "bg-green-500" : direction === "down" ? "bg-red-500" : "bg-yellow-500";
  return <div className={`h-2.5 w-2.5 rounded-full ${color}`} />;
}

function QualityRow({
  label,
  value,
  trend,
  testId,
}: {
  label: string;
  value: string;
  trend: string;
  testId: string;
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-card-border/50 last:border-0">
      <div className="flex items-center gap-2">
        <DotIndicator direction={trend} />
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold tabular-nums text-foreground" data-testid={testId}>{value}</span>
        <TrendIcon direction={trend} />
      </div>
    </div>
  );
}

export function BusinessQuality({ data }: BusinessQualityProps) {
  const bq = data.businessQuality;
  const fin = data.financials;

  // Determine debt trend
  const debtTrend = fin?.debtToEquity !== null
    ? (fin.debtToEquity < 50 ? "up" : fin.debtToEquity < 100 ? "flat" : "down")
    : "flat";

  // Payout trend
  const payoutTrend = fin?.payoutRatio !== null
    ? (fin.payoutRatio < 60 ? "up" : fin.payoutRatio < 85 ? "flat" : "down")
    : "flat";

  return (
    <div className="bg-card border border-card-border rounded-lg p-6" data-testid="business-quality">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4 flex items-center gap-2">
        <Briefcase className="h-4 w-4" />
        Business Quality
      </h3>

      <div className="space-y-0">
        <QualityRow
          label="Revenue Trend"
          value={bq?.revenueGrowth !== null ? formatPercent(bq.revenueGrowth) + " YoY" : "N/A"}
          trend={bq?.revenueTrend || "flat"}
          testId="text-revenue-trend"
        />
        <QualityRow
          label="EBITDA Margin"
          value={bq?.ebitdaMargin !== null ? formatPercent(bq.ebitdaMargin) : "N/A"}
          trend={bq?.ebitdaTrend || "flat"}
          testId="text-ebitda-margin"
        />
        <QualityRow
          label="Free Cash Flow"
          value={bq?.freeCashFlow !== null ? formatLargeNumber(bq.freeCashFlow) : "N/A"}
          trend={bq?.fcfTrend || "flat"}
          testId="text-fcf"
        />
        <QualityRow
          label="Debt / Equity"
          value={fin?.debtToEquity !== null ? formatNumber(fin.debtToEquity) + "%" : "N/A"}
          trend={debtTrend}
          testId="text-debt-equity"
        />
        <QualityRow
          label="Payout Ratio"
          value={fin?.payoutRatio !== null ? formatPercent(fin.payoutRatio) : "N/A"}
          trend={payoutTrend}
          testId="text-payout-ratio"
        />
      </div>
    </div>
  );
}
