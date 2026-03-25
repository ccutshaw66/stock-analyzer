import { useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, Lock, Eye, EyeOff, CheckCircle2 } from "lucide-react";
import iconUrl from "@/assets/icon.png";

export default function ResetPassword() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const token = new URLSearchParams(window.location.hash.split("?")[1] || "").get("token");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password !== confirm) { setError("Passwords do not match"); return; }
    if (password.length < 6) { setError("Password must be at least 6 characters"); return; }
    setLoading(true);
    try {
      const res = await apiRequest("POST", "/api/auth/reset-password", { token, newPassword: password });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error); }
      setSuccess(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ backgroundColor: '#040d22' }}>
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-3 mb-8">
          <img src={iconUrl} alt="Stock Otter" className="h-12 w-12 rounded-xl" />
        </div>

        {!token ? (
          <div className="text-center">
            <p className="text-sm text-destructive">Invalid or missing reset token.</p>
            <a href="/" className="text-xs text-primary hover:underline mt-3 inline-block">Back to Stock Otter</a>
          </div>
        ) : success ? (
          <div className="text-center">
            <CheckCircle2 className="h-12 w-12 text-green-400 mx-auto mb-4" />
            <h2 className="text-lg font-bold text-foreground mb-2">Password Reset</h2>
            <p className="text-sm text-muted-foreground mb-4">Your password has been changed. You can now sign in with your new password.</p>
            <a href="/" className="text-sm text-primary font-semibold hover:underline">Sign In</a>
          </div>
        ) : (
          <>
            <h1 className="text-xl font-bold text-foreground mb-1">Choose a new password</h1>
            <p className="text-sm text-muted-foreground mb-6">Enter your new password below.</p>

            {error && (
              <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3 mb-4 text-xs text-destructive">{error}</div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">New Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input type={showPassword ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)}
                    placeholder="At least 6 characters" required minLength={6}
                    className="w-full h-10 pl-10 pr-10 text-sm bg-background border border-card-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary" />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" tabIndex={-1}>
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Confirm Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input type={showPassword ? "text" : "password"} value={confirm} onChange={e => setConfirm(e.target.value)}
                    placeholder="Repeat your password" required
                    className="w-full h-10 pl-10 pr-3 text-sm bg-background border border-card-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary" />
                </div>
              </div>
              <button type="submit" disabled={loading}
                className="w-full h-10 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2 glow-button">
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                Reset Password
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
