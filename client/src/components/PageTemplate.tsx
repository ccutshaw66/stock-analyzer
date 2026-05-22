/**
 * PageTemplate — the canonical page chrome wrapper.
 *
 * Every routed page renders inside a `<PageTemplate>` so the layout
 * compartments stay consistent: standard outer container → PageHeader
 * (title + subtitle from the page registry) → Disclaimer (default on) →
 * "How <page> works" HelpBlock (when content is provided) → page content.
 *
 * Adding a new page = wrap it in this component. You can't forget the
 * Disclaimer or the explainer slot because they're props of the wrapper,
 * not separate manual imports the next person has to remember.
 *
 * Pattern reference: see Market Pulse (`pages/market-pulse.tsx`) — the
 * page this template was extracted from.
 */
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Disclaimer } from "@/components/Disclaimer";
import { HelpBlock } from "@/components/HelpBlock";

interface PageTemplateProps {
  /**
   * Override the auto-resolved page title (from `page-registry`).
   * Most pages should leave this undefined and rely on the registry.
   */
  title?: string;
  /**
   * Override the auto-resolved one-line subtitle / explanation.
   * Most pages should leave this undefined and rely on the registry.
   */
  subtitle?: string;
  /** Override the auto-resolved page icon. */
  icon?: LucideIcon;
  /** Optional right-side action rendered inside the PageHeader strip. */
  headerRight?: ReactNode;
  /**
   * Deep-dive "How this works" content rendered inside a collapsible
   * HelpBlock between the disclaimer and the page content. Pass JSX
   * (paragraphs, lists, examples) — omit the prop entirely to suppress
   * the block.
   */
  howItWorks?: ReactNode;
  /**
   * Heading shown on the HelpBlock. Defaults to `How <title> works`.
   * Override when the auto-derived heading reads awkwardly.
   */
  howItWorksTitle?: string;
  /** Render the HelpBlock expanded on first mount. Default false. */
  howItWorksDefaultOpen?: boolean;
  /**
   * Show the "Not financial advice" disclaimer. Default true.
   * Pass false on pages that genuinely don't show financial advice
   * (Help / FAQ, account settings, legal pages).
   */
  disclaimer?: boolean;
  /**
   * Max-width class for the outer container. Defaults to `max-w-7xl`.
   * Set to `max-w-5xl` for narrow text-heavy pages (Market Pulse style),
   * `max-w-full` for full-bleed layouts (Dashboard grid).
   */
  maxWidth?: "max-w-5xl" | "max-w-6xl" | "max-w-7xl" | "max-w-full";
  /**
   * Full container className override — escape hatch when none of the
   * presets fit. Replaces the default `max-w-* mx-auto px-3 sm:px-4
   * py-4 sm:py-6 space-y-6` shell entirely.
   */
  className?: string;
  /** Page content rendered below the chrome. */
  children: ReactNode;
}

export function PageTemplate({
  title,
  subtitle,
  icon,
  headerRight,
  howItWorks,
  howItWorksTitle,
  howItWorksDefaultOpen = false,
  disclaimer = true,
  maxWidth = "max-w-7xl",
  className,
  children,
}: PageTemplateProps) {
  const shell = className ?? `${maxWidth} mx-auto px-3 sm:px-4 py-4 sm:py-6 space-y-6`;
  const helpTitle = howItWorksTitle ?? (title ? `How ${title} works` : "How this works");

  return (
    <div className={shell} data-testid="page-template">
      <PageHeader icon={icon} title={title} subtitle={subtitle} right={headerRight} />
      {disclaimer && <Disclaimer />}
      {howItWorks && (
        <HelpBlock title={helpTitle} defaultOpen={howItWorksDefaultOpen}>
          {howItWorks}
        </HelpBlock>
      )}
      {children}
    </div>
  );
}
