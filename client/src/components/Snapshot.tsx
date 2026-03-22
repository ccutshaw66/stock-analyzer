import { BarChart3 } from "lucide-react";
import { formatCurrency, formatLargeNumber, formatNumber, formatPercent, formatVolume } from "@/lib/format";

interface SnapshotProps {
  data: any;
}

function MetricRow({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="flex justify-between items-center py-2 border-b border-card-border/50 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold tabular-nums text-foreground" data-testid={testId}>{value}</span>
    </div>
  );
}

export function Snapshot({ data }: SnapshotProps) {
  const low = data.fiftyTwoWeekLow;
  const high = data.fiftyTwoWeekHigh;
  const price = data.price;
  const rangePosition = low && high && price
    ? Math.max(0, Math.min(100, ((price - low) / (high - low)) * 100))
    : 50;

  return (
    <div className="bg-card border border-card-border rounded-lg p-6" data-testid="snapshot">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4 flex items-center gap-2">
        <BarChart3 className="h-4 w-4" />
        Snapshot
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
        <div>
          <MetricRow label="Price" value={formatCurrency(data.price)} testId="text-snapshot-price" />
          <MetricRow label="Market Cap" value={formatLargeNumber(data.marketCap)} testId="text-market-cap" />
          <MetricRow label="Sector" value={data.sector || "N/A"} testId="text-sector" />
          <MetricRow label="P/E Ratio" value={data.pe ? formatNumber(data.pe) : "N/A"} testId="text-pe" />
        </div>
        <div>
          <MetricRow label="EPS" value={data.eps ? formatCurrency(data.eps) : "N/A"} testId="text-eps" />
          <MetricRow label="Dividend Yield" value={data.dividendYield ? formatPercent(data.dividendYield) : "N/A"} testId="text-div-yield" />
          <MetricRow label="Avg Volume" value={formatVolume(data.avgVolume)} testId="text-avg-volume" />
          <MetricRow label="Beta" value={data.beta ? formatNumber(data.beta) : "N/A"} testId="text-beta" />
        </div>
      </div>

      {/* 52-Week Range Bar */}
      {low && high && (
        <div className="mt-4 pt-4 border-t border-card-border/50">
          <div className="flex justify-between text-xs text-muted-foreground mb-2">
            <span>52-Week Range</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">{formatCurrency(low)}</span>
            <div className="relative flex-1 h-2 bg-muted rounded-full">
              <div
                className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-primary rounded-full border-2 border-background shadow-sm"
                style={{ left: `calc(${rangePosition}% - 6px)` }}
                data-testid="range-indicator"
              />
              <div
                className="absolute inset-y-0 left-0 bg-primary/20 rounded-full"
                style={{ width: `${rangePosition}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">{formatCurrency(high)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
