/**
 * Client-side compartment entry. Each compartment ships a manifest + optional
 * Full view + optional Widget view. The Widget block is optional so a
 * compartment can register before its dashboard widget is built ("progressive
 * contract" — see DASHBOARD_PLAN.md P3).
 */
import type { ComponentType } from "react";
import type { CompartmentMeta } from "@shared/compartments/types";

export interface WidgetSize {
  /** Grid columns (1-based). */
  w: number;
  /** Grid rows (1-based). */
  h: number;
}

export interface ClientCompartmentEntry {
  meta: CompartmentMeta;
  /** Full-page React component, mounted at `meta.fullPageRoute` when present. */
  FullView?: ComponentType;
  /** Compact dashboard widget. Compartments without a dashboard widget yet omit this. */
  WidgetView?: ComponentType;
  /** Default grid size when a member first adds the widget to a tab. */
  widgetDefaultSize?: WidgetSize;
  /** Hard floor below which the widget refuses to render usefully. */
  widgetMinSize?: WidgetSize;
}

export type { CompartmentMeta };
