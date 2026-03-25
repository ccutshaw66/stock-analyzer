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
import AuthPage from "@/pages/auth";
import LandingPage from "@/pages/landing";
import AccountPage from "@/pages/account";
import AdminPage from "@/pages/admin";
import ResetPassword from "@/pages/reset-password";
import { Loader2 } from "lucide-react";

function AuthenticatedApp() {
  const { user, isLoading } = useAuth();
  const [showAuth, setShowAuth] = useState<"login" | "register" | null>(null);

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
    // Check if we're on the reset-password route
    const hash = window.location.hash || "";
    if (hash.includes("/reset-password")) {
      return (
        <Router hook={useHashLocation}>
          <Switch>
            <Route path="/reset-password" component={ResetPassword} />
          </Switch>
        </Router>
      );
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
    <TickerProvider>
      <Router hook={useHashLocation}>
        <AppLayout>
          <Switch>
            <Route path="/" component={Home} />
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
            <Route path="/account" component={AccountPage} />
            <Route path="/admin" component={AdminPage} />
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
