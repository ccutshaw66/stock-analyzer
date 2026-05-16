import { useLocation } from "wouter";
import type { LucideIcon } from "lucide-react";
import { lookupPageByPath } from "@/lib/page-registry";

/**
 * Standard page-header strip used at the top of every routed page.
 *
 * As of 2026-05-15 the icon / title / subtitle auto-resolve from
 * `client/src/lib/page-registry.ts` based on the current route — the
 * same registry the sidebar nav reads from. Render `<PageHeader />`
 * with no props on any page and the chrome matches the sidebar entry.
 *
 * Pass props to override the auto-resolution (e.g. custom title per
 * loading / error state, or per-ticker context in a chart page).
 *
 * Per the universal-structure rule: icon + label + subtitle live in
 * ONE file (the page registry). Don't pass `icon=...` on every page —
 * just edit the registry entry and let both surfaces pick it up.
 */
export function PageHeader({
  icon,
  title,
  subtitle,
  right,
}: {
  icon?: LucideIcon;
  title?: string;
  subtitle?: string;
  right?: React.ReactNode;
} = {}) {
  const [location] = useLocation();
  const meta = lookupPageByPath(location);

  const ResolvedIcon = icon ?? meta?.icon;
  const resolvedTitle = title ?? meta?.label ?? "";
  const resolvedSubtitle = subtitle ?? meta?.subtitle;

  return (
    <div className="flex items-start justify-between gap-3 mb-3" data-testid="page-header">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          {ResolvedIcon && <ResolvedIcon className="h-5 w-5 text-primary shrink-0" />}
          <h1 className="text-lg font-bold text-foreground truncate" data-testid="page-title">{resolvedTitle}</h1>
        </div>
        {resolvedSubtitle && (
          <p className="text-xs text-muted-foreground mt-1">{resolvedSubtitle}</p>
        )}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}
