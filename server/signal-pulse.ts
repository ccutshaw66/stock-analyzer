/**
 * Signal Pulse — 60-day evaluation of all 12 Scanner 2.0 detectors for one ticker.
 * Returns per-day rows of {composite, bullishCount, bearishCount, perSignal[]}
 * suitable for the SignalPulse oscillator on the scanner page.
 *
 * Catalyst detectors that require ctx.extras (earnings/analyst/insider/options/
 * gamma/small_float) are not replayable historically — they are returned as
 * "live only" and evaluated only for the most recent bar using live extras.
 */

import { data as marketData } from "./data";
import { bbSqueezeDetector } from "./scanner-v2-signals/bb-squeeze";
import { atrExpansionDetector } from "./scanner-v2-signals/atr-expansion";
import { relVolumeDetector } from "./scanner-v2-signals/rel-volume";
import { breakout52wDetector } from "./scanner-v2-signals/breakout-52w";
import { gapHoldDetector } from "./scanner-v2-signals/gap-hold";
import { fibPullbackDetector } from "./scanner-v2-signals/fib-pullback";
import type { SignalDetector, ScanContext } from "./scanner-v2";

export const PULSE_TECHNICAL: { id: string; label: string; fn: SignalDetector }[] = [
  { id: "bb_squeeze",    label: "BB Squeeze",    fn: bbSqueezeDetector },
  { id: "atr_expansion", label: "ATR Expansion", fn: atrExpansionDetector },
  { id: "rel_volume",    label: "Rel Volume",    fn: relVolumeDetector },
  { id: "breakout_52w",  label: "52w Breakout",  fn: breakout52wDetector },
  { id: "gap_hold",      label: "Gap Hold",      fn: gapHoldDetector },
  { id: "fib_pullback",  label: "Fib Pullback",  fn: fibPullbackDetector },
];

export const PULSE_CATALYSTS: { id: string; label: string }[] = [
  { id: "earnings_soon",    label: "Earnings Soon" },
  { id: "analyst_action",   label: "Analyst Action" },
  { id: "insider_cluster",  label: "Insider Cluster" },
  { id: "unusual_options",  label: "Unusual Options" },
  { id: "gamma_squeeze",    label: "Gamma Squeeze" },
  { id: "small_float",      label: "Small Float" },
];

const HISTORY_WINDOW = 260;
const DAYS_RETURNED = 60;

export interface PulseDay {
  t: number;                    // unix ms (bar close)
  date: string;                 // YYYY-MM-DD
  close: number;
  composite: number;            // bullish triggers - bearish triggers (per-technical)
  bullishCount: number;
  bearishCount: number;
  perSignal: Array<{
    id: string;
    label: string;
    triggered: boolean;
    direction: "up" | "down" | "either";
    strength: number;           // 0-1
  }>;
}

export interface PulseResponse {
  ticker: string;
  days: PulseDay[];
  catalysts: Array<{ id: string; label: string; triggered: boolean | null; note?: string }>;
  summary: {
    lastComposite: number;
    avgComposite10d: number;
    trend: "up" | "down" | "flat";
    zeroCross: "bullish" | "bearish" | null;
  };
}

export async function runSignalPulse(ticker: string): Promise<PulseResponse | null> {
  const sym = ticker.toUpperCase();
  const now = new Date();
  const from = new Date(now.getTime() - 18 * 30 * 24 * 60 * 60 * 1000); // ~18 months to fill 260-bar window + 60 output days

  const bars = await marketData.getAggregates(sym, from, now, "day");
  if (!Array.isArray(bars) || bars.length < HISTORY_WINDOW + 5) return null;

  const days: PulseDay[] = [];
  const startIdx = Math.max(HISTORY_WINDOW, bars.length - DAYS_RETURNED);

  for (let i = startIdx; i < bars.length; i++) {
    const window = bars.slice(i - HISTORY_WINDOW, i + 1);
    const bar = bars[i];
    const ctx: ScanContext = {
      bars: window,
      basics: {
        symbol: sym,
        price: bar.c,
        marketCap: 0,
        volume: bar.v,
        sector: "",
      },
    };

    const perSignal: PulseDay["perSignal"] = [];
    let bull = 0, bear = 0;

    for (const det of PULSE_TECHNICAL) {
      let r;
      try { r = det.fn(ctx); } catch { r = null; }
      const triggered = !!(r && r.triggered);
      const dir: "up" | "down" | "either" = r?.direction || "either";
      const strength = r?.strength || 0;

      if (triggered) {
        if (dir === "up") bull++;
        else if (dir === "down") bear++;
        else bull += 0.5; // "either" counts as mildly bullish
      }

      perSignal.push({
        id: det.id,
        label: det.label,
        triggered,
        direction: dir,
        strength,
      });
    }

    days.push({
      t: bar.t,
      date: new Date(bar.t).toISOString().slice(0, 10),
      close: bar.c,
      composite: Number((bull - bear).toFixed(2)),
      bullishCount: bull,
      bearishCount: bear,
      perSignal,
    });
  }

  // Summary
  const lastComposite = days[days.length - 1]?.composite || 0;
  const last10 = days.slice(-10);
  const avgComposite10d = last10.length
    ? Number((last10.reduce((a, d) => a + d.composite, 0) / last10.length).toFixed(2))
    : 0;
  const prev = days[days.length - 6]?.composite || 0;
  const trend: "up" | "down" | "flat" =
    lastComposite > prev + 0.5 ? "up" : lastComposite < prev - 0.5 ? "down" : "flat";

  // Zero-cross in last 5 days
  let zeroCross: "bullish" | "bearish" | null = null;
  for (let i = Math.max(1, days.length - 5); i < days.length; i++) {
    const a = days[i - 1].composite;
    const b = days[i].composite;
    if (a <= 0 && b > 0) zeroCross = "bullish";
    else if (a >= 0 && b < 0) zeroCross = "bearish";
  }

  // Catalysts — shown as "live only" stubs (we don't have historical catalyst
  // feeds). Triggered=null indicates "not replayable".
  const catalysts = PULSE_CATALYSTS.map(c => ({
    id: c.id,
    label: c.label,
    triggered: null as boolean | null,
    note: "Live only — not replayable historically",
  }));

  return {
    ticker: sym,
    days,
    catalysts,
    summary: { lastComposite, avgComposite10d, trend, zeroCross },
  };
}
