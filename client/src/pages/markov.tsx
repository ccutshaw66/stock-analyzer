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
import { Example, ScoreRange } from "@/components/HelpBlock";

export default function MarkovPage() {
  return (
    <PageTemplate
      howItWorksTitle="How regime detection works"
      howItWorks={
        <>
          <p>
            Markov is an <strong className="text-foreground">experimental backtester</strong> for
            a regime-detection strategy. The premise: markets aren't one game — they cycle
            through <strong className="text-foreground">regimes</strong> (calm uptrend, choppy
            range, vol spike, bear) that each reward different behavior. A single
            "always-on" strategy gets eaten in the regime it's wrong for. Sizing down
            during the wrong regime can save more than picking better setups in the right one.
          </p>
          <ol className="list-decimal list-inside space-y-1 text-2xs leading-relaxed">
            <li><strong className="text-foreground">Classify:</strong> the Hidden Markov Model reads recent price + volatility and labels each day with a regime (e.g. "low-vol uptrend" vs "high-vol selloff").</li>
            <li><strong className="text-foreground">Map:</strong> each regime gets a target position size (e.g. high-vol selloff → 25% allocation; calm uptrend → 100%).</li>
            <li><strong className="text-foreground">Replay:</strong> run the strategy over your chosen window with regime-aware sizing applied.</li>
            <li><strong className="text-foreground">Compare:</strong> read the equity curve + drawdown vs the same strategy with fixed sizing.</li>
          </ol>
          <Example type="good">
            <strong className="text-bull-light">Where it earns its keep:</strong> Feb–Mar 2020.
            Vol spikes — the model flips to "high-vol bear" within a few days, halves position
            size. Same buy-the-dip strategy that was −38% in fixed-sizing prints −19% with
            regime-aware sizing.
          </Example>
          <Example type="bad">
            <strong className="text-bear-light">Where it fails:</strong> regime classification
            <em> lags</em>. The model doesn't see the regime change until enough new data is
            in — sometimes 5-10 trading days. So you eat the first chunk of any sudden shift
            (Feb 2020's first leg, Aug 2024's yen-carry day) at full size, then size down
            after.
          </Example>
          <ScoreRange label="Best use" range="Multi-year backtest" color="green" description="Long windows let the regime distribution settle — single-year tests are too noisy" />
          <ScoreRange label="Watch out" range="Recent 30 days" color="yellow" description="Live regime label has high uncertainty until 2-4 weeks of new data" />
          <ScoreRange label="Don't trust" range="Single day calls" color="red" description="Markov is a sizing tool, not a market-timing signal" />
          <p className="text-2xs italic text-muted-foreground">
            Note: backtest runs require the Python engine to be live. The page works as
            a parameter builder + dry-run today; live backtests light up once the engine
            is wired in.
          </p>
        </>
      }
    >
      <MarkovFullView />
    </PageTemplate>
  );
}
