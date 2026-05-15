/**
 * Client-side compartment entry. Each compartment ships a manifest + optional
 * Full view + optional Widget view. The Widget block is optional so a
 * compartment can register before its dashboard widget is built ("progressive
 * contract" — see DASHBOARD_PLAN.md P3).
 *
 * As of Round 8 (2026-05-15) WidgetView receives `config` + `onConfigChange`
 * props so widgets can read/write their per-widget JSONB config field on the
 * dashboard layout (e.g. the Confluence Chart widget stores its selected
 * timeframe in `config.timeframe`). Existing prop-less widgets continue to
 * work because both props are optional.
 */
import type { ComponentType } from "react";
import type { CompartmentMeta } from "@shared/compartments/types";

export interface WidgetSize {
  /** Grid columns (1-based). */
  w: number;
  /** Grid rows (1-based). */
  h: number;
}

export interface WidgetViewProps {
  /** Current per-widget config blob from the persisted dashboard layout. */
  config?: Record<string, unknown>;
  /** Persist a new config blob (replaces the existing one). Caller debounces. */
  onConfigChange?: (next: Record<string, unknown>) => void;
}

export interface ClientCompartmentEntry {
  meta: CompartmentMeta;
  /** Full-page React component, mounted at `meta.fullPageRoute` when present. */
  FullView?: ComponentType;
  /** Compact dashboard widget. Compartments without a dashboard widget yet omit this. */
  WidgetView?: ComponentType<WidgetViewProps>;
  /** Default grid size when a member first adds the widget to a tab. */
  widgetDefaultSize?: WidgetSize;
  /** Hard floor below which the widget refuses to render usefully. */
  widgetMinSize?: WidgetSize;
}

export type { CompartmentMeta };
