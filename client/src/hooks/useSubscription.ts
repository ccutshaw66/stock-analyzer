import { useQuery } from "@tanstack/react-query";

interface SubscriptionStatus {
  tier: "free" | "pro" | "elite";
  limits: {
    scansPerDay: number;
    analysisPerDay: number;
    mmExposure: boolean;
    tradeLimit: number;
    exports: boolean;
  };
  usage: {
    scansUsed: number;
    scansRemaining: number;
    analysisUsed: number;
    analysisRemaining: number;
  };
}

const SAFE_DEFAULTS: SubscriptionStatus = {
  tier: "free",
  limits: { scansPerDay: 10, analysisPerDay: 10, mmExposure: false, tradeLimit: 20, exports: false },
  usage: { scansUsed: 0, scansRemaining: 10, analysisUsed: 0, analysisRemaining: 10 },
};

export function useSubscription() {
  const { data } = useQuery<SubscriptionStatus>({
    queryKey: ["/api/subscription/status"],
    queryFn: async () => {
      try {
        const res = await fetch("/api/subscription/status", { credentials: "include" });
        if (!res.ok) return SAFE_DEFAULTS;
        return await res.json();
      } catch {
        return SAFE_DEFAULTS;
      }
    },
    staleTime: 60 * 1000,
    refetchInterval: 2 * 60 * 1000, // every 2 min, not every 1 min
    retry: false,
    // CRITICAL: never throw — return defaults on any error
    placeholderData: SAFE_DEFAULTS,
  });

  const d = data || SAFE_DEFAULTS;

  return {
    tier: d.tier || "free",
    limits: d.limits || SAFE_DEFAULTS.limits,
    usage: d.usage || SAFE_DEFAULTS.usage,
    isLoading: false,
    isAnalysisExhausted: d.usage ? d.usage.analysisRemaining <= 0 && d.tier === "free" : false,
    isScanExhausted: d.usage ? d.usage.scansRemaining <= 0 && d.tier === "free" : false,
    canAccessMM: d.limits ? d.limits.mmExposure : false,
  };
}
