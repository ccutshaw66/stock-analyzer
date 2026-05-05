import type { Request } from "express";

export const TIMEFRAME_VALUES = ["1d", "1mo", "3mo", "6mo", "1y", "2y", "5y"] as const;
export type TimeframeValue = (typeof TIMEFRAME_VALUES)[number];

export const DEFAULT_TIMEFRAME: TimeframeValue = "1y";

export interface TimeframePreset {
  value: TimeframeValue;
  range: string;
  interval: string;
}

const PRESETS: Record<TimeframeValue, TimeframePreset> = {
  "1d":  { value: "1d",  range: "1d",  interval: "5m"  },
  "1mo": { value: "1mo", range: "1mo", interval: "1d"  },
  "3mo": { value: "3mo", range: "3mo", interval: "1d"  },
  "6mo": { value: "6mo", range: "6mo", interval: "1d"  },
  "1y":  { value: "1y",  range: "1y",  interval: "1d"  },
  "2y":  { value: "2y",  range: "2y",  interval: "1d"  },
  "5y":  { value: "5y",  range: "5y",  interval: "1d"  },
};

export function isTimeframeValue(v: unknown): v is TimeframeValue {
  return typeof v === "string" && (TIMEFRAME_VALUES as readonly string[]).includes(v);
}

export function getTimeframePreset(value: string | undefined | null): TimeframePreset {
  if (isTimeframeValue(value)) return PRESETS[value];
  return PRESETS[DEFAULT_TIMEFRAME];
}

export function parseTimeframe(req: Request): TimeframePreset {
  const raw = req.query?.timeframe;
  const v = Array.isArray(raw) ? raw[0] : raw;
  return getTimeframePreset(typeof v === "string" ? v : undefined);
}
