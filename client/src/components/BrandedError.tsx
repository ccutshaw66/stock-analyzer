/**
 * Branded error primitive — the canonical "something went wrong" panel
 * for in-page errors (not the global ErrorBoundary, which catches React
 * exceptions site-wide).
 *
 * Per the universal-structure rule (2026-05-15) and the quality-bar
 * memory: every error state must look branded with a friendly message
 * and a recovery action when applicable. Don't show raw error.message.
 *
 * Example:
 *   {error && (
 *     <BrandedError
 *       title="Couldn't load AAPL"
 *       description="Try another ticker or refresh."
 *       action={<Button onClick={refetch}>Retry</Button>}
 *     />
 *   )}
 */
import { AlertTriangle } from "lucide-react";

interface BrandedErrorProps {
  /** Primary line. */
  title: string;
  /** Secondary line — keep it human, not technical. */
  description?: string;
  /** Optional retry / recovery CTA. */
  action?: React.ReactNode;
  /** Extra classes on the wrapper. */
  className?: string;
}

export function BrandedError({
  title,
  description,
  action,
  className,
}: BrandedErrorProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center py-12 px-4 ${className ?? ""}`}
      data-testid="branded-error"
    >
      <AlertTriangle className="h-12 w-12 mb-4 text-bear opacity-70" />
      <h3 className="text-base font-bold text-foreground mb-1">{title}</h3>
      {description && (
        <p className="text-sm text-muted-foreground max-w-md mb-4">{description}</p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
