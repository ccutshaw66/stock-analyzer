import mascotUrl from "@/assets/mascot.jpg";
import { SearchX } from "lucide-react";

/**
 * Friendly "symbol not found" component.
 * Shows when a user types a bad ticker (e.g. "SVL" instead of "SVOL").
 */
export default function InvalidSymbol({ ticker }: { ticker?: string | null }) {
  return (
    <div
      className="flex flex-col items-center justify-center py-10 text-center bg-card border border-border rounded-xl"
      data-testid="invalid-symbol"
    >
      <img
        src={mascotUrl}
        alt="Stock Otter"
        className="h-28 w-auto mb-4 drop-shadow-lg opacity-80"
      />
      <SearchX className="h-8 w-8 text-muted-foreground mb-3" />
      <h3 className="text-lg font-bold text-foreground mb-2">
        Symbol Not Found
      </h3>
      <p className="text-sm text-muted-foreground max-w-md">
        {ticker ? (
          <>
            We couldn't find any data for <span className="font-semibold text-foreground">"{ticker}"</span>.
          </>
        ) : (
          <>We couldn't find that symbol.</>
        )}
      </p>
      <p className="text-sm text-muted-foreground max-w-md mt-1">
        Double-check the ticker spelling and try again.
      </p>
    </div>
  );
}

/**
 * Checks if an error message is a "symbol not found" 404.
 * Use this to decide whether to show <InvalidSymbol /> vs generic error.
 */
export function isSymbolNotFound(errorMessage: string): boolean {
  const msg = errorMessage.toLowerCase();
  return (
    (msg.includes("404") && (msg.includes("not found") || msg.includes("no data") || msg.includes("no chart data"))) ||
    (msg.includes("ticker") && msg.includes("not found"))
  );
}
