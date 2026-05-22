import { AlertTriangle } from "lucide-react";

/**
 * Standardized "Not financial advice" fine-print bar rendered by PageTemplate
 * on every page that shows analysis or trade data.
 *
 * Styling rules:
 *   - Single-line on desktop (text-micro keeps it compact; whitespace-nowrap on
 *     sm+ breakpoints so a stray browser zoom doesn't push it to two lines).
 *   - Mutes to two-line on mobile (≤sm) where horizontal space is tight — that
 *     wrap is intentional, beats truncating the legally-required text.
 *   - Color is muted/neutral grey, NOT the watch-yellow it used to be — the
 *     yellow collided visually with the Market Pulse EUPHORIC tier badge
 *     which uses the same `watch` token (2026-05-21 Chris pushback).
 */
export function Disclaimer() {
  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 bg-muted/30 border border-card-border rounded-lg text-micro text-muted-foreground sm:whitespace-nowrap sm:overflow-hidden sm:text-ellipsis"
      data-testid="disclaimer"
    >
      <AlertTriangle className="h-3 w-3 shrink-0 text-watch-light" />
      <span>
        <strong className="text-foreground/80">Not financial advice</strong> — educational use only.
        All decisions are yours. Past performance ≠ future results.
      </span>
    </div>
  );
}
