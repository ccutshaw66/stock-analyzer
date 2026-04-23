import { useState } from "react";
import { Bell, CheckCheck, X } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Link } from "wouter";

interface AlertRow {
  id: number;
  kind: string;
  ticker: string | null;
  title: string;
  body: string;
  severity: "info" | "warn" | "critical";
  read: boolean;
  createdAt: string;
}

const SEV_COLOR: Record<string, string> = {
  info: "bg-blue-500/10 text-blue-400",
  warn: "bg-yellow-500/10 text-yellow-400",
  critical: "bg-red-500/10 text-red-400",
};

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function AlertsBell() {
  const [open, setOpen] = useState(false);
  const { data } = useQuery<{ alerts: AlertRow[]; unread: number }>({
    queryKey: ["/api/alerts"],
    queryFn: async () => (await apiRequest("GET", "/api/alerts?limit=30")).json(),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const markRead = useMutation({
    mutationFn: async (id: number) => (await apiRequest("POST", `/api/alerts/${id}/read`)).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/alerts"] }),
  });
  const readAll = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/alerts/read-all`)).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/alerts"] }),
  });
  const dismiss = useMutation({
    mutationFn: async (id: number) => (await apiRequest("POST", `/api/alerts/${id}/dismiss`)).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/alerts"] }),
  });

  const alerts = data?.alerts ?? [];
  const unread = data?.unread ?? 0;

  return (
    <div className="relative shrink-0">
      <button
        onClick={() => setOpen(v => !v)}
        className="relative p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
        aria-label="Alerts"
        data-testid="button-alerts-bell"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 w-[360px] max-h-[480px] bg-card border border-card-border rounded-xl shadow-lg z-50 flex flex-col">
            <div className="flex items-center justify-between px-3 py-2 border-b border-card-border">
              <span className="text-sm font-semibold text-foreground">Alerts</span>
              <div className="flex items-center gap-2">
                {unread > 0 && (
                  <button onClick={() => readAll.mutate()} className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
                    <CheckCheck className="h-3.5 w-3.5" /> Mark all read
                  </button>
                )}
                <Link href="/alerts">
                  <span className="text-[11px] text-primary hover:underline cursor-pointer" onClick={() => setOpen(false)}>Manage</span>
                </Link>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {alerts.length === 0 ? (
                <div className="px-4 py-10 text-center">
                  <Bell className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No alerts yet</p>
                  <Link href="/alerts">
                    <span className="text-[11px] text-primary hover:underline cursor-pointer" onClick={() => setOpen(false)}>Create your first rule</span>
                  </Link>
                </div>
              ) : (
                alerts.map(a => (
                  <div
                    key={a.id}
                    className={`group px-3 py-2.5 border-b border-card-border/50 flex gap-2 ${!a.read ? "bg-primary/5" : ""} hover:bg-muted/30 transition-colors`}
                    onClick={() => !a.read && markRead.mutate(a.id)}
                  >
                    <span className={`shrink-0 mt-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded ${SEV_COLOR[a.severity] || SEV_COLOR.info}`}>
                      {a.kind === "SCANNER_VERDICT" ? "SCAN" : a.kind === "PRICE_TARGET" ? "TGT" : a.kind === "PRICE_STOP" ? "STOP" : a.kind === "EARNINGS" ? "EARN" : a.kind}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs font-semibold text-foreground truncate">{a.title}</p>
                        <span className="text-[10px] text-muted-foreground shrink-0">{timeAgo(a.createdAt)}</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground line-clamp-2">{a.body}</p>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); dismiss.mutate(a.id); }}
                      className="opacity-0 group-hover:opacity-100 shrink-0 text-muted-foreground hover:text-foreground transition-opacity"
                      aria-label="Dismiss"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
