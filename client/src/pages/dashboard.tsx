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
import { WidgetErrorBoundary } from "@/components/WidgetErrorBoundary";
import { Loader2, X, Plus, LayoutDashboard, Settings2 } from "lucide-react";
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

/** localStorage key for the per-user "Customize layout" toggle. Hidden by
 *  default per Chris's feedback ("5 movable boxes ≠ customization"); flips
 *  on when the user clicks the toolbar toggle, persists across reloads. */
const CUSTOMIZE_STORAGE_KEY = "stockotter:dashboard:customize";

export default function Dashboard() {
  const { layout, isLoading, error, save } = useDashboardLayout();
  const [customize, setCustomize] = useState<boolean>(() => {
    try { return localStorage.getItem(CUSTOMIZE_STORAGE_KEY) === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(CUSTOMIZE_STORAGE_KEY, customize ? "1" : "0"); } catch { /* no-op */ }
  }, [customize]);
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

  // Customize toggle is always visible; hidden-widget + add-widget chips only
  // appear when customize is ON. This is the "real" customization seam now —
  // not "drag 5 boxes around the page."
  const customizeToggle = (
    <button
      onClick={() => setCustomize(c => !c)}
      className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
        customize
          ? "bg-brand-accent/20 text-brand-accent hover:bg-brand-accent/30"
          : "bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/70"
      }`}
      data-testid="dashboard-customize-toggle"
      title={customize ? "Lock layout" : "Rearrange + add/hide widgets"}
    >
      <Settings2 className="h-3 w-3" />
      {customize ? "Done" : "Customize"}
    </button>
  );

  const widgetChips = customize && (hiddenWidgets.length > 0 || availableToAdd.length > 0) ? (
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

  const toolbarChips = (
    <div className="flex items-center gap-2 flex-wrap">
      {widgetChips}
      {customizeToggle}
    </div>
  );

  return (
    <PageTemplate
      maxWidth="max-w-full"
      className="p-4 sm:p-6 space-y-4"
      headerRight={toolbarChips}
      howItWorks={
        <>
          <p>Your 5-minute morning workspace. Six tiles synthesize data from across Stockotter so you don't have to click through 4 pages to figure out what needs your attention today.</p>

          <p className="font-semibold text-foreground mt-2">What each tile shows</p>
          <ul className="list-disc pl-4 space-y-1">
            <li><strong className="text-foreground">Morning Brief</strong> (top banner): five clickable stats — market regime, count + P&L on open positions, items needing attention, fresh setups overnight, and the worst open position's drawdown vs your per-trade risk cap. Click any stat to jump to the source page.</li>
            <li><strong className="text-foreground">Action Queue</strong>: every decision you might need to make today, sorted by urgency. If there's nothing to do on a position, it doesn't appear. Empty queue = all clear.</li>
            <li><strong className="text-foreground">Morning Checklist</strong>: pre-market routine + a one-sentence focus note for the day. Two items auto-check from system state (earnings exposure + daily risk); the other four you tick after scrolling the dashboard. Logged daily with a 7-day history and streak counter.</li>
            <li><strong className="text-foreground">Confluence Pulse</strong>: five-spoke radar for the active ticker — smart money, dealer positioning, technicals, fundamentals, market regime. Click a spoke to drill into the source page.</li>
            <li><strong className="text-foreground">Position News</strong>: headlines + press releases on tickers you hold. Not a discovery scanner — situational awareness only.</li>
            <li><strong className="text-foreground">Position Insiders</strong>: Form 4 insider buy/sell transactions on tickers you hold (30-day window). Same situational-awareness rule as Position News.</li>
            <li><strong className="text-foreground">Insider Clusters</strong>: tickers across the market where 3+ insiders have bought (or sold) in the last 14 days. Discovery surface — names you may NOT yet hold. Filter buy / sell / all. 10b5-1 planned-sale filtering pending.</li>
            <li><strong className="text-foreground">Ask Otter</strong>: AI chat for trading questions. Off by default; flip on per-account in Settings to activate (paid feature).</li>
          </ul>

          <p className="font-semibold text-foreground mt-2">Why each checklist item is there</p>
          <ul className="list-disc pl-4 space-y-1">
            <li><strong className="text-foreground">Reviewed Market Pulse regime</strong> — environment dictates whether to add risk today.</li>
            <li><strong className="text-foreground">Reviewed Action Queue</strong> — manage existing positions before scanning for new ones.</li>
            <li><strong className="text-foreground">Reviewed earnings exposure</strong> (auto) — surfaces any held tickers reporting in the next 14 days. Material for option holders especially.</li>
            <li><strong className="text-foreground">Reviewed Position News</strong> — heads-up on what's happening with what you own, without inviting trade-the-news behaviour.</li>
            <li><strong className="text-foreground">Reviewed dashboard for new overnight triggers</strong> — fresh HTF / Wyckoff / BBTC setups since you last looked.</li>
            <li><strong className="text-foreground">Worst open position within per-trade risk cap</strong> (auto) — flags any single position whose drawdown exceeds your per-trade risk cap (default 5%, configurable in Trade Tracker → Settings via the `maxRiskPerTradePct` field).</li>
            <li><strong className="text-foreground">Today's focus</strong> — one-sentence intention. Tracks whether you followed your plan, not whether you made money.</li>
          </ul>

          <p className="mt-2"><strong className="text-foreground">Customize</strong> button (top-right) reveals drag-to-rearrange + hide/restore widget controls. Off by default — the curated layout is opinionated for a reason. Hidden widgets show up as toolbar chips when Customize is on.</p>
        </>
      }
    >
      <ResponsiveGridLayout
        className="layout"
        layout={rgLayout}
        cols={GRID_COLS}
        rowHeight={ROW_HEIGHT}
        isResizable={customize}
        isDraggable={customize}
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
              {customize && (
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
              )}
              <WidgetErrorBoundary widgetName={c.meta.name}>
                <WidgetView
                  config={w.config}
                  onConfigChange={(next) => updateWidgetConfig(w.compartmentId, next)}
                />
              </WidgetErrorBoundary>
            </div>
          );
        })}
      </ResponsiveGridLayout>
    </PageTemplate>
  );
}
