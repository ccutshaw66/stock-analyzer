/**
 * /htf/:symbol — full-page HTF pattern chart.
 *
 * Reached by clicking a ticker on the /htf setups table. Shows the
 * `HtfPatternChart` (candles, volume, 20-MA, pole/flag/breakout markers,
 * target/stop/entry price lines) at full page size, plus a back link
 * to the setup list.
 */
import { Link, useRoute } from "wouter";
import { ChevronLeft } from "lucide-react";
import { HtfPatternChart } from "@/components/HtfPatternChart";
import { PageHeader } from "@/components/PageHeader";
import { Disclaimer } from "@/components/Disclaimer";
import { BrandedEmptyState } from "@/components/BrandedEmptyState";
import { AlertTriangle } from "lucide-react";

export default function HtfChartPage() {
  const [, params] = useRoute<{ symbol?: string }>("/htf/:symbol");
  const symbol = (params?.symbol ?? "").toUpperCase();

  if (!symbol) {
    return (
      <BrandedEmptyState
        icon={AlertTriangle}
        title="No symbol"
        description="The URL is missing a ticker — go back to the HTF setup list and click a row."
      />
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${symbol} — HTF Pattern`}
        subtitle="Pole / flag / breakout · target · stop · 20-MA trail"
        right={
          <Link
            href="/htf"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
            Back to setups
          </Link>
        }
      />
      <HtfPatternChart symbol={symbol} />
      <Disclaimer />
    </div>
  );
}
