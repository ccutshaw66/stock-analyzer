/**
 * Design tokens — single source of truth for colors used in TypeScript code.
 *
 * COMPARTMENTALIZATION RULE: every color in the app comes from here or from
 * the matching CSS variables in `index.css`. No component may hardcode hex
 * or rgb values. `verify-work` blocks new violations.
 *
 * Two surfaces:
 *   - Tailwind classes (e.g. `bg-bull`, `text-brand-text-muted`) read from
 *     CSS variables in `index.css` — see the `colors` section there.
 *   - Chart libraries that take raw color strings (lightweight-charts,
 *     Recharts series stroke/fill, SVG attributes) import the constants
 *     below.
 *
 * If you change a color, update BOTH this file AND the matching CSS variable
 * in `client/src/index.css`. They must stay in sync.
 */

// ─── Brand surfaces — the navy palette ─────────────────────────────────────

export const BRAND_BG = "#040d22";              // deepest brand bg
export const BRAND_BG_ELEVATED = "#0a1628";     // raised surface
export const BRAND_BG_CARD = "#141829";         // card bg
export const BRAND_BG_CARD_ALT = "#0c1225";     // alt card bg
export const BRAND_SURFACE_RAISED = "#2a2f45";  // hovered/raised surface

export const BRAND_BORDER = "#1e2235";          // primary divider
export const BRAND_BORDER_STRONG = "#1e293b";   // stronger divider
export const BRAND_BORDER_SUBTLE = "#3a3f55";   // softer divider

export const BRAND_TEXT_BRIGHT = "#c4c7d4";     // body text bright
export const BRAND_TEXT_MUTED = "#8b8fa3";      // primary muted text
export const BRAND_TEXT_FADED = "#6b7084";      // secondary muted text
export const BRAND_TEXT_DIM = "#4a4f65";        // fine print / disclaimer text

export const BRAND_ACCENT = "#6366f1";          // indigo accent (CTAs, links, glow)
export const BRAND_ACCENT_DEEP = "#5558e6";     // deeper indigo (hover state)

// ─── Semantic signals — used for charts, badges, and verdict labels ────────

export const SIGNAL_BULL = "#22c55e";           // long / win / positive / ADD_LONG / green
export const SIGNAL_BEAR = "#ef4444";           // short / loss / negative / STOP_HIT / red
export const SIGNAL_WATCH = "#eab308";          // caution / WATCH_BUY / yellow
export const SIGNAL_WATCH_SHORT = "#f97316";    // WATCH_SELL / hollow orange
export const SIGNAL_REDUCE = "#14b8a6";         // REDUCE / profit-take / teal
export const SIGNAL_TREND_EXIT = "#94a3b8";     // clean trend exit / slate
export const SIGNAL_SHORT_ADD = "#d946ef";      // SHORT_ADD / magenta

export const SIGNAL_BULL_LIGHT = "#4ade80";     // lighter green (verdict score >=70)
export const SIGNAL_BEAR_LIGHT = "#f87171";     // lighter red (verdict score <40)
export const SIGNAL_WATCH_LIGHT = "#facc15";    // lighter yellow (verdict score 40-69)
export const SIGNAL_BULL_EMERALD = "#10b981";   // alt-emerald bull (used in some Recharts series)
export const SIGNAL_BULL_RADAR = "#34d399";     // light emerald (conviction radar fill)

// ─── Chart series & overlays ───────────────────────────────────────────────

// Canonical EMA palette — used across ALL TV-style charts (Confluence,
// Trade Analysis, Strategy Chart). Per Chris 2026-05-15: "if we
// compartmentalized the charts why are the EMA colors different. I like
// the trade analysis colors." One palette, every chart.
export const CHART_EMA_9 = SIGNAL_BULL;         // EMA 9   — green
export const CHART_EMA_21 = SIGNAL_WATCH_SHORT; // EMA 21  — orange
export const CHART_EMA_50 = "#06b6d4";          // EMA 50  — cyan
export const CHART_EMA_200 = "#a855f7";         // SMA 200 — purple

export const CHART_RSI = "#3b82f6";             // RSI series (blue)
export const CHART_CROSSHAIR = "#6366f1";       // primary indigo crosshair
export const CHART_CROSSHAIR_DEEP = "#5558e6";  // deeper indigo variant

export const CHART_WICK = "#6b7280";            // candle wick neutral
export const CHART_TEXT = "#a1a1aa";            // candle pane axis text
export const CHART_GRID = "#27272a";            // chart grid lines
export const CHART_GRID_DARK = "#1f2937";        // chart grid lines (deeper variant)

// ─── Misc utility colors used across pages ─────────────────────────────────

export const COLOR_WHITE = "#ffffff";
export const COLOR_BLACK = "#000000";
export const COLOR_GRAY_500 = "#888888";
export const COLOR_GRAY_LIGHT = "#cccccc";
export const COLOR_GRAY_NEUTRAL = "#64748b";    // slate-500
export const COLOR_GRAY_NEUTRAL_LIGHT = "#cbd5e1"; // slate-300
export const COLOR_GRAY_NEUTRAL_DARK = "#c4c7d4";  // alt slate

export const ACCENT_VIOLET = "#8b5cf6";         // gradient accent
export const ACCENT_INDIGO_DARK = "#5558e6";    // gradient accent
export const ACCENT_AMBER = "#fbbf24";          // alt warning amber
export const ACCENT_AMBER_DEEP = "#f59e0b";     // deeper amber (break-even line)
export const ACCENT_SKY = "#0ea5e9";            // sky blue
export const ACCENT_ADD = "#aaddff";            // pale add color

// ─── rgba() helpers for translucent overlays ───────────────────────────────

export const OVERLAY_BULL_30 = "rgba(74, 222, 128, 0.3)";   // verdict-yes glow
export const OVERLAY_WATCH_25 = "rgba(250, 204, 21, 0.25)"; // verdict-watch glow
export const OVERLAY_BEAR_30 = "rgba(248, 113, 113, 0.3)";  // verdict-no glow
export const OVERLAY_SLATE_20 = "rgba(148, 163, 184, 0.2)"; // radar grid
export const OVERLAY_BULL_40 = "rgba(34, 197, 94, 0.4)";    // volume up bar
export const OVERLAY_BEAR_40 = "rgba(239, 68, 68, 0.4)";    // volume down bar
export const OVERLAY_NEUTRAL_8 = "rgba(127, 127, 127, 0.08)"; // candle grid lines

/**
 * Convenience: full color-name index for places that want to iterate or
 * do dynamic lookups. Not commonly needed — most code imports a named
 * constant directly.
 */
export const TOKENS = {
  brandBg: BRAND_BG,
  brandBgElevated: BRAND_BG_ELEVATED,
  brandBgCard: BRAND_BG_CARD,
  brandBgCardAlt: BRAND_BG_CARD_ALT,
  brandSurfaceRaised: BRAND_SURFACE_RAISED,
  brandBorder: BRAND_BORDER,
  brandBorderStrong: BRAND_BORDER_STRONG,
  brandBorderSubtle: BRAND_BORDER_SUBTLE,
  brandTextMuted: BRAND_TEXT_MUTED,
  brandTextFaded: BRAND_TEXT_FADED,
  brandTextDim: BRAND_TEXT_DIM,
  signalBull: SIGNAL_BULL,
  signalBear: SIGNAL_BEAR,
  signalWatch: SIGNAL_WATCH,
  signalWatchShort: SIGNAL_WATCH_SHORT,
  signalReduce: SIGNAL_REDUCE,
  signalTrendExit: SIGNAL_TREND_EXIT,
  signalShortAdd: SIGNAL_SHORT_ADD,
} as const;
