/**
 * Default dashboard layout for new members. Server-computed so the
 * client always has something to render on first visit.
 *
 * 2026-05-27 (Chris): Ask Otter moved to the BOTTOM so the curated
 * morning-workspace stack (Brief → Action Queue → Position context →
 * Insider context) flows top-to-bottom without the conversational
 * widget interrupting it.
 *
 *   Row 1: Morning Brief (full width banner)
 *   Row 2: Action Queue (8 cols) | Morning Checklist (4 cols)
 *   Row 3: Position News | Position Insiders
 *   Row 4: Insider B/S Ratio | Insider Clusters
 *   Row 5: Ask Otter (full width — at the bottom)
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
          // Row 3: Position News + Position Insiders
          { compartmentId: "position-news",     visible: true, x: 0, y: 8,  w: 6,  h: 6 },
          { compartmentId: "position-insiders", visible: true, x: 6, y: 8,  w: 6,  h: 6 },
          // Row 4: Insider B/S Ratio (4 cols) + Insider Clusters (8 cols)
          { compartmentId: "insider-ratio",     visible: true, x: 0, y: 14, w: 4,  h: 6 },
          { compartmentId: "insider-clusters",  visible: true, x: 4, y: 14, w: 8,  h: 6 },
          // Row 5: Ask Otter (full width) — bottom of the stack
          { compartmentId: "ask-otter",         visible: true, x: 0, y: 20, w: 12, h: 6 },
        ],
      },
    ],
  };
}
