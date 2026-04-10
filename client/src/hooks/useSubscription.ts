import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

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

export function useSubscription() {
  const { data, isLoading } = useQuery<SubscriptionStatus>({
    queryKey: ["/api/subscription/status"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/subscription/status");
      return res.json();
    },
    staleTime: 60 * 1000, // refresh every minute
    refetchInterval: 60 * 1000,
  });

  return {
    tier: data?.tier || "free",
    limits: data?.limits,
    usage: data?.usage,
    isLoading,
    isAnalysisExhausted: data ? data.usage.analysisRemaining <= 0 && data.tier === "free" : false,
    isScanExhausted: data ? data.usage.scansRemaining <= 0 && data.tier === "free" : false,
    canAccessMM: data ? data.limits.mmExposure : false,
  };
}
