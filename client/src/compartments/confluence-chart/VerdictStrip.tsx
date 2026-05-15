/**
 * Sticky bottom verdict strip — the "what's the call right now" line.
 *
 * Big color-coded verdict pill, plain-English signal label, gate count,
 * last-updated timestamp.
 */
import { useEffect, useState } from "react";
import type { QuickScan } from "./useConfluenceChart";

interface VerdictStripProps {
  quick: QuickScan | undefined;
  lastUpdated?: number;
}

function verdictStyle(verdict: string | null | undefined): {
  bg: string;
  text: string;
  label: string;
  plainEnglish: string;
} {
  const v = (verdict ?? "").toUpperCase();
  if (v.startsWith("GO ↑"))
    return { bg: "bg-green-500", text: "text-white", label: verdict!, plainEnglish: "STRONG BUY" };
  if (v.startsWith("GO"))
    return { bg: "bg-red-500", text: "text-white", label: verdict!, plainEnglish: "STRONG SELL" };
  if (v.startsWith("SET ↑"))
    return { bg: "bg-green-500/70", text: "text-white", label: verdict!, plainEnglish: "GOOD BUY" };
  if (v.startsWith("SET"))
    return { bg: "bg-red-500/70", text: "text-white", label: verdict!, plainEnglish: "GOOD SELL" };
  if (v.startsWith("READY ↑"))
    return { bg: "bg-green-500/30", text: "text-green-300", label: verdict!, plainEnglish: "MODERATE BUY" };
  if (v.startsWith("READY"))
    return { bg: "bg-red-500/30", text: "text-red-300", label: verdict!, plainEnglish: "MODERATE SELL" };
  if (v.startsWith("PULLBACK"))
    return { bg: "bg-amber-500/30", text: "text-amber-300", label: verdict!, plainEnglish: "WAIT FOR PULLBACK" };
  if (v.startsWith("GATES"))
    return { bg: "bg-muted", text: "text-muted-foreground", label: "GATES CLOSED", plainEnglish: "AVOID" };
  return { bg: "bg-muted", text: "text-muted-foreground", label: verdict || "NO SETUP", plainEnglish: "AVOID" };
}

function formatAgo(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export function VerdictStrip({ quick, lastUpdated }: VerdictStripProps) {
  const style = verdictStyle(quick?.verdict);
  const [_, setTick] = useState(0);

  // Tick once a second so the "ago" label updates live.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const ago = lastUpdated ? formatAgo(Date.now() - lastUpdated) : null;

  return (
    <div className="sticky bottom-0 z-20 bg-card/95 backdrop-blur-sm border-t border-border" data-testid="confluence-verdict-strip">
      <div className="flex items-center justify-between gap-4 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <span
            className={`text-base font-bold px-3 py-1 rounded ${style.bg} ${style.text}`}
            data-testid="verdict-pill"
          >
            {style.label}
          </span>
          <span className="text-xs font-semibold tracking-wider text-foreground">
            {style.plainEnglish}
          </span>
          {quick?.score != null && (
            <span className="text-xs text-muted-foreground">
              Gates <span className="font-bold tabular-nums text-foreground">{quick.score}/3</span>
            </span>
          )}
        </div>
        {ago && (
          <span className="text-[10px] text-muted-foreground tabular-nums">Last updated {ago}</span>
        )}
      </div>
    </div>
  );
}
