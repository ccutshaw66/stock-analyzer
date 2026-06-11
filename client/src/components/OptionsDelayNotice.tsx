import { Clock } from "lucide-react";

/**
 * Fine-print notice for options-data pages (MM Exposure, gamma, etc.).
 *
 * Stock Otter's options data comes from Polygon's Options Starter plan, which is
 * 15-minute delayed. Greeks are computed in-house (Black-Scholes from the chain
 * prices), so the analytics are accurate — but the underlying option quotes are
 * delayed and the gamma snapshot is taken end-of-day. This notice keeps users
 * from mistaking it for a real-time execution feed.
 *
 * Matches the Disclaimer bar's muted style.
 */
export function OptionsDelayNotice() {
  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 bg-muted/30 border border-card-border rounded-lg text-micro text-muted-foreground"
      data-testid="options-delay-notice"
    >
      <Clock className="h-3 w-3 shrink-0 text-watch-light" />
      <span>
        <strong className="text-foreground/80">Options data is delayed</strong> — position pricing
        will update approximately every 15&nbsp;minutes.
      </span>
    </div>
  );
}
