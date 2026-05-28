/**
 * Empty state for the Confluence Chart page — branded otter mascot
 * with a friendly hook. Renders when no ticker is selected.
 */
import otterMascot from "@/assets/mascot.jpg";
import { Search } from "lucide-react";
import { useTickerNavigate } from "@/lib/useTickerNavigate";
import { useState } from "react";

export function EmptyState() {
  const tickerNavigate = useTickerNavigate();
  const [tickerInput, setTickerInput] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = tickerInput.trim().toUpperCase();
    if (t) tickerNavigate(t);
  };

  const featured = ["AAPL", "NVDA", "TSLA", "SPY", "QQQ", "AMD"];

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 py-12" data-testid="confluence-empty-state">
      <img
        src={otterMascot}
        alt="Stock Otter mascot"
        className="h-32 w-32 rounded-full object-cover ring-4 ring-primary/30 shadow-lg shadow-primary/20"
      />
      <h2 className="mt-6 text-xl font-bold text-foreground">Your otter's ready to read the gates.</h2>
      <p className="mt-2 text-sm text-muted-foreground max-w-md text-center">
        Pick a ticker — type a symbol below or click one of the featured names. The chart, signals, and
        verdict load together.
      </p>
      <form onSubmit={handleSubmit} className="mt-5 flex items-center gap-2 w-full max-w-sm">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={tickerInput}
            onChange={(e) => setTickerInput(e.target.value)}
            placeholder="Type a ticker… (e.g. AAPL)"
            className="w-full pl-9 pr-3 py-2 rounded-md bg-card border border-border text-sm font-mono uppercase placeholder:normal-case placeholder:font-sans placeholder:text-muted-foreground focus:border-primary focus:outline-none transition-colors"
            data-testid="empty-state-ticker-input"
          />
        </div>
        <button
          type="submit"
          className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
          data-testid="empty-state-submit"
        >
          Chart it
        </button>
      </form>
      <div className="mt-4 flex items-center gap-2 flex-wrap justify-center max-w-md">
        <span className="text-micro uppercase tracking-widest text-muted-foreground">Featured</span>
        {featured.map((t) => (
          <button
            key={t}
            onClick={() => tickerNavigate(t)}
            className="px-2 py-1 rounded bg-card border border-border text-xs font-mono font-semibold text-foreground hover:bg-muted hover:border-primary/50 transition-colors"
            data-testid={`empty-state-featured-${t}`}
          >
            {t}
          </button>
        ))}
      </div>
    </div>
  );
}
