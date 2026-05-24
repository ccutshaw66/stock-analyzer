/**
 * /markov — thin page wrapper.
 *
 * All Markov logic lives in the compartment (`@/compartments/markov`):
 *   - data hook: `useMarkov`
 *   - full view: `MarkovFullView`
 *   - widget view: `MarkovWidget`
 *
 * Page chrome auto-resolves icon + title + subtitle from the page registry
 * (universal-structure rule).
 */
import { PageTemplate } from "@/components/PageTemplate";
import { MarkovFullView } from "@/compartments/markov";

export default function MarkovPage() {
  return (
    <PageTemplate
      howItWorksTitle="How Markov fits in"
      howItWorks={
        <>
          <p>
            Markov is a research backtester for a Hidden Markov regime model
            with volatility-targeted sizing. The math runs in Python
            (<code>python/markov_trading_v2.py</code>) and is consumed here
            via a single canonical hook so this page, a future dashboard
            widget, and any alert preview all read from one place.
          </p>
          <p>
            Until the Python service is deployed (Railway, same pattern as
            HERMES), the page is a parameter-builder for the eventual
            <code> /api/backtest </code> POST.
          </p>
        </>
      }
    >
      <MarkovFullView />
    </PageTemplate>
  );
}
