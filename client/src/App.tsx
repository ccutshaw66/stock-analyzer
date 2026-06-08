import { useState, useEffect } from "react";
import { Switch, Route, Router, Redirect } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient, queryPersister } from "./lib/queryClient";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TickerProvider } from "@/contexts/TickerContext";
import { TimeframeProvider } from "@/contexts/TimeframeContext";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { AppLayout } from "@/components/AppLayout";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import TradeAnalysis from "@/pages/trade-analysis";
import ChartPage from "@/pages/chart";
import Scanner from "@/pages/scanner";
import UnifiedScannerPage from "@/pages/unified-scanner";
import TradeTracker from "@/pages/trade-tracker";
import MarketPulse from "@/pages/market-pulse";
import OptionsCalculator from "@/pages/options-calculator";
import Help from "@/pages/help";
import Institutional from "@/pages/institutional";
import Verdict from "@/pages/verdict";
import ConvictionPage from "@/pages/conviction";
import PayoffDiagram from "@/pages/payoff-diagram";
import KellyCalculator from "@/pages/kelly-calculator";
import GreeksCalculator from "@/pages/greeks-calculator";
import SectorHeatmap from "@/pages/sector-heatmap";
import EarningsCalendar from "@/pages/earnings-calendar";
import TradeAnalytics from "@/pages/trade-analytics";
import Dividends from "@/pages/dividends";
import DividendPortfolio from "@/pages/dividend-portfolio";
import MMExposure from "@/pages/mm-exposure";
import WheelCalculator from "@/pages/wheel";
import HermesPage from "@/pages/hermes";
import KairosPage from "@/pages/kairos";
import MarkovPage from "@/pages/markov";
import GammaBotPage from "@/pages/gamma-bot";
import TrendRideBotPage from "@/pages/trend-ride-bot";
import MetalsEconomyPage from "@/pages/metals-economy";
import StrangleScannerPage from "@/pages/strangle-scanner";
import GammaCollectorPage from "@/pages/gamma-collector";
import VolCalcPage from "@/pages/vol-calc";
import StrategyLabPage from "@/pages/strategy-lab";
import AuthPage from "@/pages/auth";
import LandingPage from "@/pages/landing";
import AccountPage from "@/pages/account";
import AdminPage from "@/pages/admin";
import ResetPassword from "@/pages/reset-password";
import LegalPage from "@/pages/legal";
import TrackRecord from "@/pages/track-record";
import AlertsPage from "@/pages/alerts";
import Dashboard from "@/pages/dashboard";
import HtfSetupsPage from "@/pages/htf-setups";
import HtfChartPage from "@/pages/htf-chart";
import InsidersPage from "@/pages/insiders";
import { RequireTier } from "@/components/RequireTier";
import { Loader2 } from "lucide-react";
import OnboardingTour from "@/components/OnboardingTour";
import { ErrorBoundary } from "@/components/ErrorBoundary";

function AuthenticatedApp() {
  const { user, isLoading } = useAuth();
  const [showAuth, setShowAuth] = useState<"login" | "register" | null>(null);
  const [showTour, setShowTour] = useState(false);
  const [tourDismissed, setTourDismissed] = useState(false);

  useEffect(() => {
    if (user && user.hasSeenTour === false && !tourDismissed) {
      const t = setTimeout(() => setShowTour(true), 800);
      return () => clearTimeout(t);
    }
  }, [user, tourDismissed]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-brand-bg">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading Stock Otter...</p>
        </div>
      </div>
    );
  }

  // Not logged in — show landing, auth, or reset password
  if (!user) {
    // Check if we're on the reset-password or legal routes
    if (window.location.hash.includes("reset-password")) {
      return <ResetPassword />;
    }
    if (window.location.hash.includes("/terms") || window.location.hash.includes("/privacy")) {
      return <LegalPage />;
    }
    if (showAuth) {
      return <AuthPage initialMode={showAuth} onBack={() => setShowAuth(null)} />;
    }
    return (
      <LandingPage
        onLogin={() => setShowAuth("login")}
        onRegister={() => setShowAuth("register")}
      />
    );
  }

  // Logged in — show the app
  return (
    <TimeframeProvider>
    <TickerProvider>
      {showTour && <OnboardingTour onComplete={() => { setShowTour(false); setTourDismissed(true); }} />}
      <Router hook={useHashLocation}>
        <AppLayout>
          <Switch>
            {/* Free — no tier gate */}
            <Route path="/" component={MarketPulse} />
            <Route path="/dashboard" component={Dashboard} />
            <Route path="/market-pulse" component={MarketPulse} />
            <Route path="/profile" component={Home} />
            <Route path="/trade" component={TradeAnalysis} />
            <Route path="/scanner" component={UnifiedScannerPage} />
            <Route path="/scanner-legacy" component={Scanner} />
            <Route path="/htf" component={HtfSetupsPage} />
            <Route path="/htf/:symbol" component={HtfChartPage} />
            <Route path="/verdict" component={Verdict} />
            <Route path="/sectors" component={SectorHeatmap} />
            <Route path="/help" component={Help} />
            <Route path="/account" component={AccountPage} />
            <Route path="/admin" component={AdminPage} />
            <Route path="/reset-password" component={ResetPassword} />
            <Route path="/terms" component={LegalPage} />
            <Route path="/privacy" component={LegalPage} />

            {/* Confluence Chart merged into the single Chart page (2026-06).
                Old links/bookmarks redirect to /chart. */}
            <Route path="/chart/confluence/:ticker?">
              <Redirect to="/chart" />
            </Route>
            <Route path="/chart">
              <RequireTier min="pro" feature="Chart"
                description="Candles + EMAs + MACD/RSI + the multi-signal confluence read, with the strategy backtester (BBTC+VER, AMC, TFT).">
                <ChartPage />
              </RequireTier>
            </Route>
            <Route path="/tracker">
              <RequireTier min="pro" feature="Current Positions"
                description="Track every open trade with live P/L, stops, and targets.">
                <TradeTracker />
              </RequireTier>
            </Route>
            <Route path="/conviction">
              <RequireTier min="pro" feature="Trigger Check"
                description="The final pre-trade verdict — pulls every signal into one GO/CAUTION/NO answer with a plain-English checklist.">
                <ConvictionPage />
              </RequireTier>
            </Route>
            <Route path="/institutional">
              <RequireTier min="pro" feature="Institutions"
                description="13F-tracked institutional ownership and flows for any ticker.">
                <Institutional />
              </RequireTier>
            </Route>
            <Route path="/insiders">
              <RequireTier min="pro" feature="Insider Activity"
                description="Monthly insider buy/sell ratio + ranked ticker tables. SEC Form 4 deep-scan.">
                <InsidersPage />
              </RequireTier>
            </Route>
            <Route path="/earnings">
              <RequireTier min="pro" feature="Earnings Calendar"
                description="Upcoming earnings dates with expected-move ranges.">
                <EarningsCalendar />
              </RequireTier>
            </Route>
            <Route path="/dividends">
              <RequireTier min="pro" feature="Dividend Finder"
                description="Discover, compare, and rank dividend-paying stocks.">
                <Dividends />
              </RequireTier>
            </Route>
            <Route path="/dividend-portfolio">
              <RequireTier min="pro" feature="Dividend Positions"
                description="Track dividend-paying holdings and forward income.">
                <DividendPortfolio />
              </RequireTier>
            </Route>
            <Route path="/track-record">
              <RequireTier min="pro" feature="Track Record"
                description="Every signal logged, every outcome tracked — see how the scanner actually performs over time.">
                <TrackRecord />
              </RequireTier>
            </Route>
            <Route path="/alerts">
              <RequireTier min="pro" feature="Alerts"
                description="Custom alerts on signals, levels, and verdict changes.">
                <AlertsPage />
              </RequireTier>
            </Route>
            <Route path="/analytics">
              <RequireTier min="pro" feature="Performance Analytics"
                description="How your trades actually performed — win rate, R-multiple, MFE/MAE drag.">
                <TradeAnalytics />
              </RequireTier>
            </Route>
            <Route path="/calculator">
              <RequireTier min="pro" feature="Options Calculator"
                description="Premium, break-even, and implied vol around the option chain.">
                <OptionsCalculator />
              </RequireTier>
            </Route>
            <Route path="/kelly">
              <RequireTier min="pro" feature="Kelly Criterion"
                description="Position sizing from edge, win rate, and bankroll.">
                <KellyCalculator />
              </RequireTier>
            </Route>

            {/* Elite-gated — paid-data + advanced options + automated trading */}
            <Route path="/mm-exposure">
              <RequireTier min="elite" feature="MM Exposure"
                description="Dealer gamma positioning, gamma walls, and max-pain levels from the live options chain.">
                <MMExposure />
              </RequireTier>
            </Route>
            <Route path="/payoff">
              <RequireTier min="elite" feature="Payoff Diagram"
                description="Visualize P/L curves for any multi-leg options strategy.">
                <PayoffDiagram />
              </RequireTier>
            </Route>
            <Route path="/greeks">
              <RequireTier min="elite" feature="Greeks Calculator"
                description="Delta, gamma, theta, vega, rho — per leg and per position.">
                <GreeksCalculator />
              </RequireTier>
            </Route>
            <Route path="/wheel">
              <RequireTier min="owner" feature="Wheel Strategy"
                description="Cash-secured puts → covered calls — the wheel mechanics.">
                <WheelCalculator />
              </RequireTier>
            </Route>
            <Route path="/hermes">
              <RequireTier min="elite" feature="HERMES Auto Trader"
                description="Live status, stats, and trades from the self-hosted HERMES automated-trading service.">
                <HermesPage />
              </RequireTier>
            </Route>
            <Route path="/kairos">
              <RequireTier min="elite" feature="KAIROS Auto Trader"
                description="HTF + BBTC paper trader with conviction-tagged entries (HTF / BBTC / BOTH).">
                <KairosPage />
              </RequireTier>
            </Route>
            <Route path="/markov">
              <RequireTier min="elite" feature="Markov Strategy"
                description="Markov-chain regime model for forward-state probabilities.">
                <MarkovPage />
              </RequireTier>
            </Route>
            <Route path="/gamma-bot">
              <RequireTier min="owner" feature="Gamma Vol Bot"
                description="Deterministic dealer-gamma volatility paper bot — adjustable money/risk, live signals, paper P&L.">
                <GammaBotPage />
              </RequireTier>
            </Route>
            <Route path="/trend-ride-bot">
              <RequireTier min="owner" feature="Trend-Ride Bot"
                description="BBTC Trend-Ride paper bot — rides the trend to a significant break of the 168-EMA. Adjustable money/rules, real seeded trades, paper P&L.">
                <TrendRideBotPage />
              </RequireTier>
            </Route>
            <Route path="/metals-economy">
              <RequireTier min="owner" feature="Metals vs Economy"
                description="World GDP vs US GDP vs Gold & Silver across major crises since 1971.">
                <MetalsEconomyPage />
              </RequireTier>
            </Route>
            <Route path="/strangle-scanner">
              <RequireTier min="owner" feature="Strangle Scanner"
                description="Volatility scanner — ranks the options basket into SELL-VOL / BUY-VOL strangle setups, with a paper auto-trader.">
                <StrangleScannerPage />
              </RequireTier>
            </Route>
            <Route path="/gamma-collector">
              <RequireTier min="owner" feature="Gamma Collector"
                description="Watch the dealer-gamma collector accumulate toward validation, plus the live gamma landscape.">
                <GammaCollectorPage />
              </RequireTier>
            </Route>
            <Route path="/vol-calc">
              <RequireTier min="owner" feature="Vol / Straddle Calculator"
                description="Straddle calculator — expected move, fair prices, and sell-vol vs buy-vol P&L.">
                <VolCalcPage />
              </RequireTier>
            </Route>
            <Route path="/strategy-lab">
              <RequireTier min="owner" feature="Strategy Lab"
                description="Options strategy lab — singles, verticals, covered calls, straddles, condors: net debit/credit, max P/L, break-evens, probability of profit, payoff, and hedging.">
                <StrategyLabPage />
              </RequireTier>
            </Route>

            <Route component={NotFound} />
          </Switch>
        </AppLayout>
      </Router>
    </TickerProvider>
    </TimeframeProvider>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister: queryPersister,
          // Persist scanner + screener-family queries so results survive a
          // page reload inside the tab (and don't re-scan on navigation).
          // NOTE: the legacy filter only matched "/api/scanner", which MISSED
          // the unified scanner ("/api/unified-scanner") that Chris actually
          // uses, plus the HTF setups scan — so those silently re-ran. Widened
          // to cover all scan/screen families. Everything else still refetches.
          dehydrateOptions: {
            shouldDehydrateQuery: (query) => {
              const firstKey = query.queryKey[0];
              if (typeof firstKey !== "string") return false;
              return (
                firstKey.startsWith("/api/scanner") ||
                firstKey.startsWith("/api/unified-scanner") ||
                firstKey.startsWith("/api/htf/setups")
              );
            },
          },
        }}
      >
        <TooltipProvider>
          <Toaster />
          <AuthProvider>
            <AuthenticatedApp />
          </AuthProvider>
        </TooltipProvider>
      </PersistQueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
