/**
 * /wheel — thin page wrapper.
 *
 * All Wheel logic lives in the compartment (`@/compartments/wheel`):
 *   - pure logic: `wheelLogic.ts`
 *   - canonical hook: `useWheel` / `useWheelState`
 *   - full view: `WheelFullView`
 *   - widget view: `WheelWidget`
 *
 * The "How the Wheel works" block stays here because it's page-shell
 * context, not compartment internals — the same hook can be reused on
 * a dashboard widget that does not want this explainer.
 *
 * Page chrome (icon + title + subtitle) auto-resolves from the page
 * registry via PageTemplate (universal-structure rule).
 */
import { useTicker } from "@/contexts/TickerContext";
import { PageTemplate } from "@/components/PageTemplate";
import { Example, ScoreRange } from "@/components/HelpBlock";
import { WheelFullView } from "@/compartments/wheel";

export default function WheelPage() {
  const { activeTicker } = useTicker();

  return (
    <PageTemplate
      className="p-3 sm:p-4 md:p-6 space-y-6 max-w-[1200px] mx-auto"
      subtitle={
        activeTicker
          ? `Generate income via cash-secured puts → covered calls — currently analyzing ${activeTicker}.`
          : undefined /* registry subtitle is used when no ticker is active */
      }
      howItWorksTitle="How the Wheel earns income"
      howItWorks={
        <>
          <p>
            The Wheel is an <strong className="text-foreground">income strategy</strong> for stocks
            you'd actually want to own. You sell puts, collect premium, and take shares if
            the stock dips far enough. Then you sell calls on those shares, collecting more
            premium until they get called away. Then start over. The whole point is
            <strong className="text-foreground"> rent</strong> — generating cash from option
            premium whether the stock moves or not.
          </p>
          <ol className="list-decimal list-inside space-y-1 text-2xs leading-relaxed">
            <li><strong className="text-foreground">Sell a put</strong> at a strike below today's price. You need full cash collateral (strike × 100 per contract). Collect the premium up front.</li>
            <li><strong className="text-foreground">If the stock stays above the strike:</strong> put expires worthless. Keep the premium. Sell another put. Repeat.</li>
            <li><strong className="text-foreground">If the stock dips below the strike:</strong> you're assigned 100 shares per contract. Your real cost basis is <em>strike − premium</em> (so you're already up on the trade).</li>
            <li><strong className="text-foreground">Sell calls against the shares</strong> at a strike above your cost basis. Collect premium each cycle.</li>
            <li><strong className="text-foreground">If shares get called away:</strong> pocket the gain + premium. Start over with a new put.</li>
          </ol>
          <Example type="good">
            <strong className="text-bull-light">Clean cycle:</strong> KO at $58. Sell a 30-day
            $55 put for $1.10. Capital tied up: $5,500. If KO stays above $55: keep $110 (2.0%
            in 30 days ≈ 24% annualized). If assigned, cost basis $53.90 — already a discount
            on a dividend-paying stock you wanted anyway.
          </Example>
          <Example type="bad">
            <strong className="text-bear-light">The trap:</strong> Wheeling NVDA at $140
            because the premium looks great. Stock craters to $80 on a bad earnings cycle.
            You're assigned at $135 (cost basis ~$132) holding shares 40% underwater. Any
            covered call above $135 prints pennies and locks you out of the eventual rebound.
            <em> Only wheel stocks you're willing to hold through a 30%+ drawdown.</em>
          </Example>
          <ScoreRange label="Great fit" range="IV Rank 30-60" color="green" description="Quality dividend-payer, stable trend, premium worth the capital lock-up" />
          <ScoreRange label="OK" range="IV Rank 15-30" color="yellow" description="Safer but lower income — works if you'd own it anyway" />
          <ScoreRange label="Avoid" range="Earnings ≤14d, biotech, meme" color="red" description="Gap-down risk turns the wheel into a slow-bleed position" />
        </>
      }
    >
      <WheelFullView />
    </PageTemplate>
  );
}
