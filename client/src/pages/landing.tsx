import { useState, useEffect } from "react";
import iconUrl from "@/assets/icon.png";
import logoTextUrl from "@/assets/logo-text.png";
import {
  Shield,
  Building2,
  Calculator,
  ClipboardList,
  Grid3X3,
  Zap,
  Check,
  Minus,
  TrendingUp,
  ArrowRight,
  ChevronRight,
  BarChart3,
  Search,
  Target,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface LandingPageProps {
  onLogin: () => void;
  onRegister: () => void;
}

// ─── Landing Page ────────────────────────────────────────────────────────────

export default function LandingPage({ onLogin, onRegister }: LandingPageProps) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div
      className="min-h-screen text-foreground"
      style={{ backgroundColor: "#040d22", scrollBehavior: "smooth" }}
    >
      {/* ─── Navigation ──────────────────────────────────────────────── */}
      <nav
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
          scrolled
            ? "bg-[#040d22]/80 backdrop-blur-xl border-b border-[#1E2235]/60"
            : "bg-transparent"
        }`}
        data-testid="landing-nav"
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img src={iconUrl} alt="" className="h-8 w-8 rounded-lg" />
            <img src={logoTextUrl} alt="Stock Otter" className="h-6 w-auto" />
          </div>

          <div className="hidden md:flex items-center gap-8">
            <button
              onClick={() => scrollTo("features")}
              className="text-sm text-[#8b8fa3] hover:text-white transition-colors"
              data-testid="nav-features"
            >
              Features
            </button>
            <button
              onClick={() => scrollTo("pricing")}
              className="text-sm text-[#8b8fa3] hover:text-white transition-colors"
              data-testid="nav-pricing"
            >
              Pricing
            </button>
            <button
              onClick={onLogin}
              className="text-sm text-[#8b8fa3] hover:text-white transition-colors"
              data-testid="nav-login"
            >
              Log In
            </button>
            <button
              onClick={onRegister}
              className="h-9 px-5 text-sm font-semibold rounded-lg bg-[#6366F1] text-white hover:bg-[#5558e6] transition-colors glow-button"
              data-testid="nav-get-started"
            >
              Get Started Free
            </button>
          </div>

          {/* Mobile nav */}
          <div className="flex md:hidden items-center gap-3">
            <button
              onClick={onLogin}
              className="text-sm text-[#8b8fa3] hover:text-white"
              data-testid="nav-login-mobile"
            >
              Log In
            </button>
            <button
              onClick={onRegister}
              className="h-8 px-4 text-xs font-semibold rounded-lg bg-[#6366F1] text-white"
              data-testid="nav-get-started-mobile"
            >
              Get Started
            </button>
          </div>
        </div>
      </nav>

      {/* ─── Hero ────────────────────────────────────────────────────── */}
      <section className="relative pt-32 pb-20 md:pt-40 md:pb-28 overflow-hidden">
        {/* Mesh gradient background */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 60% 50% at 50% 30%, rgba(99,102,241,0.12) 0%, transparent 70%), radial-gradient(ellipse 40% 40% at 70% 60%, rgba(139,92,246,0.08) 0%, transparent 60%)",
          }}
        />

        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 text-center">
          <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight text-white leading-[1.1] mb-6">
            Trade Smarter,
            <br />
            <span className="gradient-text">Not Harder</span>
          </h1>
          <p className="text-base sm:text-lg text-[#8b8fa3] max-w-2xl mx-auto mb-10 leading-relaxed">
            The all-in-one trading analysis platform. Real-time verdicts,
            institutional flow tracking, options calculators, and a professional
            trade journal — everything you need in one place.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-16">
            <button
              onClick={onRegister}
              className="h-12 px-8 text-sm font-semibold rounded-xl bg-[#6366F1] text-white hover:bg-[#5558e6] transition-all glow-button flex items-center justify-center gap-2"
              data-testid="hero-cta-primary"
            >
              Start Free Trial
              <ArrowRight className="h-4 w-4" />
            </button>
            <button
              onClick={() => scrollTo("how-it-works")}
              className="h-12 px-8 text-sm font-semibold rounded-xl border border-[#2a2f45] text-[#c4c7d4] hover:border-[#6366F1]/50 hover:text-white transition-all flex items-center justify-center gap-2"
              data-testid="hero-cta-secondary"
            >
              See How It Works
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {/* App preview card */}
          <div className="max-w-xl mx-auto" data-testid="hero-preview-card">
            <div className="bg-[#0c1225] border border-[#1E2235] rounded-2xl p-6 shadow-2xl">
              {/* Title bar */}
              <div className="flex items-center gap-2 mb-5">
                <div className="flex gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-[#ef4444]/60" />
                  <div className="w-2.5 h-2.5 rounded-full bg-[#eab308]/60" />
                  <div className="w-2.5 h-2.5 rounded-full bg-[#22c55e]/60" />
                </div>
                <span className="text-[10px] text-[#4a4f65] font-mono ml-2">
                  AAPL — Apple Inc.
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-[#141829] border border-[#1E2235] rounded-xl p-4 text-center">
                  <div className="text-[10px] font-semibold text-[#6b7084] uppercase tracking-wider mb-1">
                    Score
                  </div>
                  <div className="text-2xl font-bold text-white font-mono tabular-nums">
                    78
                  </div>
                  <div className="text-[10px] text-[#22c55e] font-semibold mt-0.5">
                    / 100
                  </div>
                </div>
                <div className="bg-[#141829] border border-[#1E2235] rounded-xl p-4 text-center">
                  <div className="text-[10px] font-semibold text-[#6b7084] uppercase tracking-wider mb-1">
                    Verdict
                  </div>
                  <div className="text-sm font-bold text-[#22c55e] mt-1">
                    STRONG
                  </div>
                  <div className="text-sm font-bold text-[#22c55e]">BUY</div>
                </div>
                <div className="bg-[#141829] border border-[#1E2235] rounded-xl p-4 text-center">
                  <div className="text-[10px] font-semibold text-[#6b7084] uppercase tracking-wider mb-1">
                    Win Rate
                  </div>
                  <div className="text-2xl font-bold text-[#6366F1] font-mono tabular-nums">
                    62%
                  </div>
                  <div className="text-[10px] text-[#6b7084] font-semibold mt-0.5">
                    last 30 trades
                  </div>
                </div>
              </div>

              {/* Mini chart placeholder */}
              <div className="mt-4 h-16 bg-[#141829] border border-[#1E2235] rounded-lg flex items-end px-3 pb-2 gap-[3px] overflow-hidden">
                {[28, 32, 30, 35, 38, 36, 42, 40, 45, 48, 44, 50, 52, 48, 55, 58, 54, 60, 62, 58, 65, 68, 72, 70, 75].map(
                  (v, i) => (
                    <div
                      key={i}
                      className="flex-1 rounded-sm"
                      style={{
                        height: `${v}%`,
                        backgroundColor:
                          i >= 20
                            ? "rgba(99,102,241,0.7)"
                            : "rgba(99,102,241,0.3)",
                      }}
                    />
                  )
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Features ────────────────────────────────────────────────── */}
      <section id="features" className="py-20 md:py-28 relative">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
              Everything You Need to Trade with Confidence
            </h2>
            <p className="text-[#8b8fa3] text-base max-w-xl mx-auto">
              One platform with all the tools serious traders use — no more
              juggling five different apps.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            <FeatureCard
              icon={Shield}
              title="Unified Verdict System"
              description="Get a 0-100 score combining fundamentals, institutional flow, stress resilience, and insider confidence into one clear verdict."
            />
            <FeatureCard
              icon={Building2}
              title="Institutional Flow Tracking"
              description="See where the smart money is going. Track institutional buying/selling patterns and insider transactions in real-time."
            />
            <FeatureCard
              icon={Calculator}
              title="Options Calculators"
              description="Risk calculator, payoff diagrams, Greeks calculator, Kelly Criterion — everything for sizing and evaluating trades."
            />
            <FeatureCard
              icon={ClipboardList}
              title="Professional Trade Journal"
              description="Track every trade with automatic P/L, behavioral analysis, win rate tracking, and performance analytics."
            />
            <FeatureCard
              icon={Grid3X3}
              title="Sector Heatmap"
              description="Visualize which sectors are hot or cold across multiple timeframes. Spot rotation before the crowd."
            />
            <FeatureCard
              icon={Zap}
              title="Strategy Signals"
              description="Three proven strategies (BBTC, VER, AMC) scan for entry signals with confluence-based confidence scoring."
            />
          </div>
        </div>
      </section>

      {/* ─── How It Works ────────────────────────────────────────────── */}
      <section id="how-it-works" className="py-20 md:py-28 relative">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 50% 40% at 30% 50%, rgba(99,102,241,0.06) 0%, transparent 70%)",
          }}
        />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
              Get Started in 3 Steps
            </h2>
            <p className="text-[#8b8fa3] text-base max-w-md mx-auto">
              From search to trade in under a minute.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <StepCard
              step={1}
              icon={Search}
              title="Search Any Ticker"
              description="Type a symbol and get instant analysis across 8 fundamental categories with real-time data."
            />
            <StepCard
              step={2}
              icon={Target}
              title="Get Your Verdict"
              description="Our unified scoring system combines 5 weighted factors into a clear buy/hold/avoid signal."
            />
            <StepCard
              step={3}
              icon={BarChart3}
              title="Track & Improve"
              description="Log trades, analyze performance, and use calculators to optimize your position sizing."
            />
          </div>
        </div>
      </section>

      {/* ─── Pricing ─────────────────────────────────────────────────── */}
      <section id="pricing" className="py-20 md:py-28 relative">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
              Simple, Transparent Pricing
            </h2>
            <p className="text-[#8b8fa3] text-base max-w-md mx-auto">
              Start free. Upgrade when you're ready.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
            <PricingCard
              name="Free"
              price="$0"
              period="/month"
              description="Everything you need to get started"
              features={[
                { text: "3 stock analyses per day", included: true },
                { text: "1 verdict report per day", included: true },
                { text: "All calculators", included: true },
                { text: "10 trades in journal", included: true },
                { text: "Sector heatmap", included: false },
                { text: "Earnings calendar", included: false },
              ]}
              cta="Get Started Free"
              onCta={onRegister}
              highlighted={false}
            />
            <PricingCard
              name="Pro"
              price="$15"
              period="/month"
              description="For active traders who want more"
              features={[
                { text: "Unlimited stock analyses", included: true },
                { text: "10 verdict reports per day", included: true },
                { text: "All calculators", included: true },
                { text: "100 trades in journal", included: true },
                { text: "Sector heatmap (all timeframes)", included: true },
                { text: "Earnings calendar", included: true },
              ]}
              cta="Start Pro Trial"
              onCta={onRegister}
              highlighted={true}
              badge="Most Popular"
            />
            <PricingCard
              name="Elite"
              price="$39"
              period="/month"
              description="For serious traders who want it all"
              features={[
                { text: "Everything in Basic", included: true },
                { text: "Unlimited verdicts", included: true },
                { text: "Unlimited trades", included: true },
                { text: "Full MFE/MAE analytics", included: true },
                { text: "Priority data speed", included: true },
                { text: "Export reports (CSV + PDF)", included: true },
              ]}
              cta="Start Elite Trial"
              onCta={onRegister}
              highlighted={false}
            />
          </div>
        </div>
      </section>

      {/* ─── Footer ──────────────────────────────────────────────────── */}
      <footer className="border-t border-[#1E2235] py-12">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-2.5">
              <img src={iconUrl} alt="" className="h-7 w-7 rounded-lg" />
              <img src={logoTextUrl} alt="Stock Otter" className="h-5 w-auto" />
              <span className="text-xs text-[#4a4f65] ml-2 hidden sm:inline">
                Smart Trading Analysis
              </span>
            </div>

            <div className="flex items-center gap-6 text-xs text-[#6b7084]">
              <button
                onClick={() => scrollTo("features")}
                className="hover:text-white transition-colors"
              >
                Features
              </button>
              <button
                onClick={() => scrollTo("pricing")}
                className="hover:text-white transition-colors"
              >
                Pricing
              </button>
              <span className="text-[#2a2f45]">|</span>
              <a href="/#/terms" className="hover:text-white transition-colors">Terms</a>
              <a href="/#/privacy" className="hover:text-white transition-colors">Privacy</a>
            </div>

            <div className="text-xs text-[#4a4f65]">
              &copy; 2026 Stock Otter. All rights reserved.
            </div>
          </div>

          <p className="text-[10px] text-[#3a3f55] text-center mt-8 max-w-lg mx-auto leading-relaxed">
            Stock Otter is not a financial advisor. All data is provided for
            informational purposes only. Trading involves risk and you may lose
            money. Past performance does not guarantee future results.
          </p>
        </div>
      </footer>
    </div>
  );
}

// ─── Feature Card ────────────────────────────────────────────────────────────

function FeatureCard({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
}) {
  return (
    <div className="group bg-[#0c1225]/80 border border-[#1E2235] rounded-xl p-6 transition-all duration-200 hover:border-[#6366F1]/30 hover:-translate-y-0.5 hover:shadow-[0_8px_30px_-10px_rgba(99,102,241,0.15)]">
      <div className="w-10 h-10 rounded-lg bg-[#6366F1]/10 border border-[#6366F1]/20 flex items-center justify-center mb-4 group-hover:bg-[#6366F1]/15 transition-colors">
        <Icon className="h-5 w-5 text-[#6366F1]" />
      </div>
      <h3 className="text-base font-semibold text-white mb-2">{title}</h3>
      <p className="text-sm text-[#8b8fa3] leading-relaxed">{description}</p>
    </div>
  );
}

// ─── Step Card ───────────────────────────────────────────────────────────────

function StepCard({
  step,
  icon: Icon,
  title,
  description,
}: {
  step: number;
  icon: React.ElementType;
  title: string;
  description: string;
}) {
  return (
    <div className="text-center">
      <div className="relative w-14 h-14 mx-auto mb-5">
        <div
          className="absolute inset-0 rounded-2xl"
          style={{
            background: "linear-gradient(135deg, #6366F1, #8B5CF6)",
          }}
        />
        <div className="relative w-full h-full rounded-2xl flex items-center justify-center">
          <span className="text-xl font-bold text-white">{step}</span>
        </div>
      </div>
      <div className="w-10 h-10 mx-auto mb-3 flex items-center justify-center">
        <Icon className="h-5 w-5 text-[#8b8fa3]" />
      </div>
      <h3 className="text-base font-semibold text-white mb-2">{title}</h3>
      <p className="text-sm text-[#8b8fa3] leading-relaxed max-w-xs mx-auto">
        {description}
      </p>
    </div>
  );
}

// ─── Pricing Card ────────────────────────────────────────────────────────────

function PricingCard({
  name,
  price,
  period,
  description,
  features,
  cta,
  onCta,
  highlighted,
  badge,
}: {
  name: string;
  price: string;
  period: string;
  description: string;
  features: { text: string; included: boolean }[];
  cta: string;
  onCta: () => void;
  highlighted: boolean;
  badge?: string;
}) {
  return (
    <div
      className={`relative rounded-2xl p-6 transition-all duration-200 ${
        highlighted
          ? "bg-[#0c1225] border-2 border-[#6366F1]/50 scale-[1.02] shadow-[0_0_40px_-10px_rgba(99,102,241,0.2)] z-10"
          : "bg-[#0c1225]/60 border border-[#1E2235] hover:border-[#2a2f45]"
      }`}
      data-testid={`pricing-card-${name.toLowerCase()}`}
    >
      {badge && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span
            className="text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-full text-white"
            style={{
              background: "linear-gradient(135deg, #6366F1, #8B5CF6)",
            }}
          >
            {badge}
          </span>
        </div>
      )}

      <div className="mb-6">
        <h3 className="text-lg font-semibold text-white mb-1">{name}</h3>
        <p className="text-xs text-[#6b7084] mb-4">{description}</p>
        <div className="flex items-baseline gap-1">
          <span className="text-4xl font-bold text-white">{price}</span>
          <span className="text-sm text-[#6b7084]">{period}</span>
        </div>
      </div>

      <div className="space-y-3 mb-8">
        {features.map((f, i) => (
          <div key={i} className="flex items-center gap-2.5">
            {f.included ? (
              <Check className="h-4 w-4 text-[#22c55e] shrink-0" />
            ) : (
              <Minus className="h-4 w-4 text-[#3a3f55] shrink-0" />
            )}
            <span
              className={`text-sm ${
                f.included ? "text-[#c4c7d4]" : "text-[#4a4f65]"
              }`}
            >
              {f.text}
            </span>
          </div>
        ))}
      </div>

      <button
        onClick={onCta}
        className={`w-full h-11 rounded-xl text-sm font-semibold transition-all ${
          highlighted
            ? "bg-[#6366F1] text-white hover:bg-[#5558e6] glow-button"
            : "bg-[#141829] border border-[#2a2f45] text-[#c4c7d4] hover:border-[#6366F1]/40 hover:text-white"
        }`}
        data-testid={`pricing-cta-${name.toLowerCase()}`}
      >
        {cta}
      </button>
    </div>
  );
}
