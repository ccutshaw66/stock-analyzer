/**
 * /hermes — thin page wrapper.
 *
 * All HERMES logic lives in the compartment (`@/compartments/hermes`):
 *   - data hook: `useHermes`
 *   - full view: `HermesFullView`
 *   - widget view: `HermesWidget`
 *
 * This file just wires the compartment's Full view into the canonical
 * page chrome (PageTemplate auto-resolves the icon + title + subtitle
 * from the page registry, per the universal-structure rule).
 */
import { PageTemplate } from "@/components/PageTemplate";
import { HermesFullView } from "@/compartments/hermes";
import { Example, ScoreRange } from "@/components/HelpBlock";

export default function HermesPage() {
  return (
    <PageTemplate
      howItWorksTitle="How HERMES trades"
      howItWorks={
        <>
          <p>
            HERMES is an <strong className="text-foreground">experimental auto-trader</strong> for
            stocks and crypto. It watches your asset list every minute and looks for
            <strong className="text-foreground"> oversold dips</strong> using RSI — the standard
            momentum oscillator. Currently runs in <strong className="text-foreground">paper
            mode</strong>, so no real money is at risk.
          </p>
          <ol className="list-decimal list-inside space-y-1 text-2xs leading-relaxed">
            <li><strong className="text-foreground">Watch:</strong> every 60 seconds, fetch price + RSI for each asset on the list.</li>
            <li><strong className="text-foreground">Enter:</strong> when RSI drops below the threshold (default 30 = oversold), open a long position.</li>
            <li><strong className="text-foreground">Size:</strong> position size scales inversely with volatility — calmer assets get bigger bets, jumpy ones get smaller.</li>
            <li><strong className="text-foreground">Exit:</strong> close when price drops past the stop-loss (default −2%) <em>or</em> rallies past 2× the stop-loss (default +4%).</li>
            <li><strong className="text-foreground">Repeat:</strong> log the trade, recompute strategy weights, scan again next loop.</li>
          </ol>
          <Example type="good">
            <strong className="text-bull-light">Clean win:</strong> BTC sells off, RSI hits 25.
            HERMES opens long at $58,400. Over the next two days BTC bounces, hits the
            +4% target at $60,736 — closes, logs +4%, scans the next setup.
          </Example>
          <Example type="bad">
            <strong className="text-bear-light">Bot trap:</strong> NVDA reports earnings
            mid-week. Stock gaps down through RSI 28 (entry trigger) and the −2% stop in
            the same candle. HERMES can't react fast enough — actual exit prints −5%.
            <em> Lesson: don't add high-event-risk tickers (earnings within 2 weeks).</em>
          </Example>
          <ScoreRange label="Good fit" range="RSI 20-30" color="green" description="Genuine oversold reversal candidates with normal volatility" />
          <ScoreRange label="Riskier" range="RSI 30-40" color="yellow" description="Soft pullbacks — works in trends, fails in chop" />
          <ScoreRange label="Don't add" range="Earnings ≤14d" color="red" description="Gap-risk blows past stops, sample size too small to trust the bot" />
        </>
      }
    >
      <HermesFullView />
    </PageTemplate>
  );
}
