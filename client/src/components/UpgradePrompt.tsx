import { Shield, Zap } from "lucide-react";

interface UpgradePromptProps {
  feature: string;
  description: string;
  tier?: string; // "pro" or "elite"
}

export function UpgradePrompt({ feature, description, tier = "pro" }: UpgradePromptProps) {
  const price = tier === "elite" ? "$39" : "$15";
  const label = tier === "elite" ? "Elite" : "Pro";

  return (
    <div className="flex flex-col items-center justify-center py-12 text-center bg-card border border-primary/30 rounded-lg" data-testid="upgrade-prompt">
      <Shield className="h-10 w-10 text-primary/40 mb-3" />
      <h3 className="text-base font-bold text-foreground mb-1">{feature}</h3>
      <p className="text-sm text-muted-foreground max-w-md mb-4">{description}</p>
      <a
        href="/#/account"
        className="h-9 px-5 text-sm font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors inline-flex items-center gap-1.5"
      >
        <Zap className="h-3.5 w-3.5" /> Upgrade to {label} — {price}/mo
      </a>
    </div>
  );
}

/** Check if an error message indicates a tier/upgrade restriction */
export function isUpgradeError(error: any): boolean {
  const msg = error?.message || String(error || "");
  return msg.includes("403") || msg.includes("Upgrade") || msg.includes("upgrade") || msg.includes("limit reached") || msg.includes("requires a Pro");
}

/** Extract a clean error message from API errors */
export function cleanErrorMessage(error: any): string {
  const msg = error?.message || String(error || "");
  try {
    const jsonMatch = msg.match(/\{.*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return parsed.error || msg;
    }
  } catch {}
  return msg.replace(/^\d+:\s*/, "").trim();
}
