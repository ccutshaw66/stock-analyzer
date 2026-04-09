import { useState } from "react";
import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TickerProvider } from "@/contexts/TickerContext";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { AppLayout } from "@/components/AppLayout";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import TradeAnalysis from "@/pages/trade-analysis";
import Scanner from "@/pages/scanner";
import TradeTracker from "@/pages/trade-tracker";
import OptionsCalculator from "@/pages/options-calculator";
import Help from "@/pages/help";
import Institutional from "@/pages/institutional";
import Verdict from "@/pages/verdict";
import PayoffDiagram from "@/pages/payoff-diagram";
import KellyCalculator from "@/pages/kelly-calculator";
import GreeksCalculator from "@/pages/greeks-calculator";
import SectorHeatmap from "@/pages/sector-heatmap";
import EarningsCalendar from "@/pages/earnings-calendar";
import TradeAnalytics from "@/pages/trade-analytics";
import Dividends from "@/pages/dividends";
import DividendPortfolio from "@/pages/dividend-portfolio";
import MMExposure from "@/pages/mm-exposure";
import AuthPage from "@/pages/auth";
import LandingPage from "@/pages/landing";
import AccountPage from "@/pages/account";
import AdminPage from "@/pages/admin";
import ResetPassword from "@/pages/reset-password";
import LegalPage from "@/pages/legal";
import { Loader2 } from "lucide-react";
import OnboardingTour from "@/components/OnboardingTour";

function AuthenticatedApp() {
  const { user, isLoading } = useAuth();
  const [showAuth, setShowAuth] = useState<"login" | "register" | null>(null);
  const [showTour, setShowTour] = useState(false);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#040d22' }}>
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

  // Show onboarding tour for new users
  if (!showTour && user && user.hasSeenTour === false) {
    // Small delay so the app renders first
    setTimeout(() => setShowTour(true), 500);
  }

  // Logged in — show the app
  return (
    <TickerProvider>
      {showTour && <OnboardingTour onComplete={() => setShowTour(false)} />}
      <Router hook={useHashLocation}>
        <AppLayout>
          <Switch>
            <Route path="/" component={TradeTracker} />
            <Route path="/profile" component={Home} />
            <Route path="/trade" component={TradeAnalysis} />
            <Route path="/scanner" component={Scanner} />
            <Route path="/tracker" component={TradeTracker} />
            <Route path="/calculator" component={OptionsCalculator} />
            <Route path="/verdict" component={Verdict} />
            <Route path="/institutional" component={Institutional} />
            <Route path="/help" component={Help} />
            <Route path="/payoff" component={PayoffDiagram} />
            <Route path="/kelly" component={KellyCalculator} />
            <Route path="/greeks" component={GreeksCalculator} />
            <Route path="/sectors" component={SectorHeatmap} />
            <Route path="/earnings" component={EarningsCalendar} />
            <Route path="/analytics" component={TradeAnalytics} />
            <Route path="/dividends" component={Dividends} />
            <Route path="/dividend-portfolio" component={DividendPortfolio} />
            <Route path="/mm-exposure" component={MMExposure} />
            <Route path="/account" component={AccountPage} />
            <Route path="/admin" component={AdminPage} />
            <Route path="/reset-password" component={ResetPassword} />
            <Route path="/terms" component={LegalPage} />
            <Route path="/privacy" component={LegalPage} />
            <Route component={NotFound} />
          </Switch>
        </AppLayout>
      </Router>
    </TickerProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <AuthProvider>
          <AuthenticatedApp />
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
