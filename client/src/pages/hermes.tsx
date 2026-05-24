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

export default function HermesPage() {
  return (
    <PageTemplate
      howItWorksTitle="How HERMES integrates"
      howItWorks={
        <>
          <p>
            HERMES is a research auto-trader running outside Stock Otter on
            Railway. This page is the thin Stockotter shell — it shows live
            status, performance, equity curve, and lets you tune per-asset
            thresholds and portfolio-level goals. The trading itself happens
            in the Python service (archived at <code>python/hermes/</code>).
          </p>
          <p>
            All data flows through one canonical hook
            (<code>useHermes</code>) — pages, the dashboard widget, and any
            future alert preview all read from the same source. Per the
            compartment contract, there is exactly one place that talks to
            the Railway API.
          </p>
        </>
      }
    >
      <HermesFullView />
    </PageTemplate>
  );
}
