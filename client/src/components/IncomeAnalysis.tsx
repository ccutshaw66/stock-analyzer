import { DollarSign } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { getBadgeBgColor } from "@/lib/format";

interface IncomeAnalysisProps {
  data: any;
}

function IncomeRow({
  label,
  value,
  color,
  testId,
}: {
  label: string;
  value: string;
  color: string;
  testId: string;
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-card-border/50 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <Badge variant="outline" className={`text-xs font-semibold ${getBadgeBgColor(color)}`} data-testid={testId}>
        {value}
      </Badge>
    </div>
  );
}

export function IncomeAnalysis({ data }: IncomeAnalysisProps) {
  const ia = data.incomeAnalysis;

  return (
    <div className="bg-card border border-card-border rounded-lg p-6" data-testid="income-analysis">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4 flex items-center gap-2">
        <DollarSign className="h-4 w-4" />
        Income Analysis
      </h3>

      <div className="space-y-0">
        <IncomeRow
          label="Yield Attractiveness"
          value={ia?.yieldAttractiveness || "N/A"}
          color={ia?.yieldColor || "yellow"}
          testId="text-yield-attractiveness"
        />
        <IncomeRow
          label="Income Quality"
          value={ia?.incomeQuality || "N/A"}
          color={ia?.incomeQualityColor || "yellow"}
          testId="text-income-quality"
        />
        <IncomeRow
          label="Dividend Growth"
          value={ia?.dividendGrowth || "N/A"}
          color={ia?.dividendGrowthColor || "yellow"}
          testId="text-dividend-growth"
        />
        <IncomeRow
          label="Cut Risk"
          value={ia?.cutRisk || "N/A"}
          color={ia?.cutRiskColor || "yellow"}
          testId="text-cut-risk"
        />
      </div>
    </div>
  );
}
