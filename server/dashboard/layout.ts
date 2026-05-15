/**
 * Default dashboard layout for new members. Server-computed so the
 * client always has something to render on first visit.
 *
 * The v1 default = one tab ("Overview") with all three v1 compartments
 * (Watchlist, Best Opps, My Trades) visible in a simple top-left arrangement.
 * Tab CRUD UI ships in a later round; the data model already supports
 * multiple tabs.
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
          { compartmentId: "favorites", visible: true, x: 0, y: 0, w: 3, h: 4 },
          { compartmentId: "scanner-v2", visible: true, x: 3, y: 0, w: 3, h: 4 },
          { compartmentId: "trades", visible: true, x: 6, y: 0, w: 4, h: 4 },
          { compartmentId: "confluence-chart", visible: true, x: 0, y: 4, w: 3, h: 4 },
        ],
      },
    ],
  };
}
