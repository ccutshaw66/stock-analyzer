import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2, Mail, Lock, User, TrendingUp, ArrowLeft, Eye, EyeOff } from "lucide-react";
import iconUrl from "@/assets/icon.png";
import logoTextUrl from "@/assets/logo-text.png";

export default function AuthPage({ initialMode = "login", onBack }: { initialMode?: "login" | "register"; onBack?: () => void }) {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<"login" | "register">(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (mode === "login") {
        await login(email, password);
      } else {
        await register(email, password, displayName || undefined);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex" style={{ backgroundColor: '#040d22' }}>
      {/* Left side — Branding */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-center items-center p-12 relative overflow-hidden">
        {/* Mesh gradient background */}
        <div className="absolute inset-0" style={{
          background: 'radial-gradient(ellipse at 30% 40%, hsl(239 84% 67% / 0.12) 0%, transparent 60%), radial-gradient(ellipse at 70% 70%, hsl(270 70% 65% / 0.08) 0%, transparent 50%)',
        }} />

        <div className="relative z-10 max-w-md text-center space-y-8">
          <img src={iconUrl} alt="Stock Otter" className="h-32 w-32 mx-auto rounded-2xl" />
          <div>
            <img src={logoTextUrl} alt="Stock Otter" className="h-12 mx-auto" style={{ filter: 'brightness(1.1)' }} />
          </div>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Smart trading analysis powered by real-time data. Track institutional flows, analyze fundamentals, manage your trades, and make confident decisions.
          </p>

          <div className="grid grid-cols-2 gap-4 text-left">
            {[
              { icon: TrendingUp, label: "Unified Verdict Scoring" },
              { icon: TrendingUp, label: "Institutional Flow Tracking" },
              { icon: TrendingUp, label: "Options Calculators" },
              { icon: TrendingUp, label: "Trade Journal & Analytics" },
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                <item.icon className="h-3.5 w-3.5 text-primary shrink-0" />
                <span>{item.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right side — Auth Form */}
      <div className="flex-1 flex flex-col justify-center items-center p-6 sm:p-12">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center justify-center gap-3 mb-8">
            <img src={iconUrl} alt="Stock Otter" className="h-12 w-12 rounded-xl" />
            <img src={logoTextUrl} alt="Stock Otter" className="h-8" style={{ filter: 'brightness(1.1)' }} />
          </div>

          {onBack && (
            <button onClick={onBack} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-4" data-testid="button-back-to-landing">
              <ArrowLeft className="h-3.5 w-3.5" /> Back to Stock Otter
            </button>
          )}

          <h1 className="text-xl font-bold text-foreground mb-1">
            {mode === "login" ? "Welcome back" : "Create your account"}
          </h1>
          <p className="text-sm text-muted-foreground mb-6">
            {mode === "login"
              ? "Sign in to access your trading dashboard"
              : "Start analyzing stocks in under a minute"}
          </p>

          {error && (
            <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3 mb-4 text-xs text-destructive">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "register" && (
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Display Name</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    type="text"
                    value={displayName}
                    onChange={e => setDisplayName(e.target.value)}
                    placeholder="Your name"
                    required
                    className="w-full h-10 pl-10 pr-3 text-sm bg-background border border-card-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                    data-testid="input-display-name"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  className="w-full h-10 pl-10 pr-3 text-sm bg-background border border-card-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                  data-testid="input-email"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder={mode === "register" ? "At least 6 characters" : "Your password"}
                  required
                  minLength={mode === "register" ? 6 : undefined}
                  className="w-full h-10 pl-10 pr-10 text-sm bg-background border border-card-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                  data-testid="input-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {mode === "login" && (
                <button
                  type="button"
                  onClick={() => {/* Future: navigate to forgot password flow */}}
                  className="text-[11px] text-primary hover:underline mt-1.5 block ml-auto"
                >
                  Forgot password?
                </button>
              )}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full h-10 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2 glow-button"
              data-testid="button-submit-auth"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {mode === "login" ? "Sign In" : "Create Account"}
            </button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-xs text-muted-foreground">
              {mode === "login" ? "Don't have an account?" : "Already have an account?"}{" "}
              <button
                onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}
                className="text-primary font-semibold hover:underline"
                data-testid="button-toggle-auth-mode"
              >
                {mode === "login" ? "Sign up" : "Sign in"}
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
