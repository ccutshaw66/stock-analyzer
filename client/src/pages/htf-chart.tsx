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
import { HtfPatternChart } from "@/components/chart";
import { PageTemplate } from "@/components/PageTemplate";
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
    <PageTemplate
      title={`${symbol} — HTF Pattern`}
      subtitle="Pole / flag / breakout · target · stop · 20-MA trail"
      headerRight={
        <Link
          href="/htf"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to setups
        </Link>
      }
      howItWorksTitle="How to read this chart"
      howItWorks={
        <>
          <p>You're looking at the High Tight Flag pattern for {symbol}.</p>
          <ul className="list-disc list-inside space-y-0.5 marker:text-muted-foreground/60">
            <li><span className="font-semibold text-foreground">Pole start</span> marker — beginning of the 30%+ run-up</li>
            <li><span className="font-semibold text-foreground">Flag</span> marker — beginning of the tight consolidation</li>
            <li><span className="font-semibold text-foreground">Breakout</span> arrow — close that broke the flag high on volume</li>
            <li>Horizontal price lines for the suggested <span className="font-semibold text-foreground">entry</span>, <span className="font-semibold text-foreground">target</span>, and <span className="font-semibold text-foreground">stop</span></li>
            <li><span className="font-semibold text-foreground">20-day MA</span> overlay — suggested trail-stop line for the back 2/3 of the position after the partial</li>
          </ul>
          <p>Click <span className="font-semibold text-foreground">Back to setups</span> for the full scanner ruleset, position-sizing rules, and the Live / Watch / Filtered tabs.</p>
        </>
      }
    >
      <HtfPatternChart symbol={symbol} />
    </PageTemplate>
  );
}
