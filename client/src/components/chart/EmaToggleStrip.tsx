/**
 * EMA toggle strip — the canonical "EMA 9 / 21 / 50 / 200" button row.
 *
 * Per the universal-structure rule (2026-05-15): every TV-style chart on
 * the site uses this strip. Adds an EMA to the chart = add it to
 * `EMA_TOGGLES` in `overlays.ts`; this component picks it up automatically.
 *
 * Button color follows the EMA line color on the chart, so the user's
 * eye matches the toggle to the line at a glance. Active button is
 * tinted with the EMA color; inactive is muted.
 *
 * Example:
 *
 *   const [emaState, setEmaState] = useState<EmaToggleState>({
 *     ema9: true, ema21: true, ema50: true, ema200: false,
 *   });
 *   ...
 *   <EmaToggleStrip state={emaState} onChange={setEmaState} />
 *   <CandlePane bars={bars} overlays={emaOverlays(emaState)} />
 */
import { EMA_TOGGLES, type EmaToggleState } from "./overlays";

export type { EmaToggleState };

export function EmaToggleStrip({
  state,
  onChange,
  className,
}: {
  state: EmaToggleState;
  onChange: (next: EmaToggleState) => void;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-1 text-micro ${className ?? ""}`} data-testid="ema-toggle-strip">
      {EMA_TOGGLES.map((t) => {
        const active = state[t.key];
        return (
          <button
            key={t.key}
            onClick={() => onChange({ ...state, [t.key]: !active })}
            className={`px-1.5 py-0.5 rounded transition-colors font-medium ${
              active
                ? "text-white"
                : "bg-muted/40 text-muted-foreground hover:text-foreground"
            }`}
            style={
              active
                ? { backgroundColor: `${t.color}33`, color: t.color }
                : undefined
            }
            data-testid={`toggle-${t.key}`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
