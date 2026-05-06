import type { LucideIcon } from "lucide-react";

/**
 * Standard page-header strip used at the top of every routed page.
 * The icon should match the same page's sidebar icon.
 *
 * Page layout convention (enforced site-wide):
 *   <PageHeader icon={...} title="..." />
 *   <Disclaimer />          (when appropriate)
 *   <HelpBlock title="...">How it works...</HelpBlock>
 *   ...page content...
 */
export function PageHeader({
  icon: Icon,
  title,
  subtitle,
  right,
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 mb-3" data-testid="page-header">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className="h-5 w-5 text-primary shrink-0" />
          <h1 className="text-lg font-bold text-foreground truncate" data-testid="page-title">{title}</h1>
        </div>
        {subtitle && (
          <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
        )}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}
