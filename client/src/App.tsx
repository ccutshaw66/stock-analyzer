import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TickerProvider } from "@/contexts/TickerContext";
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

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
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
                <Route component={NotFound} />
              </Switch>
            </AppLayout>
          </Router>
        </TickerProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
