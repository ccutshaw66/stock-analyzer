import { AlertTriangle } from "lucide-react";

export function Disclaimer() {
  return (
    <div className="flex items-start gap-2 px-3 py-2 bg-watch/5 border border-watch/20 rounded-lg text-micro text-watch-light/80 leading-relaxed" data-testid="disclaimer">
      <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
      <span>
        <strong>Not financial advice.</strong> Stock Otter provides data and analysis tools for educational purposes only. 
        All investment decisions are yours. Past performance does not guarantee future results. Always do your own research.
      </span>
    </div>
  );
}
