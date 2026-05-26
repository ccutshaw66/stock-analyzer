/**
 * /kairos — thin page wrapper.
 *
 * All KAIROS logic lives in the compartment (`@/compartments/kairos`):
 *   - data hook: `useKairos`
 *   - full view: `KairosFullView`
 *   - widget view: `KairosWidget`
 *
 * Page chrome auto-resolves icon + title + subtitle from the page registry
 * (universal-structure rule).
 */
import { PageTemplate } from "@/components/PageTemplate";
import { KairosFullView } from "@/compartments/kairos";
import { Example, ScoreRange } from "@/components/HelpBlock";

export default function KairosPage() {
  return (
    <PageTemplate
      howItWorksTitle="How KAIROS trades"
      howItWorks={
        <>
          <p>
            KAIROS is the second <strong className="text-foreground">experimental auto-trader</strong> after
            HERMES. It runs the <strong className="text-foreground">HTF (High Tight Flag)</strong> breakout
            detector and the <strong className="text-foreground">BBTC trend follower</strong> natively —
            same algorithms backtested across stockotter, just executed live as paper trades.
            Currently in <strong className="text-foreground">paper mode</strong>.
          </p>
          <ol className="list-decimal list-inside space-y-1 text-2xs leading-relaxed">
            <li><strong className="text-foreground">Watch:</strong> hourly, refresh the watchlist from Stockotter's top HTF setups (auto-rotates as setups come and go).</li>
            <li><strong className="text-foreground">Scan:</strong> every 30 min, pull OHLCV per ticker, run HTF detector + BBTC strategy locally.</li>
            <li><strong className="text-foreground">Trigger:</strong> open a paper position when EITHER strategy fires. Tag the entry with which one (<code>HTF</code> / <code>BBTC</code> / <code>BOTH</code>).</li>
            <li><strong className="text-foreground">Size:</strong> fixed % of paper equity per trade (default 2%, configurable in goal.yaml).</li>
            <li><strong className="text-foreground">Manage:</strong> HTF positions use flag-low × 0.98 stop + measure-rule target; BBTC positions use ATR-based hard + trailing stops.</li>
            <li><strong className="text-foreground">Exit:</strong> close on stop hit, target hit, or strategy-specific signal flip.</li>
          </ol>
          <Example type="good">
            <strong className="text-bull-light">Conviction stack:</strong> NVDA prints an HTF breakout
            on +35% pole and 8% flag pullback on 2× volume — same day BBTC flips to BUY on EMA9 cross
            above EMA21 with ADX 24. KAIROS opens with <code>BOTH</code> tag. Stop = max(HTF stop, BBTC ATR stop) for
            conservative risk. Reads as the strongest signal class.
          </Example>
          <Example type="bad">
            <strong className="text-bear-light">Conviction split, conviction wrong:</strong> A ticker fires
            HTF but BBTC is firmly SELL (downtrending). HTF-only opens are the riskier cohort historically — they
            include picks where the broader trend hasn't turned yet. Phase 2 will let us downsize HTF-only entries
            until the dataset says otherwise.
          </Example>
          <ScoreRange label="Best fit" range="HTF + BBTC fire on same day" color="green" description="Two-strategy agreement on the same ticker — highest conviction class" />
          <ScoreRange label="OK" range="One strategy only" color="yellow" description="HTF or BBTC alone — Phase 2 will downsize these" />
          <ScoreRange label="Skipped" range="No watchlist setup" color="red" description="Ticker not in Stockotter's top HTF candidates this hour — KAIROS doesn't trade outside its watchlist" />
          <p className="text-2xs italic text-muted-foreground">
            Note: deployment of the Python bot is queued (Milestone 2). Until then, this page renders
            the final UI shape with "offline" state — visible to Chris only as an experimental preview.
          </p>
        </>
      }
    >
      <KairosFullView />
    </PageTemplate>
  );
}
