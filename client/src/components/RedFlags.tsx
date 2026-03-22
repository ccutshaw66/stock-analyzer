import { AlertTriangle, CheckCircle2, XOctagon } from "lucide-react";

interface RedFlagsProps {
  data: any;
}

export function RedFlags({ data }: RedFlagsProps) {
  const { redFlags } = data;
  const flaggedCount = redFlags?.filter((f: any) => f.flagged).length ?? 0;

  return (
    <div className="bg-card border border-card-border rounded-lg p-6" data-testid="red-flags">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" />
          Red Flags Checklist
        </h3>
        {flaggedCount > 0 && (
          <span className="text-xs font-semibold text-red-500 bg-red-500/10 px-2 py-1 rounded">
            {flaggedCount} flagged
          </span>
        )}
      </div>

      <div className="space-y-0">
        {redFlags?.map((flag: any, i: number) => (
          <div
            key={i}
            className={`flex items-center justify-between py-3 border-b border-card-border/50 last:border-0 ${
              flag.flagged ? "bg-red-500/5 -mx-6 px-6" : ""
            }`}
            data-testid={`red-flag-${i}`}
          >
            <div className="flex items-center gap-3">
              {flag.flagged ? (
                <XOctagon className="h-4 w-4 text-red-500 shrink-0" />
              ) : (
                <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
              )}
              <span className={`text-sm ${flag.flagged ? "text-red-400 font-medium" : "text-foreground"}`}>
                {flag.label}
              </span>
            </div>
            <span className="text-xs text-muted-foreground tabular-nums ml-4 text-right">
              {flag.detail}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
