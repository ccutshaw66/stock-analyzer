/**
 * Default dashboard layout for new members. Server-computed so the
 * client always has something to render on first visit.
 *
 * v2 (2026-05-21) — Dashboard rebuild: the curated "5-minute morning
 * workspace" replaces the free-form widget grid. The default mounts the
 * six new compartments in O'Neil-anchored order:
 *
 *   Row 1: Morning Brief (full width banner)
 *   Row 2: Action Queue (8 cols) | Morning Checklist (4 cols)
 *   Row 3: Confluence Pulse (8 cols) | Ask Otter (4 cols)
 *   Row 4: Position News (full width)
 *
 * Legacy widgets stay in the registry as opt-in (Customize layout reveals
 * them in the toolbar) so users who had a custom layout don't lose data.
 */
import { DASHBOARD_LAYOUT_VERSION, type DashboardLayout } from "@shared/dashboard/types";

const DEFAULT_TAB_ID = "overview";

export function buildDefaultDashboardLayout(): DashboardLayout {
  return {
    version: DASHBOARD_LAYOUT_VERSION,
    activeTabId: DEFAULT_TAB_ID,
    tabs: [
      {
        id: DEFAULT_TAB_ID,
        name: "Overview",
        order: 0,
        widgets: [
          // Row 1: full-width banner (one row tall)
          { compartmentId: "morning-brief",     visible: true, x: 0, y: 0,  w: 12, h: 2 },
          // Row 2: Action Queue + Checklist
          { compartmentId: "action-queue",      visible: true, x: 0, y: 2,  w: 8,  h: 6 },
          { compartmentId: "morning-checklist", visible: true, x: 8, y: 2,  w: 4,  h: 6 },
          // Row 3: Confluence Pulse + Ask Otter
          { compartmentId: "confluence-pulse",  visible: true, x: 0, y: 8,  w: 8,  h: 6 },
          { compartmentId: "ask-otter",         visible: true, x: 8, y: 8,  w: 4,  h: 6 },
          // Row 4: Position News full-width
          { compartmentId: "position-news",     visible: true, x: 0, y: 14, w: 12, h: 5 },
        ],
      },
    ],
  };
}
