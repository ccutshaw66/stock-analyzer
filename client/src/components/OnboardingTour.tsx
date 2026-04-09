import { useState } from "react";
import {
  Crosshair, BarChart3, Activity, DollarSign, Shield,
  ChevronRight, ChevronLeft, X, Rocket, Search,
  ClipboardList, PieChart, Calculator,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface TourStep {
  title: string;
  description: string;
  icon: React.ReactNode;
  tip: string;
  path?: string; // sidebar path for highlighting
}

const TOUR_STEPS: TourStep[] = [
  {
    title: "Welcome to Stock Otter",
    description: "Your all-in-one trading analysis platform. Let's walk through what each section does so you can hit the ground running.",
    icon: <Rocket className="h-6 w-6" />,
    tip: "This tour takes about 60 seconds. You can skip it anytime.",
  },
  {
    title: "Search Any Stock",
    description: "Type a ticker (AAPL) or company name (Apple) in the search bar at the top. The app loads real-time data, analysis, and scoring for that stock.",
    icon: <Search className="h-6 w-6" />,
    tip: "The search works with partial names too — try 'Tesla' or 'Nvidia'.",
    path: "/trade",
  },
  {
    title: "Current Positions",
    description: "Your trade tracker. Add trades, close them, track P/L. Open options show estimated P/L based on the current stock price. This is your home page.",
    icon: <ClipboardList className="h-6 w-6" />,
    tip: "Use 'Add Trade' in the sidebar to log new positions. All P/L is calculated automatically.",
    path: "/tracker",
  },
  {
    title: "Scanner",
    description: "Scans up to 25 stocks dynamically using our VER (Volume Exhaustion Reversal) and AMC strategies. Filter by sector, price, market cap, and Buy/Sell signals.",
    icon: <Activity className="h-6 w-6" />,
    tip: "Start with 'All Sectors' and 10 stocks to get a feel for it. Results are cached — navigate away and come back without re-scanning.",
    path: "/scanner",
  },
  {
    title: "Market Maker Exposure",
    description: "See where market makers are positioned. GEX (Gamma Exposure) by strike, call/put walls, gamma flip level, max pain, and unusual options activity — with trade ideas.",
    icon: <Crosshair className="h-6 w-6" />,
    tip: "Works best on high-volume tickers: SPY, QQQ, AAPL, TSLA, NVDA.",
    path: "/mm-exposure",
  },
  {
    title: "Dividend Finder",
    description: "Scan 40 curated dividend stocks with yield, payout ratio, ex-dividend dates, and quality scores. Plus a Weekly Dividend Strategy for income every single week.",
    icon: <DollarSign className="h-6 w-6" />,
    tip: "Click 'Show Strategy' at the bottom for the Bowtie Nation weekly income plan.",
    path: "/dividends",
  },
  {
    title: "Trade Analysis",
    description: "Deep analysis on any ticker: 1-year price chart with EMA overlays, BBTC signals, fundamental scoring, stress tests, and institutional data.",
    icon: <BarChart3 className="h-6 w-6" />,
    tip: "Search a ticker first, then navigate here. The Verdict page gives a single 0-100 score.",
    path: "/trade",
  },
  {
    title: "Calculators",
    description: "Options Calculator, Payoff Diagram (with price slices), Kelly Criterion, and Greeks Calculator. Import open positions directly from your trade tracker.",
    icon: <Calculator className="h-6 w-6" />,
    tip: "The 'Import Open Position' button fills in your real trade data — no manual entry needed.",
    path: "/calculator",
  },
  {
    title: "Performance Analytics",
    description: "Win rate, P/L by strategy type, MFE/MAE (max profit reached vs max drawdown), position duration analysis, and behavior tracking.",
    icon: <PieChart className="h-6 w-6" />,
    tip: "Log at least 5-10 trades to see meaningful patterns in your trading behavior.",
    path: "/analytics",
  },
  {
    title: "You're All Set",
    description: "That's the essentials. Every page has a help section (click the ? icons) with detailed explanations. Scanned data is cached — no need to re-scan every time you navigate.",
    icon: <Shield className="h-6 w-6" />,
    tip: "Pro tip: The sidebar collapses. Use the groups to find what you need quickly.",
  },
];

export default function OnboardingTour({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState(0);
  const current = TOUR_STEPS[step];
  const isLast = step === TOUR_STEPS.length - 1;
  const isFirst = step === 0;

  const handleComplete = async () => {
    try {
      await apiRequest("POST", "/api/auth/complete-tour");
    } catch { /* non-critical */ }
    onComplete();
  };

  const handleSkip = async () => {
    await handleComplete();
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-[100] flex items-center justify-center p-4" data-testid="onboarding-tour">
      <div className="bg-card border border-card-border rounded-xl w-full max-w-lg shadow-2xl overflow-hidden">
        {/* Progress bar */}
        <div className="h-1 bg-muted">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${((step + 1) / TOUR_STEPS.length) * 100}%` }}
          />
        </div>

        {/* Header with skip */}
        <div className="flex items-center justify-between px-5 pt-4">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            Step {step + 1} of {TOUR_STEPS.length}
          </span>
          <button
            onClick={handleSkip}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
          >
            <X className="h-3 w-3" /> Skip tour
          </button>
        </div>

        {/* Content */}
        <div className="px-5 py-6">
          <div className="flex items-start gap-4">
            <div className="shrink-0 w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
              {current.icon}
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-foreground mb-2">{current.title}</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">{current.description}</p>
              <div className="mt-3 flex items-start gap-2 bg-primary/5 border border-primary/20 rounded-lg px-3 py-2">
                <Rocket className="h-3 w-3 text-primary mt-0.5 shrink-0" />
                <span className="text-[11px] text-primary/80">{current.tip}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between px-5 pb-5">
          <button
            onClick={() => setStep(s => s - 1)}
            disabled={isFirst}
            className="flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="h-3.5 w-3.5" /> Back
          </button>

          {isLast ? (
            <button
              onClick={handleComplete}
              className="flex items-center gap-1.5 h-9 px-5 text-sm font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Rocket className="h-4 w-4" /> Get Started
            </button>
          ) : (
            <button
              onClick={() => setStep(s => s + 1)}
              className="flex items-center gap-1.5 h-9 px-5 text-sm font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Next <ChevronRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
