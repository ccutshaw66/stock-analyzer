import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import {
  AlertTriangle, Bell, Flag, Calendar, ListChecks, Loader2,
} from "lucide-react";

type Severity = "info" | "watch" | "warn" | "critical";
type Kind = "trade-alert" | "alert" | "htf-setup" | "earnings";

interface ActionItem {
  id: string;
  kind: Kind;
  symbol: string;
  severity: Severity;
  title: string;
  detail: string;
  actionLabel?: string;
  href: string;
  generatedAt: number;
}

const SEVERITY_STYLE: Record<Severity, { bar: string; badge: string; label: string }> = {
  critical: { bar: "bg-bear",        badge: "bg-bear/20 text-bear-light border-bear/40",        label: "CRITICAL" },
  warn:     { bar: "bg-watch",       badge: "bg-watch/20 text-watch-light border-watch/40",     label: "WARN" },
  watch:    { bar: "bg-brand-accent", badge: "bg-brand-accent/15 text-brand-accent border-brand-accent/40", label: "WATCH" },
  info:     { bar: "bg-muted",       badge: "bg-muted text-muted-foreground border-card-border", label: "INFO" },
};

const KIND_ICON: Record<Kind, typeof AlertTriangle> = {
  "trade-alert": AlertTriangle,
  "alert": Bell,
  "htf-setup": Flag,
  "earnings": Calendar,
};

export function ActionQueueWidget() {
  const [, navigate] = useLocation();
  const { data, isLoading, error } = useQuery<{ items: ActionItem[]; generatedAt: number }>({
    queryKey: ["/api/dashboard/action-queue"],
    queryFn: async () => (await apiRequest("GET", "/api/dashboard/action-queue")).json(),
    // 90s background poll. placeholderData = keepPrevious so refetches don't
    // blank the list mid-look — Chris's "keeps clearing" complaint.
    refetchInterval: 90 * 1000,
    staleTime: 60 * 1000,
    placeholderData: (prev) => prev,
    refetchOnWindowFocus: true,
  });

  if (isLoading) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Scanning for actions…
      </div>
    );
  }
  if (error) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-bear-light px-4 text-center">
        Couldn't build the action queue. Refresh in a moment.
      </div>
    );
  }
  const items = data?.items ?? [];
  if (items.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 text-center px-4 py-6">
        <ListChecks className="h-8 w-8 text-bull-light opacity-80" />
        <div className="text-sm font-semibold text-foreground">All clear today</div>
        <div className="text-xs text-muted-foreground max-w-xs">
          No positions need attention, no fresh setups in your window, no earnings approaching. Good morning.
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto" data-testid="action-queue">
      {/* Sticky so the header stays pinned when the list scrolls. Without
          sticky, the header rolls up with the items and you lose the "Action
          Queue · N items" context. */}
      <div className="sticky top-0 z-10 bg-card flex items-center justify-between px-3 py-2 border-b border-card-border">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider font-semibold text-muted-foreground">
          <ListChecks className="h-3.5 w-3.5" />
          Action Queue
        </div>
        <span className="text-micro text-muted-foreground tabular-nums">
          {items.length} item{items.length === 1 ? "" : "s"}
        </span>
      </div>
      <ul className="divide-y divide-card-border/50">
        {items.map(item => {
          const style = SEVERITY_STYLE[item.severity];
          const Icon = KIND_ICON[item.kind];
          return (
            <li
              key={item.id}
              onClick={() => navigate(item.href)}
              className="cursor-pointer hover:bg-muted/30 transition-colors"
              data-testid={`action-item-${item.id}`}
            >
              <div className="flex items-stretch gap-2">
                <div className={`w-1 ${style.bar} shrink-0`} />
                <div className="flex-1 min-w-0 py-2.5 pr-3">
                  <div className="flex items-center gap-2 mb-0.5">
                    <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-sm font-semibold text-foreground truncate">{item.title}</span>
                    <span className={`text-micro px-1.5 py-0.5 rounded border ${style.badge} ml-auto shrink-0`}>
                      {style.label}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground leading-snug">{item.detail}</div>
                  {item.actionLabel && (
                    <div className="text-micro text-brand-accent mt-1 font-medium">
                      → {item.actionLabel}
                    </div>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
