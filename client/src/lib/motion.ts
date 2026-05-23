/**
 * Motion tokens — named transition durations, easings, and animation defaults.
 *
 * Per the universal-structure rule (2026-05-15): every transition timing
 * and easing comes from this file. No more `duration-200` here and
 * `duration-300` there — pick a named tier.
 *
 * Numbers are in milliseconds for JS use; Tailwind utilities use the
 * matching `duration-*` class (the Tailwind config maps these names to
 * the corresponding ms).
 *
 * Tier guidance:
 *   - INSTANT (0)     — no transition (programmatic state flips that
 *                       should feel snappy, e.g. opening a panel from a click).
 *   - FAST (120)      — micro-interactions: hover, focus, ripple.
 *   - BASE (200)      — default for most UI transitions: panel toggles,
 *                       button presses, color changes.
 *   - SLOW (300)      — wider transitions: page chrome, large reveals.
 *   - PAGE (500)      — page-level fades, big layout shifts.
 *   - DRAMATIC (1000) — onboarding flourishes, celebratory transitions.
 *
 * Picking a tier: default to BASE. Use FAST for micro-feedback. Use SLOW
 * only when the motion crosses ~30% of the viewport. Anything DRAMATIC
 * should be intentional — not a default.
 */

export const DURATION_INSTANT = 0;
export const DURATION_FAST = 120;
export const DURATION_BASE = 200;
export const DURATION_SLOW = 300;
export const DURATION_PAGE = 500;
export const DURATION_DRAMATIC = 1000;

/**
 * Standard easings. The site uses `ease-out` as the dominant feel — content
 * arrives sharply and settles. `ease-in-out` is reserved for round-trip
 * animations (open → close cycles).
 */
export const EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";    // Tailwind's ease-out, slightly punched
export const EASE_IN_OUT = "cubic-bezier(0.4, 0, 0.2, 1)";  // Tailwind's default ease-in-out
export const EASE_LINEAR = "linear";                         // For continuous progress / spinners

/**
 * Chart-specific motion defaults — what the TV-style chart panes should use
 * for crosshair tracking, indicator-line redraws, and pane resize transitions.
 * Crosshair and live-data updates intentionally use INSTANT — any visible
 * lag on a chart feels wrong.
 */
export const CHART_CROSSHAIR_DURATION = DURATION_INSTANT;
export const CHART_PANE_RESIZE_DURATION = DURATION_BASE;
export const CHART_INDICATOR_TOGGLE_DURATION = DURATION_FAST;
