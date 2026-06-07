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
  /** If set, entry is only visible to users at or above this tier. `owner` = Chris only (Admin Playground). */
  readonly requiresTier?: "pro" | "elite" | "owner";
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

/**
 * Nav groups. Organized by INDIVIDUAL TICKER vs TICKERS-IN-GENERAL / SCANNERS
 * (Chris's rule). The research flow still reads top-to-bottom and is
 * direction-aware (Regime routes long / bearish-via-options / stand-aside):
 *   Regime (market context) → Screen (scanners: find names) → Research
 *   (everything about ONE ticker) → Setup (the chart/backtester).
 * General/scanner pages (Earnings = watchlist dates, Insider = a scanner) live
 * in Screen / Investment Opportunities, NOT in the per-ticker Research group.
 * Non-flow groups: Trade Tracker, Investment Opportunities, Calculators,
 * Experimental, Admin Playground, Help.
 */
export type NavGroup =
  | "Trade Tracker"
  | "Regime"
  | "Screen"
  | "Research"
  | "Setup"
  | "Investment Opportunities"
  | "Calculators"
  | "Experimental"
  | "Admin Playground"
  | "Help";

/**
 * The canonical page list. Order within a group = order in the sidebar.
 * To add a page: append an entry here, no other edits required.
 */
export const PAGE_REGISTRY: readonly PageEntry[] = [
  // ─── Trade Tracker ── home + manage OPEN trades (not part of the funnel) ──
  // Dashboard stays first so the landing page never moves.
  { path: "/dashboard",           label: "Dashboard",             icon: LayoutDashboard, group: "Trade Tracker", subtitle: "Your customizable Stock Otter view." },
  { path: "/tracker",             label: "Current Positions",     icon: ClipboardList,   group: "Trade Tracker", subtitle: "Your open trades with realized + unrealized P/L.", requiresTier: "pro" },
  { path: "/dividend-portfolio",  label: "Dividend Positions",    icon: Landmark,        group: "Trade Tracker", subtitle: "Dividend-paying holdings and forward income.", requiresTier: "pro" },
  { path: "#add-trade",           label: "Add Trade",             icon: Plus,            group: "Trade Tracker", action: true, requiresTier: "pro" },
  { path: "#close-trade",         label: "Close Trade",           icon: CheckCircle2,    group: "Trade Tracker", action: true, requiresTier: "pro" },
  { path: "/analytics",           label: "Performance Analytics", icon: PieChart,        group: "Trade Tracker", subtitle: "How your trades actually performed — win rate, R-multiple, drag.", requiresTier: "pro" },

  // ═══ RESEARCH FLOW — market → find → ONE ticker → set up the trade ══════
  // ─── Regime ── market context (general): "buy at all, and which way?" ──
  { path: "/market-pulse",        label: "Market Pulse",          icon: Activity,        group: "Regime", subtitle: "Macro environment — sets the direction: long, bearish-via-options, or stand aside." },
  { path: "/sectors",             label: "Sector Heatmap",        icon: Grid3X3,         group: "Regime", subtitle: "Sector strength at a glance — where the money is rotating, both ways." },

  // ─── Screen ── scanners (tickers in general): "what names qualify?" ──
  { path: "/scanner",             label: "Scanner",               icon: Radar,           group: "Screen", subtitle: "One scanner, every strategy — green-grade (80+) setups across the market." },
  { path: "/htf",                 label: "HTF Setups",            icon: Flag,            group: "Screen", subtitle: "High Tight Flag breakouts — 30%+ pole, tight flag, volume confirmation." },
  { path: "/htf/:symbol",         label: "HTF Pattern",           icon: Flag,            group: "Screen", subtitle: "Pole / flag / breakout — target, stop, 20-MA trail.", hideFromNav: true },
  { path: "/insiders",            label: "Insider Activity",      icon: Scale,           group: "Screen", subtitle: "Insider buy/sell scanner — monthly ratio across the market + ranked ticker tables.", requiresTier: "pro" },

  // ─── Research ── everything about ONE ticker (the methods) ──
  { path: "/profile",             label: "Profile",               icon: BarChart3,       group: "Research", subtitle: "Quote, fundamentals, ratings, next earnings date, and quick snapshot." },
  { path: "/institutional",       label: "Institutions",          icon: Building2,       group: "Research", subtitle: "13F-tracked institutional ownership and flows — is smart money in or out?", requiresTier: "pro" },
  { path: "/trade",               label: "Trade Analysis",        icon: Microscope,      group: "Research", subtitle: "Per-ticker signal walk-through with chart overlays." },
  { path: "/mm-exposure",         label: "MM Exposure",           icon: Crosshair,       group: "Research", subtitle: "Dealer positioning, gamma exposure, max pain — the options/bearish read: strikes + timing.", requiresTier: "elite" },
  { path: "/conviction",          label: "Trigger Check",         icon: Compass,         group: "Research", subtitle: "Final check before you pull the trigger — one verdict, direction, plain-English reasons.", requiresTier: "pro" },
  { path: "/verdict",             label: "Long-Term Outlook",     icon: Award,           group: "Research", subtitle: "Multi-horizon verdict roll-up for buy-and-hold conviction." },

  // ─── Setup ── the chart / backtester (per-ticker timing) ──
  // ONE combined chart: strategy backtester + MACD/RSI + confluence dashboard.
  { path: "/chart",               label: "Chart",                 icon: FlaskConical,    group: "Setup", subtitle: "Candles + EMAs + MACD/RSI + the multi-signal confluence read, with the strategy backtester (BBTC+VER, AMC, TFT).", requiresTier: "pro" },

  // ─── Investment Opportunities ── tickers in general: income + monitoring ──
  { path: "/earnings",            label: "Earnings Calendar",     icon: Calendar,        group: "Investment Opportunities", subtitle: "Upcoming earnings dates + expected moves across your watchlist.", requiresTier: "pro" },
  { path: "/dividends",           label: "Dividend Finder",       icon: DollarSign,      group: "Investment Opportunities", subtitle: "Discover, compare, and rank dividend-paying stocks.", requiresTier: "pro" },
  { path: "/track-record",        label: "Track Record",          icon: Trophy,          group: "Investment Opportunities", subtitle: "Every signal logged. Every outcome tracked.", requiresTier: "pro" },
  { path: "/alerts",              label: "Alerts",                icon: Bell,            group: "Investment Opportunities", subtitle: "Custom alerts on signals, levels, and verdict changes.", requiresTier: "pro" },

  // ─── Calculators ── general sizing/options math (not ticker-specific) ──
  { path: "/calculator",          label: "Options Calculator",    icon: Calculator,      group: "Calculators", subtitle: "Premium, break-even, and IV around the option chain.", requiresTier: "pro" },
  { path: "/payoff",              label: "Payoff Diagram",        icon: Spline,          group: "Calculators", subtitle: "Visualize P/L curves for any options strategy.", requiresTier: "elite" },
  { path: "/greeks",              label: "Greeks Calculator",     icon: Sigma,           group: "Calculators", subtitle: "Delta, gamma, theta, vega, rho per leg and position.", requiresTier: "elite" },
  { path: "/kelly",               label: "Kelly Criterion",       icon: Percent,         group: "Calculators", subtitle: "Position sizing from edge, win rate, and bankroll — how much to put on.", requiresTier: "pro" },

  // ─── Experimental ──────────────────────────────────────────────────────
  // Elite-only — these are bots/strategies that run on Chris's infra and represent
  // the premium automated-trading layer.
  { path: "/hermes",              label: "HERMES Auto Trader",    icon: Bot,             group: "Experimental", subtitle: "Live status, stats, and trades from the self-hosted HERMES service.", requiresTier: "elite" },
  { path: "/kairos",              label: "KAIROS Auto Trader",    icon: Rocket,          group: "Experimental", subtitle: "Experimental HTF + BBTC paper trader. Conviction-tagged entries (HTF / BBTC / BOTH).", requiresTier: "elite" },
  { path: "/wheel",               label: "Wheel Strategy",        icon: RefreshCw,       group: "Admin Playground", subtitle: "Cash-secured puts → covered calls — the wheel mechanics.", requiresTier: "owner" },

  // ─── Admin Playground ──────────────────────────────────────────────────
  // OWNER ONLY (Chris). The private workbench for unproven / in-test surfaces.
  // To retire a public surface WITHOUT deleting it: change that entry's `group`
  // to "Admin Playground" and `requiresTier` to "owner". It disappears for
  // everyone else and reappears here for the owner — one line, no deletes.
  { path: "/markov",              label: "Markov Strategy",       icon: Network,         group: "Admin Playground", subtitle: "Markov-chain regime model — Python stub awaiting implementation.", requiresTier: "owner" },
  { path: "/gamma-bot",           label: "Gamma Vol Bot",         icon: Bot,             group: "Admin Playground", subtitle: "Deterministic dealer-gamma vol paper bot — adjustable money/risk, live signals, paper P&L.", requiresTier: "owner" },
  { path: "/trend-ride-bot",      label: "Trend-Ride Bot",        icon: Rocket,          group: "Admin Playground", subtitle: "BBTC Trend-Ride paper bot — rides the trend to a significant break of the 168-EMA. Seeded from real history, real paper P&L.", requiresTier: "owner" },
  { path: "/gamma-collector",     label: "Gamma Collector",       icon: Activity,        group: "Admin Playground", subtitle: "Watch the dealer-gamma collector accumulate — progress to validation + the live gamma landscape.", requiresTier: "owner" },
  { path: "/vol-calc",            label: "Vol / Straddle Calc",   icon: Calculator,      group: "Admin Playground", subtitle: "Straddle calculator — expected move, fair prices, and sell-vol vs buy-vol P&L side by side.", requiresTier: "owner" },
  { path: "/strategy-lab",        label: "Strategy Lab",          icon: FlaskConical,    group: "Admin Playground", subtitle: "All options structures in one page — singles, verticals, covered calls, straddles, condors: P/L, break-evens, prob-of-profit, payoff, hedging.", requiresTier: "owner" },

  // ─── Help ──────────────────────────────────────────────────────────────
  { path: "/help",                label: "Help / FAQ",            icon: BookOpen,        group: "Help", subtitle: "Glossary, common questions, and how Stock Otter works." },
];

/**
 * Group order for the sidebar — controls how nav groups stack vertically.
 */
export const NAV_GROUP_ORDER: readonly NavGroup[] = [
  "Trade Tracker",
  // Research flow: market context → scanners → one ticker → set up the trade.
  "Regime",
  "Screen",
  "Research",
  "Setup",
  // General / scanners / tools.
  "Investment Opportunities",
  "Calculators",
  "Experimental",
  "Admin Playground",
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
export function getNavGroups(userTier: "free" | "pro" | "elite" | "owner" = "free"): {
  label: NavGroup;
  items: PageEntry[];
}[] {
  const tierOrder: Record<string, number> = { free: 0, pro: 1, elite: 2, owner: 3 };
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
