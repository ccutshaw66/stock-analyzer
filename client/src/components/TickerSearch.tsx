import { useState } from "react";
import { Search, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface TickerSearchProps {
  onAnalyze: (ticker: string) => void;
  isLoading: boolean;
}

export function TickerSearch({ onAnalyze, isLoading }: TickerSearchProps) {
  const [input, setInput] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (trimmed) {
      onAnalyze(trimmed);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-3 max-w-xl mx-auto" data-testid="ticker-search-form">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
        <Input
          type="text"
          placeholder="Enter ticker symbol (e.g., AAPL)"
          value={input}
          onChange={(e) => setInput(e.target.value.toUpperCase())}
          className="pl-10 h-12 text-base bg-card border-card-border font-mono tracking-wider"
          data-testid="input-ticker"
          disabled={isLoading}
        />
      </div>
      <Button
        type="submit"
        size="lg"
        className="h-12 px-8 font-semibold"
        disabled={!input.trim() || isLoading}
        data-testid="button-analyze"
      >
        {isLoading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Analyzing
          </>
        ) : (
          "Analyze"
        )}
      </Button>
    </form>
  );
}
