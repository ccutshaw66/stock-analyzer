import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/contexts/AuthContext";
import {
  Shield, Trash2, Loader2, Users, Crown, Zap, Activity,
  Server, Database, Clock, MemoryStick, RefreshCw, ChevronDown,
  CheckCircle2, XCircle, Search, CreditCard, ShieldCheck
} from "lucide-react";
import { useState } from "react";

// ─── Types ──────────────────────────────────────────────────────────────────

interface AdminUser {
  id: number;
  email: string;
  displayName: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  tier: string;
  isAdmin: boolean;
  stripeCustomerId: string | null;
  subscriptionExpiresAt: string | null;
  usage: {
    scansUsed: number;
    scansLimit: number;
    analysisUsed: number;
    analysisLimit: number;
  };
}

interface SystemStats {
  users: { total: number; free: number; pro: number; elite: number; activeToday: number; activeThisWeek: number };
  system: { uptime: string; uptimeSeconds: number; memoryMB: number; memoryMaxMB: number; nodeVersion: string };
  cache: { size: number; keys: number };
  queue: { active: number; waiting: number; maxConcurrent: number; totalProcessed: number; cacheHits: number; circuitOpen: boolean };
}

const TIER_COLORS: Record<string, { bg: string; text: string; ring: string }> = {
  free: { bg: "bg-zinc-500/10", text: "text-zinc-400", ring: "ring-zinc-500/30" },
  pro: { bg: "bg-blue-500/10", text: "text-blue-400", ring: "ring-blue-500/30" },
  elite: { bg: "bg-amber-500/10", text: "text-amber-400", ring: "ring-amber-500/30" },
};

const ADMIN_EMAILS = ["awisper@me.com", "christopher.cutshaw@gmail.com", "admin@stockotter.ai"];

// ─── Tier Badge ─────────────────────────────────────────────────────────────

function TierBadge({ tier }: { tier: string }) {
  const colors = TIER_COLORS[tier] || TIER_COLORS.free;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${colors.bg} ${colors.text} ring-1 ${colors.ring}`}>
      {tier === "elite" && <Crown className="h-2.5 w-2.5" />}
      {tier === "pro" && <Zap className="h-2.5 w-2.5" />}
      {tier}
    </span>
  );
}

// ─── Tier Dropdown ──────────────────────────────────────────────────────────

function TierDropdown({ user, onUpdate, isPending }: { user: AdminUser; onUpdate: (userId: number, tier: string) => void; isPending: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative" data-testid={`tier-dropdown-${user.id}`}>
      <button
        onClick={() => setOpen(!open)}
        disabled={isPending}
        className="flex items-center gap-1 hover:opacity-80 transition-opacity"
      >
        <TierBadge tier={user.tier} />
        <ChevronDown className="h-3 w-3 text-muted-foreground" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 bg-card border border-card-border rounded-lg shadow-xl py-1 min-w-[100px]">
            {["free", "pro", "elite"].map((t) => (
              <button
                key={t}
                onClick={() => { onUpdate(user.id, t); setOpen(false); }}
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-muted/50 transition-colors flex items-center gap-2
                  ${user.tier === t ? "text-primary font-bold" : "text-foreground"}`}
              >
                {user.tier === t && <CheckCircle2 className="h-3 w-3" />}
                <span className="uppercase font-semibold">{t}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Relative Time ──────────────────────────────────────────────────────────

function relativeTime(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const ms = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ─── KPI Card ───────────────────────────────────────────────────────────────

function KpiCard({ icon: Icon, label, value, sub, color = "text-primary" }: {
  icon: React.ElementType; label: string; value: string | number; sub?: string; color?: string;
}) {
  return (
    <div className="bg-card border border-card-border rounded-xl p-4" data-testid={`kpi-${label.toLowerCase().replace(/\s/g, "-")}`}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`h-4 w-4 ${color}`} />
        <span className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">{label}</span>
      </div>
      <div className="text-2xl font-bold text-foreground tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

// ─── Usage Bar ──────────────────────────────────────────────────────────────

function UsageBar({ used, limit, label }: { used: number; limit: number; label: string }) {
  const pct = limit === Infinity || limit === 0 ? 0 : Math.min(100, (used / limit) * 100);
  const isUnlimited = limit >= 9999;
  return (
    <div className="flex items-center gap-2 text-[10px]">
      <span className="text-muted-foreground w-12 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-muted/30 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${pct > 80 ? "bg-red-400" : pct > 50 ? "bg-amber-400" : "bg-primary"}`}
          style={{ width: isUnlimited ? "0%" : `${pct}%` }}
        />
      </div>
      <span className="text-muted-foreground tabular-nums w-16 text-right shrink-0">
        {isUnlimited ? `${used} / ∞` : `${used} / ${limit}`}
      </span>
    </div>
  );
}

// ─── Main Admin Page ────────────────────────────────────────────────────────

export default function AdminPage() {
  const { user } = useAuth();
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Check admin access
  const isAdmin = user && ADMIN_EMAILS.includes(user.email);

  // Queries
  const { data: users = [], isLoading: usersLoading, dataUpdatedAt } = useQuery<AdminUser[]>({
    queryKey: ["/api/admin/users"],
    enabled: !!isAdmin,
    refetchInterval: 30000, // Auto-refresh every 30s
  });

  const { data: stats } = useQuery<SystemStats>({
    queryKey: ["/api/admin/stats"],
    enabled: !!isAdmin,
    refetchInterval: 15000, // Every 15s for system health
  });

  // Mutations
  const tierMutation = useMutation({
    mutationFn: async ({ userId, tier }: { userId: number; tier: string }) => {
      const res = await apiRequest("PATCH", `/api/admin/users/${userId}/tier`, { tier });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (userId: number) => {
      const res = await apiRequest("DELETE", `/api/admin/users/${userId}`);
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] }); setDeleteConfirm(null); },
  });

  const clearCacheMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("GET", "/api/admin/cache?clear=true");
      if (!res.ok) throw new Error("Failed to clear cache");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] }),
  });

  if (!isAdmin) {
    return (
      <div className="p-6 text-center">
        <Shield className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
        <h1 className="text-lg font-bold text-foreground">Access Denied</h1>
        <p className="text-sm text-muted-foreground mt-1">Admin privileges required.</p>
      </div>
    );
  }

  // Filter users
  const filteredUsers = users.filter((u) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return u.email.toLowerCase().includes(q)
      || (u.displayName || "").toLowerCase().includes(q)
      || u.tier.toLowerCase().includes(q);
  });

  const paidUsers = users.filter(u => u.tier === "pro" || u.tier === "elite").length;

  return (
    <div className="max-w-6xl mx-auto px-3 sm:px-4 py-4 sm:py-6 space-y-6" data-testid="admin-page">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold text-foreground">Admin</h1>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          {dataUpdatedAt > 0 && (
            <span>Updated {relativeTime(new Date(dataUpdatedAt).toISOString())}</span>
          )}
          <button
            onClick={() => {
              queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
              queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
            }}
            className="p-1.5 rounded-md hover:bg-muted/50 transition-colors"
            data-testid="refresh-btn"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard icon={Users} label="Total Users" value={stats?.users.total ?? users.length} sub={`${paidUsers} paid`} />
        <KpiCard icon={Activity} label="Active Today" value={stats?.users.activeToday ?? 0} sub={`${stats?.users.activeThisWeek ?? 0} this week`} color="text-green-400" />
        <KpiCard icon={Crown} label="Elite" value={stats?.users.elite ?? 0} color="text-amber-400" />
        <KpiCard icon={Zap} label="Pro" value={stats?.users.pro ?? 0} color="text-blue-400" />
        <KpiCard icon={Server} label="Uptime" value={stats?.system.uptime ?? "—"} sub={`Memory: ${stats?.system.memoryMB ?? 0}MB`} color="text-emerald-400" />
        <KpiCard
          icon={Database}
          label="Cache"
          value={stats?.cache.size ?? 0}
          sub={`Queue: ${stats?.queue.active ?? 0} active, ${stats?.queue.waiting ?? 0} waiting`}
          color={stats?.queue.circuitOpen ? "text-red-400" : "text-cyan-400"}
        />
      </div>

      {/* System Health Bar */}
      {stats && (
        <div className="bg-card border border-card-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-foreground">System Health</h2>
            <div className="flex items-center gap-3">
              {stats.queue.circuitOpen ? (
                <span className="flex items-center gap-1 text-[10px] text-red-400 font-semibold">
                  <XCircle className="h-3 w-3" /> Circuit Breaker OPEN
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[10px] text-green-400 font-semibold">
                  <CheckCircle2 className="h-3 w-3" /> All Systems Normal
                </span>
              )}
              <button
                onClick={() => clearCacheMutation.mutate()}
                disabled={clearCacheMutation.isPending}
                className="text-[10px] text-muted-foreground hover:text-foreground border border-card-border rounded px-2 py-1 hover:bg-muted/30 transition-colors"
                data-testid="clear-cache-btn"
              >
                {clearCacheMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Clear Cache"}
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
            <div>
              <div className="text-muted-foreground mb-1">Yahoo Queue</div>
              <div className="font-mono text-foreground">{stats.queue.active}/{stats.queue.maxConcurrent} active</div>
              <div className="text-muted-foreground/70">{stats.queue.totalProcessed.toLocaleString()} total reqs</div>
            </div>
            <div>
              <div className="text-muted-foreground mb-1">Cache Hits</div>
              <div className="font-mono text-foreground">{stats.queue.cacheHits.toLocaleString()}</div>
              <div className="text-muted-foreground/70">{stats.cache.size} entries cached</div>
            </div>
            <div>
              <div className="text-muted-foreground mb-1">Memory</div>
              <div className="font-mono text-foreground">{stats.system.memoryMB}MB / {stats.system.memoryMaxMB}MB</div>
              <div className="text-muted-foreground/70">Node {stats.system.nodeVersion}</div>
            </div>
            <div>
              <div className="text-muted-foreground mb-1">Uptime</div>
              <div className="font-mono text-foreground">{stats.system.uptime}</div>
              <div className="text-muted-foreground/70">{Math.round(stats.system.uptimeSeconds / 3600)}h total</div>
            </div>
          </div>
        </div>
      )}

      {/* Users Table */}
      <div className="bg-card border border-card-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-card-border flex items-center justify-between gap-3">
          <h2 className="text-sm font-bold text-foreground shrink-0">Users ({filteredUsers.length})</h2>
          <div className="relative max-w-xs w-full">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search users..."
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-background border border-card-border rounded-lg text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
              data-testid="user-search"
            />
          </div>
        </div>

        {usersLoading ? (
          <div className="flex items-center justify-center p-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="users-table">
              <thead>
                <tr className="border-b border-card-border text-left text-[10px] text-muted-foreground uppercase tracking-wider">
                  <th className="px-4 py-2.5">User</th>
                  <th className="px-4 py-2.5">Tier</th>
                  <th className="px-4 py-2.5">Today's Usage</th>
                  <th className="px-4 py-2.5">Last Active</th>
                  <th className="px-4 py-2.5">Joined</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((u) => (
                  <tr
                    key={u.id}
                    className="border-b border-card-border/50 hover:bg-muted/20 transition-colors"
                    data-testid={`user-row-${u.id}`}
                  >
                    {/* User */}
                    <td className="px-4 py-3">
                      <div className="flex flex-col">
                        <span className="font-medium text-foreground text-xs">{u.displayName || "—"}</span>
                        <span className="text-muted-foreground font-mono text-[10px]">{u.email}</span>
                      </div>
                    </td>

                    {/* Tier dropdown */}
                    <td className="px-4 py-3">
                      <TierDropdown
                        user={u}
                        onUpdate={(id, tier) => tierMutation.mutate({ userId: id, tier })}
                        isPending={tierMutation.isPending}
                      />
                    </td>

                    {/* Usage */}
                    <td className="px-4 py-3 min-w-[180px]">
                      <div className="space-y-1">
                        <UsageBar used={u.usage.scansUsed} limit={u.usage.scansLimit} label="Scans" />
                        <UsageBar used={u.usage.analysisUsed} limit={u.usage.analysisLimit} label="Analysis" />
                      </div>
                    </td>

                    {/* Last Active */}
                    <td className="px-4 py-3">
                      <span className={`text-xs ${u.lastLoginAt && (Date.now() - new Date(u.lastLoginAt).getTime()) < 24 * 60 * 60 * 1000 ? "text-green-400" : "text-muted-foreground"}`}>
                        {relativeTime(u.lastLoginAt)}
                      </span>
                    </td>

                    {/* Joined */}
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {new Date(u.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </td>

                    {/* Status badges */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {u.isAdmin && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-primary/10 text-primary ring-1 ring-primary/20">
                            <ShieldCheck className="h-2.5 w-2.5" /> ADMIN
                          </span>
                        )}
                        {u.stripeCustomerId && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-green-500/10 text-green-400 ring-1 ring-green-500/20">
                            <CreditCard className="h-2.5 w-2.5" /> STRIPE
                          </span>
                        )}
                        {u.email === "ottertrader@stockotter.ai" && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-500/10 text-purple-400 ring-1 ring-purple-500/20">
                            DEMO
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3 text-right">
                      {u.isAdmin || u.email === "ottertrader@stockotter.ai" ? (
                        <span className="text-[10px] text-muted-foreground/50">Protected</span>
                      ) : deleteConfirm === u.id ? (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => deleteMutation.mutate(u.id)}
                            disabled={deleteMutation.isPending}
                            className="text-[10px] text-red-400 hover:text-red-300 font-bold"
                            data-testid={`confirm-delete-${u.id}`}
                          >
                            {deleteMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Confirm"}
                          </button>
                          <button onClick={() => setDeleteConfirm(null)} className="text-[10px] text-muted-foreground hover:text-foreground">
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setDeleteConfirm(u.id)}
                          className="text-muted-foreground/50 hover:text-red-400 transition-colors"
                          data-testid={`delete-user-${u.id}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
