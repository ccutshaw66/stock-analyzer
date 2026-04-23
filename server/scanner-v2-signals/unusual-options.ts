/**
 * Unusual-Options detector.
 *
 * Fires when a ticker has notable unusual options activity (high vol/OI ratio
 * contracts) from its Polygon options chain snapshot. Directional bias comes
 * from the net put/call lean among the unusual contracts.
 *
 * Data source: computeMMExposure() in ../mm-exposure, preloaded only for
 * top-N candidates that pass an initial score gate (too expensive to run
 * across a 2000-symbol universe).
 *
 * Strength:
 *   - 1 unusual contract  → 0.2
 *   - 3 unusual contracts → 0.5
 *   - 6+ unusual contracts → 1.0
 *
 * Direction:
 *   - If unusual call contracts outweigh put contracts by volume → "up"
 *   - If puts dominate → "down"
 *   - Otherwise "either"
 */
import type { SignalDetector, SignalResult } from "../scanner-v2";

export const unusualOptionsDetector: SignalDetector = (ctx): SignalResult | null => {
  const mm = ctx.extras?.mmExposure;
  if (!mm) return null;

  const unusual = mm.unusual ?? [];
  if (!unusual.length) {
    return {
      id: "unusual_options",
      label: "Unusual Options",
      triggered: false,
      strength: 0,
      direction: "either",
      detail: "no unusual flow",
    };
  }

  const callVol = unusual.filter((u) => u.type === "call").reduce((a, b) => a + b.volume, 0);
  const putVol = unusual.filter((u) => u.type === "put").reduce((a, b) => a + b.volume, 0);
  const total = callVol + putVol;
  let direction: "up" | "down" | "either" = "either";
  if (total > 0) {
    const ratio = callVol / total;
    if (ratio >= 0.65) direction = "up";
    else if (ratio <= 0.35) direction = "down";
  }

  const n = unusual.length;
  let strength: number;
  if (n >= 6) strength = 1.0;
  else if (n >= 3) strength = 0.5 + ((n - 3) / 3) * 0.5;
  else strength = 0.2 + ((n - 1) / 2) * 0.3;
  strength = Math.max(0.2, Math.min(1, strength));

  return {
    id: "unusual_options",
    label: "Unusual Options",
    triggered: true,
    strength,
    direction,
    detail: `${n} contracts vol/OI>3 (${callVol.toLocaleString()}C/${putVol.toLocaleString()}P)`,
  };
};
