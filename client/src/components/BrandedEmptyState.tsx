/**
 * Branded empty-state primitive — the canonical way to render "nothing
 * here yet" / "no results" / "select a ticker" panels.
 *
 * Per the universal-structure rule (2026-05-15) and the quality-bar
 * memory: every empty state must look branded, not default. Don't roll
 * a bare `<p>No data</p>` — use this.
 *
 * Example:
 *   {!results.length && (
 *     <BrandedEmptyState
 *       icon={Search}
 *       title="No matches yet"
 *       description="Try a different ticker or widen the filters."
 *       action={<Button onClick={reset}>Reset filters</Button>}
 *     />
 *   )}
 */
import type { LucideIcon } from "lucide-react";

interface BrandedEmptyStateProps {
  /** Icon shown above the title. Lucide icon component. */
  icon?: LucideIcon;
  /** Optional image (e.g. otter mascot) — overrides the icon if provided. */
  imageSrc?: string;
  /** Primary line. */
  title: string;
  /** Secondary line under the title. */
  description?: string;
  /** Optional CTA (button, link, etc.) below the description. */
  action?: React.ReactNode;
  /** Extra classes on the wrapper. */
  className?: string;
}

export function BrandedEmptyState({
  icon: Icon,
  imageSrc,
  title,
  description,
  action,
  className,
}: BrandedEmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center py-12 px-4 ${className ?? ""}`}
      data-testid="branded-empty-state"
    >
      {imageSrc ? (
        <img src={imageSrc} alt="" className="h-24 w-auto mb-4 opacity-70" />
      ) : Icon ? (
        <Icon className="h-12 w-12 mb-4 text-muted-foreground opacity-50" />
      ) : null}
      <h3 className="text-base font-bold text-foreground mb-1">{title}</h3>
      {description && (
        <p className="text-sm text-muted-foreground max-w-md mb-4">{description}</p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
