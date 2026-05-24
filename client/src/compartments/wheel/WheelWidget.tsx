/**
 * Wheel dashboard widget — compact view of a sample wheel setup.
 *
 * Uses the default inputs from the canonical hook so the widget renders
 * without any user state. Clicking the title opens the full Wheel page
 * where the inputs are editable.
 */
import { Link } from "wouter";
import { RefreshCw } from "lucide-react";
import { useWheel } from "./useWheel";
import { DEFAULT_WHEEL_INPUTS } from "./wheelLogic";

export function WheelWidget() {
  const { metrics, health } = useWheel(DEFAULT_WHEEL_INPUTS);

  const healthColor =
    health.score >= 80 ? "text-bull-light"
    : health.score >= 60 ? "text-watch-light"
    : "text-bear-light";

  return (
    <div className="flex flex-col h-full p-2" data-testid="wheel-widget">
      <Link href="/wheel">
        <div className="widget-drag-handle cursor-grab active:cursor-grabbing flex items-center gap-1.5 px-1 pb-2 border-b border-border">
          <RefreshCw className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-semibold text-foreground">Wheel Strategy</span>
        </div>
      </Link>

      <div className="flex-1 flex flex-col justify-center px-1 py-2 gap-1.5">
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Put yield (annualized)</span>
          <span className="text-base font-bold tabular-nums text-blue-400">
            {metrics.putAnnualized.toFixed(1)}%
          </span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Full wheel (annualized)</span>
          <span className="text-base font-bold tabular-nums text-bull-light">
            {metrics.fullCycleAnnualized.toFixed(1)}%
          </span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Setup quality</span>
          <span className={`text-base font-bold tabular-nums ${healthColor}`}>
            {health.score}%
          </span>
        </div>
        <p className="text-[9px] text-muted-foreground/70 italic mt-1">
          Sample setup. Open the full page to customize inputs.
        </p>
      </div>
    </div>
  );
}
