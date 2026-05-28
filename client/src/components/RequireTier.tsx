/**
 * RequireTier — React route-level tier gate.
 *
 * Wraps a page so Free users (or users below the required tier) see the
 * UpgradePrompt inline instead of the actual page content. Same role as
 * the backend `requireTier` middleware in `server/platform/tiers/middleware.ts`,
 * just for the client — without this, anyone typing the URL of a Pro/Elite
 * page directly bypasses the sidebar gate.
 *
 * Usage in App.tsx:
 *   <Route path="/tracker">
 *     <RequireTier min="pro" feature="Current Positions"
 *       description="Track open trades, P/L, and stops on the Pro plan.">
 *       <TradeTracker />
 *     </RequireTier>
 *   </Route>
 */
import type { ReactNode } from "react";
import { useSubscription } from "@/hooks/useSubscription";
import { UpgradePrompt } from "@/components/UpgradePrompt";
import { PageTemplate } from "@/components/PageTemplate";

type Tier = "free" | "pro" | "elite";

const RANK: Record<Tier, number> = { free: 0, pro: 1, elite: 2 };

interface RequireTierProps {
  min: Tier;
  feature: string;
  description: string;
  children: ReactNode;
}

export function RequireTier({ min, feature, description, children }: RequireTierProps) {
  const { tier } = useSubscription();
  const userTier = (tier ?? "free") as Tier;
  if (RANK[userTier] >= RANK[min]) {
    return <>{children}</>;
  }
  return (
    <PageTemplate
      className="max-w-3xl mx-auto px-3 sm:px-4 py-4 sm:py-6"
      title={feature}
    >
      <UpgradePrompt feature={feature} description={description} tier={min} />
    </PageTemplate>
  );
}
