/**
 * HTF Scanner dashboard teaser — compact tile showing the top live HTF
 * setups and a link to the full /htf page. Mirrors the BestOpps and
 * Confluence teasers in shape: header + 3-row preview + click-through.
 */
import { useLocation } from "wouter";
import { Flag, ArrowUpRight, Activity } from "lucide-react";
import { useHtfScanner, type HtfSetupRow } from "./useHtfScanner";
import type { WidgetViewProps } from "../types";
import { BrandedLoader } from "@/components/BrandedLoader";

function scoreColor(score: number): string {
  if (score >= 85) return "text-bull";
  if (score >= 70) return "text-watch-light";
  return "text-bear-light";
}

function Row({ r, onClick }: { r: HtfSetupRow; onClick: () => void }) {
  return (
    <div
      className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/50 transition-colors cursor-pointer"
      onClick={onClick}
      data-testid={`htf-teaser-row-${r.symbol}`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <Flag className="h-3 w-3 text-primary shrink-0" />
        <span className="font-mono font-bold text-sm truncate">{r.symbol}</span>
      </div>
      <div className="flex items-center gap-2 text-xs tabular-nums">
        <span className={`font-bold ${scoreColor(r.qualityScore)}`}>{r.qualityScore}</span>
        <span className="text-muted-foreground hidden sm:inline">
          ${r.breakoutPrice.toFixed(2)}
        </span>
      </div>
    </div>
  );
}

export function HtfTeaser(_props: WidgetViewProps) {
  const [, navigate] = useLocation();
  const q = useHtfScanner({ actionableOnly: true, minScore: 70 });
  const rows = (q.data?.rows ?? []).slice(0, 4);

  return (
    <div className="flex flex-col h-full">
      <div className="widget-drag-handle cursor-grab active:cursor-grabbing flex items-center justify-between gap-1.5 px-2 py-1.5 border-b border-border">
        <div className="flex items-center gap-1.5">
          <Flag className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-semibold text-foreground">HTF Setups</span>
        </div>
        <button
          type="button"
          onClick={() => navigate("/htf")}
          className="inline-flex items-center gap-0.5 text-mini text-muted-foreground hover:text-foreground"
          data-testid="htf-teaser-open"
          title="Open the full HTF scanner"
        >
          Open <ArrowUpRight className="h-3 w-3" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-1">
        {q.isLoading ? (
          <BrandedLoader size="sm" message="Scanning…" />
        ) : q.isError ? (
          <div className="text-xs text-bear-light px-2 py-3">Scan failed.</div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center py-4 px-2 gap-1">
            <Activity className="h-5 w-5 text-muted-foreground opacity-50" />
            <div className="text-xs text-muted-foreground">No live HTF setups</div>
            <div className="text-mini text-muted-foreground">Click Open to refresh</div>
          </div>
        ) : (
          rows.map((r) => (
            <Row key={r.symbol} r={r} onClick={() => navigate(`/htf/${r.symbol}`)} />
          ))
        )}
      </div>

      {q.data && rows.length > 0 && (
        <div className="border-t border-border px-2 py-1 text-mini text-muted-foreground text-center">
          {q.data.rows.length} live · {q.data.universeSize.toLocaleString()} scanned
        </div>
      )}
    </div>
  );
}
