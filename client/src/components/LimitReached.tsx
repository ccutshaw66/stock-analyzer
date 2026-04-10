import mascotUrl from "@/assets/mascot.jpg";
import { Zap } from "lucide-react";

interface LimitReachedProps {
  feature: string; // "Stock Analysis" | "Scanner" | "MM Exposure"
  message?: string;
}

/**
 * Full-page otter upgrade prompt when a free user has exhausted their daily limits.
 * Replaces the page content entirely — don't show stale cached data behind this.
 */
export function LimitReached({ feature, message }: LimitReachedProps) {
  const defaultMsg = feature === "MM Exposure"
    ? "Market Maker Exposure is available on Pro and Elite plans. See where the dealers are hiding — gamma exposure, call/put walls, and trade ideas."
    : `You've used all your free ${feature.toLowerCase()} for today. Upgrade to keep going — your daily limit resets at midnight.`;

  return (
    <div className="flex flex-col items-center justify-center py-12 text-center" data-testid="limit-reached">
      <img src={mascotUrl} alt="Stock Otter" className="h-44 w-auto mb-5 drop-shadow-lg" />
      <h2 className="text-xl font-bold text-foreground mb-2">
        {feature === "MM Exposure" ? "Pro Feature" : "Daily Limit Reached"}
      </h2>
      <p className="text-sm text-muted-foreground max-w-lg mb-2 leading-relaxed">
        {message || defaultMsg}
      </p>
      <p className="text-xs text-muted-foreground/50 mb-6">
        {feature !== "MM Exposure" && "Your limit resets at midnight. Or unlock everything right now."}
      </p>
      <div className="flex flex-col sm:flex-row items-center gap-3">
        <a
          href="/#/account"
          className="h-11 px-8 text-sm font-bold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors inline-flex items-center gap-2 shadow-lg shadow-primary/20"
        >
          <Zap className="h-4 w-4" /> Upgrade to Pro — $15/mo
        </a>
        <a
          href="/#/account"
          className="h-11 px-8 text-sm font-bold rounded-lg border border-card-border text-foreground hover:bg-muted/50 transition-colors inline-flex items-center gap-2"
        >
          Go Elite — $39/mo
        </a>
      </div>
    </div>
  );
}
