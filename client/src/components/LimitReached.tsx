import mascotUrl from "@/assets/mascot.jpg";
import { Zap, Check, X, Minus } from "lucide-react";

interface LimitReachedProps {
  feature: string;
  message?: string;
}

const COMPARISON = [
  { feature: "Stock Analyses / Day", free: "10", pro: "30", elite: "Unlimited" },
  { feature: "Scanner Scans / Day", free: "10", pro: "30", elite: "Unlimited" },
  { feature: "Trade Tracker", free: "20 trades", pro: "Unlimited", elite: "Unlimited" },
  { feature: "Market Maker Exposure", free: false, pro: true, elite: true },
  { feature: "Trade Analysis & Signals", free: true, pro: true, elite: true },
  { feature: "Verdict Scoring", free: true, pro: true, elite: true },
  { feature: "Dividend Finder & Strategy", free: true, pro: true, elite: true },
  { feature: "Payoff Diagrams & Greeks", free: true, pro: true, elite: true },
  { feature: "Institutional Flow Scanner", free: true, pro: true, elite: true },
  { feature: "Export Reports (CSV/PDF)", free: false, pro: false, elite: true },
  { feature: "Priority Data Speed", free: false, pro: false, elite: true },
];

function TierCell({ value }: { value: string | boolean }) {
  if (typeof value === "boolean") {
    return value
      ? <Check className="h-4 w-4 text-green-400 mx-auto" />
      : <X className="h-4 w-4 text-red-400/50 mx-auto" />;
  }
  return <span className="text-foreground font-semibold">{value}</span>;
}

export function LimitReached({ feature, message }: LimitReachedProps) {
  const defaultMsg = feature === "MM Exposure"
    ? "Market Maker Exposure is available on Pro and Elite plans. See where the dealers are hiding — gamma exposure, call/put walls, and trade ideas."
    : `You've used all your free ${feature.toLowerCase()} for today. Upgrade to keep going — your limit resets at midnight.`;

  return (
    <div className="flex flex-col items-center justify-center py-8 text-center" data-testid="limit-reached">
      <img src={mascotUrl} alt="Stock Otter" className="h-36 w-auto mb-4 drop-shadow-lg" />
      <h2 className="text-xl font-bold text-foreground mb-2">
        {feature === "MM Exposure" ? "Pro Feature" : "Daily Limit Reached"}
      </h2>
      <p className="text-sm text-muted-foreground max-w-lg mb-1 leading-relaxed">
        {message || defaultMsg}
      </p>
      <p className="text-xs text-muted-foreground/50 mb-6">
        {feature !== "MM Exposure" && "Your limit resets at midnight. Or unlock everything right now."}
      </p>

      {/* Upgrade buttons */}
      <div className="flex flex-col sm:flex-row items-center gap-3 mb-8">
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

      {/* Feature comparison table */}
      <div className="w-full max-w-xl bg-card border border-card-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-card-border bg-muted/20">
          <h3 className="text-sm font-bold text-foreground">What You Get</h3>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-card-border text-muted-foreground">
              <th className="text-left py-2.5 px-4 font-semibold">Feature</th>
              <th className="text-center py-2.5 px-2 font-semibold w-20">Free</th>
              <th className="text-center py-2.5 px-2 font-semibold w-20">
                <span className="text-primary">Pro</span>
                <span className="block text-[9px] text-muted-foreground">$15/mo</span>
              </th>
              <th className="text-center py-2.5 px-2 font-semibold w-20">
                <span className="text-yellow-400">Elite</span>
                <span className="block text-[9px] text-muted-foreground">$39/mo</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {COMPARISON.map((row, i) => (
              <tr key={i} className="border-b border-card-border/30 hover:bg-muted/20">
                <td className="py-2 px-4 text-muted-foreground">{row.feature}</td>
                <td className="py-2 px-2 text-center"><TierCell value={row.free} /></td>
                <td className="py-2 px-2 text-center"><TierCell value={row.pro} /></td>
                <td className="py-2 px-2 text-center"><TierCell value={row.elite} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
