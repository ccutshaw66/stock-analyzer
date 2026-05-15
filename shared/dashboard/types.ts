/**
 * Dashboard layout types — shared between client and server.
 *
 * Persisted as a JSONB blob in `dashboard_layouts.data`. Schema is
 * additive-forward (versioned + optional fields) so future rounds can
 * extend without migrations.
 */

export const DASHBOARD_LAYOUT_VERSION = 1 as const;

export interface WidgetSpec {
  /** Matches `CompartmentMeta.id` — the compartment whose WidgetView renders here. */
  compartmentId: string;
  /** Whether the widget shows on the dashboard right now. Hidden widgets retain x/y/w/h for restore. */
  visible: boolean;
  /** Grid column (0-based, react-grid-layout). */
  x: number;
  /** Grid row (0-based). */
  y: number;
  /** Width in grid units. */
  w: number;
  /** Height in grid units. */
  h: number;
  /** Per-widget configuration (filters, thresholds, etc.) — future-extensible. */
  config?: Record<string, unknown>;
}

export interface TabSpec {
  /** Stable id (nanoid or similar). */
  id: string;
  /** Human-readable name shown on the tab strip. */
  name: string;
  /** Tab order on the strip (0 = leftmost). */
  order: number;
  widgets: WidgetSpec[];
}

export interface DashboardLayout {
  version: typeof DASHBOARD_LAYOUT_VERSION;
  tabs: TabSpec[];
  /** Last-active tab id, for restoring user position on next visit. */
  activeTabId?: string;
}
