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
 * Nav groups. The research path is a SCIENTIFIC FUNNEL: groups 1→5 are stages
 * you walk top-to-bottom, each answering one falsifiable question with a gate.
 * It is DIRECTION-AWARE — Regime routes to long (shares/calls), bearish
 * (puts/spreads via the MM/options read), or stand-aside; it is NOT long-only.
 * The non-funnel groups (Trade Tracker = manage open trades, Investment
 * Opportunities = income/monitoring, Calculators, Experimental, Admin
 * Playground, Help) sit outside the funnel. See brief_research_funnel.
 */
export type NavGroup =
  | "Trade Tracker"
  | "1 · Regime"
  | "2 · Screen"
  | "3 · Company"
  | "4 · Setup"
  | "5 · Decision"
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

  // ═══ RESEARCH FUNNEL — walk 1→5 top to bottom ═══════════════════════════
  // ─── 1 · Regime ── "Should I be buying anything — and which direction?" ──
  // The router: bullish → long/calls, bearish → puts/spreads (via MM/options),
  // chop → premium-sell or stand aside. NOT a long-only gate.
  { path: "/market-pulse",        label: "Market Pulse",          icon: Activity,        group: "1 · Regime", subtitle: "Macro environment — sets the direction: long, bearish-via-options, or stand aside." },
  { path: "/sectors",             label: "Sector Heatmap",        icon: Grid3X3,         group: "1 · Regime", subtitle: "Sector strength at a glance — where the money is rotating, both ways." },

  // ─── 2 · Screen ── "What names even qualify?" ──
  { path: "/scanner",             label: "Scanner",               icon: Radar,           group: "2 · Screen", subtitle: "One scanner, every strategy — green-grade (80+) setups across the market." },
  { path: "/htf",                 label: "HTF Setups",            icon: Flag,            group: "2 · Screen", subtitle: "High Tight Flag breakouts — 30%+ pole, tight flag, volume confirmation." },
  { path: "/htf/:symbol",         label: "HTF Pattern",           icon: Flag,            group: "2 · Screen", subtitle: "Pole / flag / breakout — target, stop, 20-MA trail.", hideFromNav: true },

  // ─── 3 · Company ── "What is it — sound, who owns it, earnings risk?" ──
  { path: "/profile",             label: "Profile",               icon: BarChart3,       group: "3 · Company", subtitle: "Quote, fundamentals, ratings, and quick snapshot." },
  { path: "/institutional",       label: "Institutions",          icon: Building2,       group: "3 · Company", subtitle: "13F-tracked institutional ownership and flows — is smart money in or out?", requiresTier: "pro" },
  { path: "/earnings",            label: "Earnings Calendar",     icon: Calendar,        group: "3 · Company", subtitle: "Upcoming earnings with expected moves — the catalyst/landmine check.", requiresTier: "pro" },
  { path: "/insiders",            label: "Insider Activity",      icon: Scale,           group: "3 · Company", subtitle: "Monthly buy/sell ratio across the market + ranked ticker tables. SEC Form 4 deep-scan coming.", requiresTier: "pro" },

  // ─── 4 · Setup ── "Is the chart/options giving a TIMED entry (either way)?" ──
  // MM Exposure is first-class here: gamma walls + max pain + dealer positioning
  // ARE the strike + timing for the options/bearish read.
  { path: "/trade",               label: "Trade Analysis",        icon: Microscope,      group: "4 · Setup", subtitle: "Per-ticker signal walk-through with chart overlays." },
  { path: "/chart/confluence",    label: "Confluence Chart",      icon: Layers,          group: "4 · Setup", subtitle: "Multi-signal verdict on a single chart — candles + EMAs + signal pulse + MACD/RSI all in one read.", requiresTier: "pro" },
  { path: "/chart",               label: "Strategy Chart",        icon: FlaskConical,    group: "4 · Setup", subtitle: "Visual backtester comparing BBTC+VER, AMC, and TFT strategy modes.", requiresTier: "pro" },
  { path: "/mm-exposure",         label: "MM Exposure",           icon: Crosshair,       group: "4 · Setup", subtitle: "Dealer positioning, gamma exposure, max pain — the options/bearish read: strikes + timing.", requiresTier: "elite" },

  // ─── 5 · Decision ── "Go/no-go: direction × instrument + size." ──
  { path: "/conviction",          label: "Trigger Check",         icon: Compass,         group: "5 · Decision", subtitle: "Final check before you pull the trigger — one verdict, direction, plain-English reasons.", requiresTier: "pro" },
  { path: "/verdict",             label: "Long-Term Outlook",     icon: Award,           group: "5 · Decision", subtitle: "Multi-horizon verdict roll-up for buy-and-hold conviction." },
  { path: "/kelly",               label: "Kelly Criterion",       icon: Percent,         group: "5 · Decision", subtitle: "Position sizing from edge, win rate, and bankroll — how much to put on.", requiresTier: "pro" },
  // ═══ END RESEARCH FUNNEL ════════════════════════════════════════════════

  // ─── Investment Opportunities ── income + monitoring (outside the funnel) ──
  { path: "/dividends",           label: "Dividend Finder",       icon: DollarSign,      group: "Investment Opportunities", subtitle: "Discover, compare, and rank dividend-paying stocks.", requiresTier: "pro" },
  { path: "/track-record",        label: "Track Record",          icon: Trophy,          group: "Investment Opportunities", subtitle: "Every signal logged. Every outcome tracked.", requiresTier: "pro" },
  { path: "/alerts",              label: "Alerts",                icon: Bell,            group: "Investment Opportunities", subtitle: "Custom alerts on signals, levels, and verdict changes.", requiresTier: "pro" },

  // ─── Calculators ── options math (outside the funnel) ──
  { path: "/calculator",          label: "Options Calculator",    icon: Calculator,      group: "Calculators", subtitle: "Premium, break-even, and IV around the option chain.", requiresTier: "pro" },
  { path: "/payoff",              label: "Payoff Diagram",        icon: Spline,          group: "Calculators", subtitle: "Visualize P/L curves for any options strategy.", requiresTier: "elite" },
  { path: "/greeks",              label: "Greeks Calculator",     icon: Sigma,           group: "Calculators", subtitle: "Delta, gamma, theta, vega, rho per leg and position.", requiresTier: "elite" },

  // ─── Experimental ──────────────────────────────────────────────────────
  // Elite-only — these are bots/strategies that run on Chris's infra and represent
  // the premium automated-trading layer.
  { path: "/hermes",              label: "HERMES Auto Trader",    icon: Bot,             group: "Experimental", subtitle: "Live status, stats, and trades from the self-hosted HERMES service.", requiresTier: "elite" },
  { path: "/kairos",              label: "KAIROS Auto Trader",    icon: Rocket,          group: "Experimental", subtitle: "Experimental HTF + BBTC paper trader. Conviction-tagged entries (HTF / BBTC / BOTH).", requiresTier: "elite" },
  { path: "/wheel",               label: "Wheel Strategy",        icon: RefreshCw,       group: "Experimental", subtitle: "Cash-secured puts → covered calls — the wheel mechanics.", requiresTier: "elite" },

  // ─── Admin Playground ──────────────────────────────────────────────────
  // OWNER ONLY (Chris). The private workbench for unproven / in-test surfaces.
  // To retire a public surface WITHOUT deleting it: change that entry's `group`
  // to "Admin Playground" and `requiresTier` to "owner". It disappears for
  // everyone else and reappears here for the owner — one line, no deletes.
  { path: "/markov",              label: "Markov Strategy",       icon: Network,         group: "Admin Playground", subtitle: "Markov-chain regime model — Python stub awaiting implementation.", requiresTier: "owner" },

  // ─── Help ──────────────────────────────────────────────────────────────
  { path: "/help",                label: "Help / FAQ",            icon: BookOpen,        group: "Help", subtitle: "Glossary, common questions, and how Stock Otter works." },
];

/**
 * Group order for the sidebar — controls how nav groups stack vertically.
 */
export const NAV_GROUP_ORDER: readonly NavGroup[] = [
  "Trade Tracker",
  // Research funnel — the scientific path, walked top to bottom.
  "1 · Regime",
  "2 · Screen",
  "3 · Company",
  "4 · Setup",
  "5 · Decision",
  // Outside the funnel.
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
