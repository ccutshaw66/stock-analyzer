import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/contexts/AuthContext";
import { Shield, Trash2, Loader2, Users, TrendingUp, Star } from "lucide-react";
import { useState } from "react";

interface AdminUser {
  id: number;
  email: string;
  displayName: string | null;
  createdAt: string;
  tradeCount: number;
  favoriteCount: number;
}

export default function AdminPage() {
  const { user } = useAuth();
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  const { data: users = [], isLoading } = useQuery<AdminUser[]>({
    queryKey: ["/api/admin/users"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/users");
      if (!res.ok) throw new Error("Failed to fetch users");
      return res.json();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (userId: number) => {
      const res = await apiRequest("DELETE", `/api/admin/users/${userId}`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to delete user");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setDeleteConfirm(null);
    },
  });

  if (user?.email !== "awisper@me.com") {
    return (
      <div className="p-6 text-center">
        <Shield className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
        <h1 className="text-lg font-bold text-foreground">Access Denied</h1>
        <p className="text-sm text-muted-foreground mt-1">You don't have permission to view this page.</p>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-2">
        <Shield className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold text-foreground">Admin Panel</h1>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-card border border-card-border rounded-xl p-4 text-center">
          <Users className="h-5 w-5 text-primary mx-auto mb-1" />
          <div className="text-2xl font-bold text-foreground tabular-nums">{users.length}</div>
          <div className="text-[11px] text-muted-foreground">Total Users</div>
        </div>
        <div className="bg-card border border-card-border rounded-xl p-4 text-center">
          <TrendingUp className="h-5 w-5 text-primary mx-auto mb-1" />
          <div className="text-2xl font-bold text-foreground tabular-nums">{users.reduce((s, u) => s + u.tradeCount, 0)}</div>
          <div className="text-[11px] text-muted-foreground">Total Trades</div>
        </div>
        <div className="bg-card border border-card-border rounded-xl p-4 text-center">
          <Star className="h-5 w-5 text-primary mx-auto mb-1" />
          <div className="text-2xl font-bold text-foreground tabular-nums">{users.reduce((s, u) => s + u.favoriteCount, 0)}</div>
          <div className="text-[11px] text-muted-foreground">Total Favorites</div>
        </div>
      </div>

      {/* Users table */}
      <div className="bg-card border border-card-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-card-border">
          <h2 className="text-sm font-bold text-foreground">Users</h2>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center p-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-card-border text-left text-[11px] text-muted-foreground uppercase tracking-wider">
                  <th className="px-4 py-2">User</th>
                  <th className="px-4 py-2">Email</th>
                  <th className="px-4 py-2 text-center">Trades</th>
                  <th className="px-4 py-2 text-center">Favorites</th>
                  <th className="px-4 py-2">Joined</th>
                  <th className="px-4 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-card-border/50 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-2.5">
                      <span className="font-medium text-foreground">{u.displayName || "—"}</span>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground font-mono text-xs">{u.email}</td>
                    <td className="px-4 py-2.5 text-center tabular-nums">{u.tradeCount}</td>
                    <td className="px-4 py-2.5 text-center tabular-nums">{u.favoriteCount}</td>
                    <td className="px-4 py-2.5 text-muted-foreground text-xs">
                      {new Date(u.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {u.email === "awisper@me.com" ? (
                        <span className="text-[10px] text-muted-foreground">Admin</span>
                      ) : deleteConfirm === u.id ? (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => deleteMutation.mutate(u.id)}
                            disabled={deleteMutation.isPending}
                            className="text-xs text-red-400 hover:text-red-300 font-semibold"
                          >
                            {deleteMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Confirm"}
                          </button>
                          <button onClick={() => setDeleteConfirm(null)} className="text-xs text-muted-foreground hover:text-foreground">
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setDeleteConfirm(u.id)}
                          className="text-muted-foreground hover:text-red-400 transition-colors"
                        >
                          <Trash2 className="h-4 w-4" />
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
