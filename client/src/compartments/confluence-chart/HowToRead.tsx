/**
 * Small expandable "How to read this chart" affordance. Sits between
 * Signal Pulse and MACD/RSI panes. Explains why individual dots don't
 * all fire together — the confluence is in the composite bar at top, not
 * in every signal agreeing.
 */
import { useState } from "react";
import { HelpCircle, ChevronDown, ChevronUp } from "lucide-react";

export function HowToRead() {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-t border-border bg-muted/10">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full px-4 py-1.5 flex items-center justify-between text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
        data-testid="howto-toggle"
      >
        <span className="flex items-center gap-1.5">
          <HelpCircle className="h-3 w-3" />
          How to read this chart
        </span>
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {open && (
        <div className="px-4 pb-3 grid sm:grid-cols-2 lg:grid-cols-3 gap-3 text-[11px] text-muted-foreground">
          <div>
            <div className="text-xs font-semibold text-foreground mb-1">Candles + EMAs</div>
            Price action with 21-day and 50-day exponential moving averages.
            EMA21 above EMA50 with price above both = uptrend. Toggle the
            overlays from the legend in the top-left of the candle pane.
          </div>
          <div>
            <div className="text-xs font-semibold text-foreground mb-1">Signal Pulse</div>
            12 scanner signals plotted as dots over the last 60 days. <strong className="text-foreground">Individual dots do not all fire together — that is by design.</strong> Each detector watches for a different setup. The composite bar at the top is the actual confluence reading: tall + green = many bullish signals stacking; tall + red = many bearish.
          </div>
          <div>
            <div className="text-xs font-semibold text-foreground mb-1">MACD + RSI</div>
            Standard momentum/strength oscillators. MACD histogram above
            zero = upside momentum. RSI above 70 = overbought, below 30 =
            oversold.
          </div>
          <div>
            <div className="text-xs font-semibold text-foreground mb-1">Confluence Dashboard</div>
            Snapshot of 9 confluence checks RIGHT NOW. The bias percentage
            in the corner is the net read across all rows — that's your
            "should I look at this" number.
          </div>
          <div>
            <div className="text-xs font-semibold text-foreground mb-1">Verdict pill (bottom)</div>
            Stock Otter's 3-gate confluence engine. <strong className="text-foreground">"NO SETUP" means no signal is firing</strong> — not that you should sell. Watch for it to flip to READY → SET → GO as gates clear.
          </div>
          <div>
            <div className="text-xs font-semibold text-foreground mb-1">Timeframe</div>
            The picker top-right swaps the chart range. 3M is the default
            swing-trade view; 1M zooms in for active trading; 1Y/2Y/5Y
            show longer trends.
          </div>
        </div>
      )}
    </div>
  );
}
