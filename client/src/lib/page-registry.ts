/**
 * Page registry — single source of truth for page metadata.
 *
 * Per the universal-structure rule (2026-05-15): a page's icon, label,
 * route, and group must live in ONE place so the sidebar nav and the
 * page-header chrome can never drift. Adding a new page is one entry
 * here — the sidebar picks it up automatically, and `<PageHeader />`
 * (without props) auto-resolves icon + title + subtitle by matching
 * the current route to this registry.
 *
 * For tier-gated entries (e.g. MM Exposure is non-free), the consumer
 * (sidebar) checks `requiresTier` against the user's tier — keep the
 * gate in one place rather than scattering conditionals.
 */
import type { LucideIcon } from "lucide-react";
import {
  Activity, Award, BarChart3, Bell, BookOpen, Bot, Building2, Calculator,
  Calendar, CheckCircle2, ClipboardList, Compass, Crosshair, DollarSign,
  Flag, FlaskConical, Grid3X3, Landmark, Layers, LayoutDashboard, Microscope,
  Network, Percent, PieChart, Plus, Radar, RefreshCw, Rocket, Scale, Sigma, Spline, Trophy,
} from "lucide-react";

export interface PageEntry {
  /** Route path, e.g. "/scanner". Also matched by PageHeader to auto-resolve metadata. */
  readonly path: string;
  /** Label shown in the sidebar and as the page title. */
  readonly label: string;
  /** Icon used in BOTH the sidebar and the PageHeader. */
  readonly icon: LucideIcon;
  /** Nav group the entry appears in. */
  readonly group: NavGroup;
  /** Optional subtitle shown under the title in the PageHeader. */
  readonly subtitle?: string;
  /** If set, entry is only visible to users at or above this tier. */
  readonly requiresTier?: "starter" | "premium";
  /** Pseudo-routes for sidebar-only actions (modals); not real pages. Skipped by PageHeader auto-match. */
  readonly action?: true;
  /**
   * Hide from the sidebar nav, but keep the metadata so PageHeader still
   * auto-resolves the title when the route is reached via click-through
   * (e.g. /htf/:symbol pattern chart — only useful as a target from the
   * /htf Setups + buttons, not as a top-level destination).
   */
  readonly hideFromNav?: true;
}

export type NavGroup =
  | "Trade Tracker"
  | "Company Research"
  | "Investment Opportunities"
  | "Calculators"
  | "Experimental"
  | "Help";

/**
 * The canonical page list. Order within a group = order in the sidebar.
 * To add a page: append an entry here, no other edits required.
 */
export const PAGE_REGISTRY: readonly PageEntry[] = [
  // ─── Trade Tracker ─────────────────────────────────────────────────────
  { path: "/dashboard",           label: "Dashboard",             icon: LayoutDashboard, group: "Trade Tracker", subtitle: "Your customizable Stock Otter view." },
  { path: "/market-pulse",        label: "Market Pulse",          icon: Activity,        group: "Trade Tracker", subtitle: "Macro environment at a glance — measured, not narrated." },
  { path: "/tracker",             label: "Current Positions",     icon: ClipboardList,   group: "Trade Tracker", subtitle: "Your open trades with realized + unrealized P/L." },
  { path: "/dividend-portfolio",  label: "Dividend Positions",    icon: Landmark,        group: "Trade Tracker", subtitle: "Dividend-paying holdings and forward income." },
  { path: "#add-trade",           label: "Add Trade",             icon: Plus,            group: "Trade Tracker", action: true },
  { path: "#close-trade",         label: "Close Trade",           icon: CheckCircle2,    group: "Trade Tracker", action: true },
  { path: "/analytics",           label: "Performance Analytics", icon: PieChart,        group: "Trade Tracker", subtitle: "How your trades actually performed — win rate, R-multiple, drag." },

  // ─── Company Research ──────────────────────────────────────────────────
  { path: "/profile",             label: "Profile",               icon: BarChart3,       group: "Company Research", subtitle: "Quote, fundamentals, ratings, and quick snapshot." },
  { path: "/trade",               label: "Trade Analysis",        icon: Microscope,      group: "Company Research", subtitle: "Per-ticker signal walk-through with chart overlays." },
  { path: "/chart/confluence",    label: "Confluence Chart",      icon: Layers,          group: "Company Research", subtitle: "Multi-signal verdict on a single chart — candles + EMAs + signal pulse + MACD/RSI all in one read." },
  { path: "/chart",               label: "Strategy Chart",        icon: FlaskConical,    group: "Company Research", subtitle: "Visual backtester comparing BBTC+VER, AMC, and TFT strategy modes." },
  { path: "/mm-exposure",         label: "MM Exposure",           icon: Crosshair,       group: "Company Research", subtitle: "Dealer positioning, gamma exposure, max pain.", requiresTier: "starter" },
  { path: "/institutional",       label: "Institutions",          icon: Building2,       group: "Company Research", subtitle: "13F-tracked institutional ownership and flows." },
  { path: "/conviction",          label: "Conviction Compass",    icon: Compass,         group: "Company Research", subtitle: "Smart money + dealers + technicals + fundamentals on a single radar." },
  { path: "/verdict",             label: "Long-Term Outlook",     icon: Award,           group: "Company Research", subtitle: "Multi-horizon verdict roll-up for buy-and-hold conviction." },

  // ─── Investment Opportunities ──────────────────────────────────────────
  { path: "/scanner",             label: "Scanner",               icon: Radar,           group: "Investment Opportunities", subtitle: "Confluence-based explosion detector across the universe." },
  { path: "/htf",                 label: "HTF Setups",            icon: Flag,            group: "Investment Opportunities", subtitle: "High Tight Flag breakouts — 30%+ pole, tight flag, volume confirmation." },
  { path: "/htf/:symbol",         label: "HTF Pattern",           icon: Flag,            group: "Investment Opportunities", subtitle: "Pole / flag / breakout — target, stop, 20-MA trail.", hideFromNav: true },
  { path: "/sectors",             label: "Sector Heatmap",        icon: Grid3X3,         group: "Investment Opportunities", subtitle: "Sector strength at a glance." },
  { path: "/earnings",            label: "Earnings Calendar",     icon: Calendar,        group: "Investment Opportunities", subtitle: "Upcoming earnings with expected moves." },
  { path: "/dividends",           label: "Dividend Finder",       icon: DollarSign,      group: "Investment Opportunities", subtitle: "Discover, compare, and rank dividend-paying stocks." },
  { path: "/track-record",        label: "Track Record",          icon: Trophy,          group: "Investment Opportunities", subtitle: "Every signal logged. Every outcome tracked." },
  { path: "/insiders",            label: "Insider Activity",      icon: Scale,           group: "Investment Opportunities", subtitle: "Monthly buy/sell ratio across the market + ranked ticker tables. SEC Form 4 deep-scan coming." },
  { path: "/alerts",              label: "Alerts",                icon: Bell,            group: "Investment Opportunities", subtitle: "Custom alerts on signals, levels, and verdict changes." },

  // ─── Calculators ───────────────────────────────────────────────────────
  { path: "/calculator",          label: "Options Calculator",    icon: Calculator,      group: "Calculators", subtitle: "Premium, break-even, and IV around the option chain." },
  { path: "/payoff",              label: "Payoff Diagram",        icon: Spline,          group: "Calculators", subtitle: "Visualize P/L curves for any options strategy." },
  { path: "/greeks",              label: "Greeks Calculator",     icon: Sigma,           group: "Calculators", subtitle: "Delta, gamma, theta, vega, rho per leg and position." },
  { path: "/kelly",               label: "Kelly Criterion",       icon: Percent,         group: "Calculators", subtitle: "Position sizing from edge, win rate, and bankroll." },

  // ─── Experimental ──────────────────────────────────────────────────────
  { path: "/hermes",              label: "HERMES Auto Trader",    icon: Bot,             group: "Experimental", subtitle: "Live status, stats, and trades from the self-hosted HERMES service." },
  { path: "/kairos",              label: "KAIROS Auto Trader",    icon: Rocket,          group: "Experimental", subtitle: "Experimental HTF + BBTC paper trader. Conviction-tagged entries (HTF / BBTC / BOTH)." },
  { path: "/wheel",               label: "Wheel Strategy",        icon: RefreshCw,       group: "Experimental", subtitle: "Cash-secured puts → covered calls — the wheel mechanics." },
  { path: "/markov",              label: "Markov Strategy",       icon: Network,         group: "Experimental", subtitle: "Markov-chain regime model — Python stub awaiting implementation." },

  // ─── Help ──────────────────────────────────────────────────────────────
  { path: "/help",                label: "Help / FAQ",            icon: BookOpen,        group: "Help", subtitle: "Glossary, common questions, and how Stock Otter works." },
];

/**
 * Group order for the sidebar — controls how nav groups stack vertically.
 */
export const NAV_GROUP_ORDER: readonly NavGroup[] = [
  "Trade Tracker",
  "Company Research",
  "Investment Opportunities",
  "Calculators",
  "Experimental",
  "Help",
];

/**
 * Look up the page entry for the current route.
 *
 * Matches the longest-prefix entry — so `/chart/confluence/AAPL` resolves
 * to the `/chart/confluence` entry, not `/chart`. Skips `action` pseudo-
 * entries (`#add-trade` etc.) since those aren't real routes.
 */
export function lookupPageByPath(currentPath: string): PageEntry | undefined {
  const candidates = PAGE_REGISTRY
    .filter((p) => !p.action && currentPath.startsWith(p.path))
    .sort((a, b) => b.path.length - a.path.length);
  return candidates[0];
}

/**
 * Return all entries grouped for sidebar rendering, with tier filtering applied.
 */
export function getNavGroups(userTier: "free" | "starter" | "premium" = "free"): {
  label: NavGroup;
  items: PageEntry[];
}[] {
  const tierOrder: Record<string, number> = { free: 0, starter: 1, premium: 2 };
  return NAV_GROUP_ORDER.map((group) => ({
    label: group,
    items: PAGE_REGISTRY.filter((p) => {
      if (p.group !== group) return false;
      if (p.hideFromNav) return false;
      if (!p.requiresTier) return true;
      return tierOrder[userTier] >= tierOrder[p.requiresTier];
    }),
  })).filter((g) => g.items.length > 0);
}
