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
      howItWorksTitle="What is the Wheel Strategy?"
      howItWorks={
        <>
          <p>
            The Wheel is a <strong className="text-foreground">neutral-to-bullish income strategy</strong> that combines
            <strong className="text-foreground"> cash-secured puts (CSPs)</strong> and
            <strong className="text-foreground"> covered calls (CCs)</strong> on a stock you'd be happy to own.
          </p>
          <ol className="list-decimal list-inside space-y-1 text-2xs leading-relaxed">
            <li><strong className="text-foreground">Phase 1 (CSP):</strong> Sell a put at a strike below current price. Set aside strike × 100 in cash per contract.</li>
            <li><strong className="text-foreground">Expiry:</strong> If stock stays above strike, put expires worthless — keep the premium, sell another CSP.</li>
            <li><strong className="text-foreground">Assignment:</strong> If stock drops below strike, you buy 100 shares per contract at the strike. Your cost basis is <em>strike − put premium</em>.</li>
            <li><strong className="text-foreground">Phase 2 (CC):</strong> Now sell covered calls above your cost basis. Collect premium each cycle.</li>
            <li><strong className="text-foreground">Called away:</strong> If stock rises above the call strike, shares are sold. Pocket the gain + call premium, then restart with a new CSP.</li>
          </ol>
          <Example type="good">
            <strong className="text-bull-light">Ideal setup:</strong> Stock at $100, sell 30 DTE $95 put for $1.50. Capital: $9,500.
            Return if unassigned: 1.58% in 30 days ≈ 19.2% annualized. If assigned, cost basis = $93.50 and you start selling calls.
          </Example>
          <Example type="bad">
            <strong className="text-bear-light">Wheel trap:</strong> Stock crashes from $100 to $60. You're assigned at $95, stuck with
            $35/share unrealized loss, and any call you sell above $95 barely covers the bleeding. Only wheel stocks you're
            <em> genuinely willing to own through a drawdown</em>.
          </Example>
          <ScoreRange label="Great candidate" range="IV Rank 30–60, stable price, quality business" color="green" description="High premium, limited tail risk" />
          <ScoreRange label="OK candidate" range="IV Rank 15–30 or slight uptrend" color="yellow" description="Lower income, but safer" />
          <ScoreRange label="Avoid" range="Biotech / earnings run-ups / meme stocks" color="red" description="Gap-down risk destroys the wheel" />
        </>
      }
    >
      <WheelFullView />
    </PageTemplate>
  );
}
