import { Zap, CheckCircle2, XCircle, MinusCircle } from "lucide-react";
import { getIndicatorColor } from "@/lib/format";

interface DecisionShortcutProps {
  data: any;
}

export function DecisionShortcut({ data }: DecisionShortcutProps) {
  const { decisionShortcut } = data;
  const noCount = decisionShortcut?.filter((q: any) => q.answer === "No").length ?? 0;

  return (
    <div className="bg-card border border-card-border rounded-lg p-6" data-testid="decision-shortcut">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Zap className="h-4 w-4" />
          One-Pass Decision Shortcut
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">No answers:</span>
          <span className={`text-sm font-bold tabular-nums ${noCount >= 2 ? "text-red-500" : "text-green-500"}`}>
            {noCount} / {decisionShortcut?.length ?? 7}
          </span>
        </div>
      </div>

      {noCount >= 2 && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2 mb-4 text-sm text-red-400">
          ⚠ Warning: 2 or more "No" answers — consider WATCH or NO verdict.
        </div>
      )}

      <div className="space-y-0">
        {decisionShortcut?.map((q: any, i: number) => {
          const Icon = q.answer === "Yes" ? CheckCircle2 : q.answer === "No" ? XCircle : MinusCircle;
          return (
            <div
              key={i}
              className="flex items-center justify-between py-3 border-b border-card-border/50 last:border-0"
              data-testid={`decision-question-${i}`}
            >
              <span className="text-sm text-foreground">{q.question}</span>
              <div className="flex items-center gap-2 ml-4">
                <Icon className={`h-4 w-4 ${getIndicatorColor(q.color)}`} />
                <span className={`text-sm font-semibold ${getIndicatorColor(q.color)}`}>
                  {q.answer}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
