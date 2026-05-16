/**
 * Branded loading primitive — the canonical way to show "loading…" on
 * the site. Per the universal-structure rule (2026-05-15), no new page
 * rolls its own `<Loader2 className="..." />` block — use this.
 *
 * Three size tiers (sm / md / lg) plus an optional message. Centered
 * by default so it can drop into any container without layout fights.
 *
 * Example:
 *   {isLoading && <BrandedLoader message="Loading AAPL…" />}
 */
import { Loader2 } from "lucide-react";

interface BrandedLoaderProps {
  /** Loader size. sm = inline (h-4), md = default (h-6), lg = hero (h-8). */
  size?: "sm" | "md" | "lg";
  /** Optional sub-message under the spinner. Skip for inline / cramped contexts. */
  message?: string;
  /** Set true to fill the parent container. Default true. */
  fill?: boolean;
  /** Extra classes on the wrapper. */
  className?: string;
}

const SIZE_CLASS = {
  sm: "h-4 w-4",
  md: "h-6 w-6",
  lg: "h-8 w-8",
} as const;

export function BrandedLoader({
  size = "md",
  message,
  fill = true,
  className,
}: BrandedLoaderProps) {
  const wrapper = fill
    ? "flex flex-col items-center justify-center gap-2 py-8"
    : "inline-flex items-center gap-2";
  return (
    <div className={`${wrapper} ${className ?? ""}`} data-testid="branded-loader">
      <Loader2 className={`${SIZE_CLASS[size]} animate-spin text-primary`} />
      {message && (
        <span className="text-xs text-muted-foreground">{message}</span>
      )}
    </div>
  );
}
