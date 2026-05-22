/**
 * /dashboard — per-member customizable dashboard.
 *
 * v1: one default tab ("Overview") with the three v1 widgets (Watchlist,
 * Best Opps, My Trades). Members can drag widgets to reorder, hide
 * individual widgets via the X in each widget header, and restore hidden
 * widgets via the toolbar button. Layout auto-saves to the server.
 *
 * Phase 1B Round 7. Multi-tab CRUD UI ships in a later round; the data
 * model already supports it (`shared/dashboard/types.ts`).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import GridLayout, { WidthProvider, type Layout } from "react-grid-layout";
import { useDashboardLayout } from "@/lib/dashboard/useDashboardLayout";
import { listWidgetCompartments } from "@/compartments/registry";
import { PageHeader } from "@/components/PageHeader";
import { PageTemplate } from "@/components/PageTemplate";
import { Loader2, X, Plus, LayoutDashboard } from "lucide-react";
import type { DashboardLayout, TabSpec, WidgetSpec } from "@shared/dashboard/types";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

const ResponsiveGridLayout = WidthProvider(GridLayout);
const GRID_COLS = 12;
const ROW_HEIGHT = 60;

function findActiveTab(layout: DashboardLayout): TabSpec | undefined {
  if (layout.activeTabId) {
    const t = layout.tabs.find((x) => x.id === layout.activeTabId);
    if (t) return t;
  }
  return layout.tabs[0];
}

/** Replace one tab's widgets and return a new layout object. */
function withUpdatedTab(layout: DashboardLayout, tabId: string, nextWidgets: WidgetSpec[]): DashboardLayout {
  return {
    ...layout,
    tabs: layout.tabs.map((t) => (t.id === tabId ? { ...t, widgets: nextWidgets } : t)),
  };
}

export default function Dashboard() {
  const { layout, isLoading, error, save } = useDashboardLayout();
  const compartments = useMemo(() => listWidgetCompartments(), []);
  const compartmentMap = useMemo(() => {
    const m = new Map<string, (typeof compartments)[number]>();
    for (const c of compartments) m.set(c.meta.id, c);
    return m;
  }, [compartments]);

  // Local mirror of the server layout, edited optimistically and pushed
  // back on every change. Initialized from server on first load.
  const [localLayout, setLocalLayout] = useState<DashboardLayout | undefined>(undefined);
  useEffect(() => {
    if (layout && !localLayout) setLocalLayout(layout);
  }, [layout, localLayout]);

  const activeTab = localLayout ? findActiveTab(localLayout) : undefined;
  const visibleWidgets = useMemo(() => activeTab?.widgets.filter((w) => w.visible) ?? [], [activeTab]);
  const hiddenWidgets = useMemo(() => activeTab?.widgets.filter((w) => !w.visible) ?? [], [activeTab]);

  // Compartments in the registry that aren't in this tab at all — surfaced as
  // "Add" chips alongside hidden widgets. Lets users mount newly-released
  // compartments without resetting their saved layout.
  const availableToAdd = useMemo(() => {
    if (!activeTab) return [] as typeof compartments;
    const inTab = new Set(activeTab.widgets.map((w) => w.compartmentId));
    return compartments.filter((c) => !inTab.has(c.meta.id));
  }, [activeTab, compartments]);

  // Persist whenever local layout diverges from server layout.
  const persist = useCallback(
    (next: DashboardLayout) => {
      setLocalLayout(next);
      save(next);
    },
    [save],
  );

  const handleLayoutChange = useCallback(
    (nextRgLayout: Layout[]) => {
      if (!localLayout || !activeTab) return;
      const byId = new Map(nextRgLayout.map((l) => [l.i, l] as const));
      const updated = activeTab.widgets.map((w) => {
        const pos = byId.get(w.compartmentId);
        if (!pos) return w;
        if (pos.x === w.x && pos.y === w.y && pos.w === w.w && pos.h === w.h) return w;
        return { ...w, x: pos.x, y: pos.y, w: pos.w, h: pos.h };
      });
      // Only persist if something actually changed (react-grid-layout fires onLayoutChange on every mount).
      const changed = updated.some((w, i) => w !== activeTab.widgets[i]);
      if (!changed) return;
      persist(withUpdatedTab(localLayout, activeTab.id, updated));
    },
    [localLayout, activeTab, persist],
  );

  const hideWidget = useCallback(
    (compartmentId: string) => {
      if (!localLayout || !activeTab) return;
      const updated = activeTab.widgets.map((w) =>
        w.compartmentId === compartmentId ? { ...w, visible: false } : w,
      );
      persist(withUpdatedTab(localLayout, activeTab.id, updated));
    },
    [localLayout, activeTab, persist],
  );

  const showWidget = useCallback(
    (compartmentId: string) => {
      if (!localLayout || !activeTab) return;
      const updated = activeTab.widgets.map((w) =>
        w.compartmentId === compartmentId ? { ...w, visible: true } : w,
      );
      persist(withUpdatedTab(localLayout, activeTab.id, updated));
    },
    [localLayout, activeTab, persist],
  );

  const addWidget = useCallback(
    (compartmentId: string) => {
      if (!localLayout || !activeTab) return;
      const c = compartmentMap.get(compartmentId);
      if (!c) return;
      const w = c.widgetDefaultSize?.w ?? 4;
      const h = c.widgetDefaultSize?.h ?? 4;
      // Place at y=999; react-grid-layout's vertical compact will pack it
      // into the first available row.
      const next: WidgetSpec = { compartmentId, visible: true, x: 0, y: 999, w, h };
      const updated = [...activeTab.widgets, next];
      persist(withUpdatedTab(localLayout, activeTab.id, updated));
    },
    [localLayout, activeTab, persist, compartmentMap],
  );

  const updateWidgetConfig = useCallback(
    (compartmentId: string, nextConfig: Record<string, unknown>) => {
      if (!localLayout || !activeTab) return;
      const updated = activeTab.widgets.map((w) =>
        w.compartmentId === compartmentId ? { ...w, config: nextConfig } : w,
      );
      persist(withUpdatedTab(localLayout, activeTab.id, updated));
    },
    [localLayout, activeTab, persist],
  );

  if (isLoading || !localLayout) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <PageHeader title="Dashboard" icon={LayoutDashboard} />
        <div className="text-sm text-bear mt-4">Failed to load dashboard layout: {(error as Error).message}</div>
      </div>
    );
  }

  if (!activeTab) {
    return (
      <div className="p-6">
        <PageHeader title="Dashboard" icon={LayoutDashboard} />
        <div className="text-sm text-muted-foreground mt-4">No tabs configured.</div>
      </div>
    );
  }

  const rgLayout: Layout[] = visibleWidgets.map((w) => ({
    i: w.compartmentId,
    x: w.x,
    y: w.y,
    w: w.w,
    h: w.h,
    minW: compartmentMap.get(w.compartmentId)?.widgetMinSize?.w ?? 2,
    minH: compartmentMap.get(w.compartmentId)?.widgetMinSize?.h ?? 2,
  }));

  const toolbarChips = (hiddenWidgets.length > 0 || availableToAdd.length > 0) ? (
    <div className="flex items-center gap-1.5 flex-wrap">
      {hiddenWidgets.map((w) => {
        const c = compartmentMap.get(w.compartmentId);
        if (!c) return null;
        return (
          <button
            key={`show-${w.compartmentId}`}
            onClick={() => showWidget(w.compartmentId)}
            className="flex items-center gap-1 px-2 py-1 rounded bg-muted hover:bg-muted/70 text-xs text-foreground"
            data-testid={`button-show-${w.compartmentId}`}
          >
            <Plus className="h-3 w-3" />
            {c.meta.name}
          </button>
        );
      })}
      {availableToAdd.map((c) => (
        <button
          key={`add-${c.meta.id}`}
          onClick={() => addWidget(c.meta.id)}
          className="flex items-center gap-1 px-2 py-1 rounded bg-primary/20 hover:bg-primary/30 text-xs text-primary"
          data-testid={`button-add-${c.meta.id}`}
        >
          <Plus className="h-3 w-3" />
          {c.meta.name}
        </button>
      ))}
    </div>
  ) : null;

  return (
    <PageTemplate
      maxWidth="max-w-full"
      className="p-4 sm:p-6 space-y-4"
      headerRight={toolbarChips}
      howItWorks={
        <>
          <p>Your customizable Stock Otter view. Drag widgets to rearrange them, click the X in a widget header to hide it, or use the Add buttons in the toolbar to mount new compartments.</p>
          <p>Layout auto-saves to the server so your view persists across browsers and devices.</p>
          <p>Hidden widgets show up as chips in the toolbar — click one to restore it. New compartments released by Stock Otter appear there too, so you can opt-in without resetting your existing layout.</p>
        </>
      }
    >
      <ResponsiveGridLayout
        className="layout"
        layout={rgLayout}
        cols={GRID_COLS}
        rowHeight={ROW_HEIGHT}
        isResizable={false}
        isDraggable={true}
        compactType="vertical"
        margin={[12, 12]}
        draggableHandle=".widget-drag-handle"
        draggableCancel=".widget-no-drag"
        onLayoutChange={handleLayoutChange}
      >
        {visibleWidgets.map((w) => {
          const c = compartmentMap.get(w.compartmentId);
          if (!c?.WidgetView) return <div key={w.compartmentId} />;
          const WidgetView = c.WidgetView;
          return (
            <div
              key={w.compartmentId}
              className="bg-card border border-border rounded-md shadow-sm overflow-hidden relative"
              data-testid={`widget-${w.compartmentId}`}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  hideWidget(w.compartmentId);
                }}
                onMouseDown={(e) => e.stopPropagation()}
                className="widget-no-drag absolute top-1 right-1 z-10 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50"
                data-testid={`button-hide-${w.compartmentId}`}
                aria-label={`Hide ${c.meta.name}`}
              >
                <X className="h-3 w-3" />
              </button>
              <WidgetView
                config={w.config}
                onConfigChange={(next) => updateWidgetConfig(w.compartmentId, next)}
              />
            </div>
          );
        })}
      </ResponsiveGridLayout>
    </PageTemplate>
  );
}
