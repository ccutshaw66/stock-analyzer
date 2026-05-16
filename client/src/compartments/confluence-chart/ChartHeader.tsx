/**
 * Branded header for the Confluence Chart page.
 *
 * - Otter logo + "CONFLUENCE" wordmark on the left.
 * - Ticker symbol + company + spot price + day change in the middle.
 * - Timeframe segmented control + quick-jump chips on the right.
 *
 * Designed to match the visual bar: TradingView Pro look, Stock Otter accent.
 */
import { Link } from "wouter";
import { formatCurrency } from "@/lib/format";
import { Activity, ArrowUpRight } from "lucide-react";
import logoText from "@/assets/logo-text.png";

interface ChartHeaderProps {
  ticker: string | null;
  companyName?: string;
  spotPrice?: number | null;
  dayChangePct?: number | null;
}

export function ChartHeader({
  ticker,
  companyName,
  spotPrice,
  dayChangePct,
}: ChartHeaderProps) {
  const changeColor =
    dayChangePct == null
      ? "text-muted-foreground"
      : dayChangePct >= 0
      ? "text-green-500"
      : "text-red-500";

  return (
    <div className="sticky top-0 z-20 bg-card/95 backdrop-blur-sm border-b border-border" data-testid="confluence-chart-header">
      <div className="flex items-center justify-between gap-4 px-4 py-2.5">
        {/* Brand */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <img src={logoText} alt="Stock Otter" className="h-7" />
          <span className="hidden sm:inline-flex items-center gap-1 text-micro font-bold tracking-widest text-primary px-2 py-0.5 rounded bg-primary/10">
            <Activity className="h-3 w-3" />
            CONFLUENCE
          </span>
        </div>

        {/* Ticker info — center stack */}
        <div className="flex items-baseline gap-3 min-w-0 flex-1 justify-center">
          {ticker ? (
            <>
              <span className="font-mono font-bold text-lg text-foreground" data-testid="header-ticker">
                {ticker}
              </span>
              {companyName && (
                <span className="text-xs text-muted-foreground truncate max-w-[200px]">{companyName}</span>
              )}
              {spotPrice != null && (
                <span className="text-base font-semibold tabular-nums text-foreground">
                  {formatCurrency(spotPrice)}
                </span>
              )}
              {dayChangePct != null && (
                <span className={`text-xs font-semibold tabular-nums ${changeColor}`}>
                  {dayChangePct >= 0 ? "▲" : "▼"} {Math.abs(dayChangePct).toFixed(2)}%
                </span>
              )}
            </>
          ) : (
            <span className="text-sm text-muted-foreground">No ticker selected</span>
          )}
        </div>

        {/* Right side: jump-out chips. Timeframe is controlled by the
            global picker in the top nav bar (TimeframeContext). */}
        <div className="flex items-center gap-3 flex-shrink-0">
          {ticker && (
            <div className="hidden lg:flex items-center gap-1">
              <Link
                href="/profile"
                className="text-micro font-medium text-muted-foreground hover:text-foreground flex items-center gap-0.5 px-2 py-1 rounded hover:bg-muted/50"
              >
                Profile <ArrowUpRight className="h-3 w-3" />
              </Link>
              <Link
                href="/mm-exposure"
                className="text-micro font-medium text-muted-foreground hover:text-foreground flex items-center gap-0.5 px-2 py-1 rounded hover:bg-muted/50"
              >
                MM Exposure <ArrowUpRight className="h-3 w-3" />
              </Link>
              <Link
                href="/scanner"
                className="text-micro font-medium text-muted-foreground hover:text-foreground flex items-center gap-0.5 px-2 py-1 rounded hover:bg-muted/50"
              >
                Scanner <ArrowUpRight className="h-3 w-3" />
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
