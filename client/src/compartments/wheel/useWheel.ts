/**
 * Canonical hook for the Wheel compartment.
 *
 * Wheel is a pure calculator — there's no remote data to fetch. This hook
 * bundles the three derived blocks (metrics + chart + health) so every
 * surface (Full view, Widget, future alert preview) computes them the
 * same way through one entry point.
 *
 * For state ergonomics, callers can either:
 *   - hold their own input state and pass it in, OR
 *   - use `useWheelState()` below as a convenience.
 */
import { useMemo, useState, useCallback } from "react";
import {
  calcWheelMetrics, calcWheelChart, calcWheelHealth,
  DEFAULT_WHEEL_INPUTS,
  type WheelInputs, type WheelMetrics, type WheelChartPoint, type WheelHealth,
} from "./wheelLogic";

export interface WheelOutputs {
  metrics: WheelMetrics;
  chart: WheelChartPoint[];
  health: WheelHealth;
}

/** Read-only: given inputs, derive metrics + chart + health. Pure / memoized. */
export function useWheel(inputs: WheelInputs): WheelOutputs {
  const metrics = useMemo(() => calcWheelMetrics(inputs), [inputs]);
  const chart = useMemo(() => calcWheelChart(inputs, metrics), [inputs, metrics]);
  const health = useMemo(() => calcWheelHealth(inputs, metrics), [inputs, metrics]);
  return { metrics, chart, health };
}

/** Convenience: holds the inputs as state + exposes a patch helper. */
export function useWheelState(initial: WheelInputs = DEFAULT_WHEEL_INPUTS) {
  const [inputs, setInputs] = useState<WheelInputs>(initial);
  const update = useCallback(
    <K extends keyof WheelInputs>(k: K, v: WheelInputs[K]) =>
      setInputs((prev) => ({ ...prev, [k]: v })),
    []
  );
  const outputs = useWheel(inputs);
  return { inputs, update, ...outputs };
}
