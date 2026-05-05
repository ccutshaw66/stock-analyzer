import { useTimeframe, TIMEFRAME_VALUES, TIMEFRAME_LABELS, type TimeframeValue } from "@/contexts/TimeframeContext";

export function TimeframePicker() {
  const { timeframe, setTimeframe } = useTimeframe();

  return (
    <div className="flex items-center gap-1.5 shrink-0" data-testid="timeframe-picker">
      <span className="hidden md:inline text-[10px] uppercase tracking-wider text-muted-foreground/70">TF</span>
      <select
        value={timeframe}
        onChange={(e) => setTimeframe(e.target.value as TimeframeValue)}
        className="h-8 px-2 text-xs font-semibold bg-background border border-card-border rounded-md text-foreground tabular-nums focus:outline-none focus:ring-1 focus:ring-primary/50 cursor-pointer"
        title="Timeframe applied site-wide to charts, scanners, and indicators"
      >
        {TIMEFRAME_VALUES.map((v) => (
          <option key={v} value={v}>{TIMEFRAME_LABELS[v]}</option>
        ))}
      </select>
    </div>
  );
}
