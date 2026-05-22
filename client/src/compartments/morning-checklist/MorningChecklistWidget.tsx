import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { CheckCircle2, Circle, Flame, History, Loader2, X } from "lucide-react";

interface ChecklistItem {
  id: string;
  label: string;
  auto?: boolean;          // auto-checked from system state, no manual click
}

// Item order + reasoning lives in the dashboard's "How it works" block,
// not in per-item sub-labels — keeps the checklist UI clean and scannable.
const CHECKLIST_ITEMS: ChecklistItem[] = [
  { id: "regime", label: "Reviewed Market Pulse regime" },
  { id: "actions", label: "Reviewed Action Queue (open positions needing attention)" },
  { id: "earnings", label: "Reviewed earnings exposure (next 14 days)", auto: true },
  { id: "news", label: "Reviewed Position News for material developments" },
  { id: "triggers", label: "Reviewed dashboard for new overnight triggers" },
  { id: "loss-budget", label: "Within today's loss budget", auto: true },
];

interface TodayResponse {
  today: { date: string; items: Record<string, boolean>; focusNote: string | null; completedAt: string } | null;
  streak: number;
}

interface HistoryResponse {
  items: Array<{ date: string; items: Record<string, boolean>; focusNote: string | null; completedAt: string }>;
}

function todayDateIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function MorningChecklistWidget() {
  const queryClient = useQueryClient();
  const today = todayDateIso();
  const [items, setItems] = useState<Record<string, boolean>>({});
  const [focusNote, setFocusNote] = useState("");
  const [showHistory, setShowHistory] = useState(false);

  const { data: todayData, isLoading } = useQuery<TodayResponse>({
    queryKey: ["/api/dashboard/checklist/today"],
    queryFn: async () => (await apiRequest("GET", "/api/dashboard/checklist/today")).json(),
    staleTime: 60 * 1000,
  });

  const { data: historyData } = useQuery<HistoryResponse>({
    queryKey: ["/api/dashboard/checklist/history", 7],
    queryFn: async () => (await apiRequest("GET", "/api/dashboard/checklist/history?limit=7")).json(),
    enabled: showHistory,
    staleTime: 5 * 60 * 1000,
  });

  // Hydrate from server state when today's submission exists.
  useEffect(() => {
    if (todayData?.today) {
      setItems(todayData.today.items ?? {});
      setFocusNote(todayData.today.focusNote ?? "");
    }
  }, [todayData?.today]);

  const submit = useMutation({
    mutationFn: async () =>
      (
        await apiRequest("POST", "/api/dashboard/checklist/submit", {
          date: today,
          items,
          focusNote: focusNote.trim() || undefined,
        })
      ).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/checklist/today"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/checklist/history", 7] });
    },
  });

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading checklist…
      </div>
    );
  }

  const isDone = !!todayData?.today;
  const streak = todayData?.streak ?? 0;
  const checkedCount = Object.values(items).filter(Boolean).length;
  const manualCount = CHECKLIST_ITEMS.filter(i => !i.auto).length;

  function toggle(id: string) {
    setItems(s => ({ ...s, [id]: !s[id] }));
  }

  return (
    <div className="h-full overflow-y-auto" data-testid="morning-checklist">
      <div className="flex items-center justify-between px-3 py-2 border-b border-card-border">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider font-semibold text-muted-foreground">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Morning Checklist
        </div>
        <div className="flex items-center gap-2">
          {streak > 0 && (
            <span className="flex items-center gap-1 text-micro text-watch-light tabular-nums">
              <Flame className="h-3 w-3" />
              {streak}-day
            </span>
          )}
          <button
            onClick={() => setShowHistory(s => !s)}
            className="text-micro text-muted-foreground hover:text-foreground flex items-center gap-1"
            data-testid="checklist-history-toggle"
          >
            <History className="h-3 w-3" />
            7 days
          </button>
        </div>
      </div>

      {showHistory && (
        <div className="px-3 py-2 border-b border-card-border bg-muted/20">
          <div className="flex items-center justify-between mb-1">
            <span className="text-micro font-semibold uppercase tracking-wider text-muted-foreground">Last 7 days</span>
            <button onClick={() => setShowHistory(false)} className="text-muted-foreground hover:text-foreground">
              <X className="h-3 w-3" />
            </button>
          </div>
          {(historyData?.items ?? []).length === 0 ? (
            <div className="text-micro text-muted-foreground py-2">No prior entries.</div>
          ) : (
            <ul className="space-y-1.5">
              {(historyData?.items ?? []).map(h => (
                <li key={h.date} className="flex items-start gap-2 text-xs">
                  <span className="text-muted-foreground tabular-nums shrink-0">{h.date}</span>
                  <span className="text-foreground/80 italic flex-1 min-w-0 truncate">
                    {h.focusNote || <span className="text-muted-foreground/60">no focus note</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="px-3 py-2 space-y-1.5">
        {CHECKLIST_ITEMS.map(item => {
          const checked = item.auto || !!items[item.id]; // auto items show as checked
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => !item.auto && !isDone && toggle(item.id)}
              disabled={item.auto || isDone}
              className={`w-full text-left flex items-start gap-2 px-2 py-1.5 rounded transition-colors ${
                isDone || item.auto ? "" : "hover:bg-muted/30 cursor-pointer"
              }`}
              data-testid={`checklist-item-${item.id}`}
            >
              {checked ? (
                <CheckCircle2 className={`h-4 w-4 shrink-0 mt-0.5 ${item.auto ? "text-brand-accent" : "text-bull-light"}`} />
              ) : (
                <Circle className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground/40" />
              )}
              <div className="flex-1 min-w-0">
                <div className={`text-xs ${checked ? "text-foreground" : "text-muted-foreground"}`}>
                  {item.label}
                  {item.auto && (
                    <span className="ml-1.5 text-micro text-muted-foreground/60 italic">auto</span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="px-3 pb-2">
        <label className="block text-micro text-muted-foreground uppercase tracking-wider font-semibold mb-1">
          Today's focus
        </label>
        <textarea
          value={focusNote}
          onChange={e => setFocusNote(e.target.value)}
          disabled={isDone}
          placeholder="One sentence — what's the intention today?"
          rows={2}
          className="w-full text-xs px-2 py-1.5 rounded border border-card-border bg-background text-foreground placeholder:text-muted-foreground/50 disabled:opacity-60 disabled:cursor-not-allowed resize-none"
          data-testid="checklist-focus-note"
        />
      </div>

      <div className="px-3 pb-3">
        {isDone ? (
          <div className="text-center text-xs text-bull-light font-semibold py-1.5 bg-bull/10 border border-bull/30 rounded">
            ✓ Logged at {new Date(todayData!.today!.completedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </div>
        ) : (
          <button
            onClick={() => submit.mutate()}
            disabled={submit.isPending || checkedCount < manualCount}
            className="w-full text-xs font-semibold px-3 py-1.5 rounded bg-brand-accent text-white hover:bg-brand-accent-deep disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            data-testid="checklist-submit"
          >
            {submit.isPending ? "Logging…" : checkedCount < manualCount ? `Check ${manualCount - checkedCount} more to submit` : "Log today's checklist"}
          </button>
        )}
      </div>
    </div>
  );
}
