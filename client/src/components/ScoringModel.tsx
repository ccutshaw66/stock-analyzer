import { Award } from "lucide-react";
import { getScoreBgColor, getScoreColor } from "@/lib/format";

interface ScoringModelProps {
  data: any;
}

export function ScoringModel({ data }: ScoringModelProps) {
  const { scoring, score } = data;

  return (
    <div className="bg-card border border-card-border rounded-lg p-6" data-testid="scoring-model">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4 flex items-center gap-2">
        <Award className="h-4 w-4" />
        Scoring Model
      </h3>

      <div className="space-y-4">
        {scoring?.map((cat: any, i: number) => (
          <div key={i} className="space-y-1.5" data-testid={`scoring-category-${i}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm text-foreground font-medium">{cat.name}</span>
                <span className="text-xs text-muted-foreground">({(cat.weight * 100).toFixed(0)}%)</span>
              </div>
              <span className={`text-sm font-bold tabular-nums ${getScoreColor(cat.score)}`}>
                {cat.score.toFixed(1)}
              </span>
            </div>
            <div className="relative h-2 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full score-bar-fill ${getScoreBgColor(cat.score)}`}
                style={{ "--score-width": `${cat.score * 10}%` } as React.CSSProperties}
              />
            </div>
            <p className="text-xs text-muted-foreground">{cat.reasoning}</p>
          </div>
        ))}
      </div>

      {/* Weighted Total */}
      <div className="mt-6 pt-4 border-t border-card-border flex items-center justify-between">
        <span className="text-base font-bold text-foreground">Weighted Total</span>
        <span className={`text-2xl font-bold tabular-nums ${getScoreColor(score)}`} data-testid="text-weighted-score">
          {score.toFixed(2)} <span className="text-sm text-muted-foreground font-normal">/ 10</span>
        </span>
      </div>
    </div>
  );
}
