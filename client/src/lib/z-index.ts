/**
 * Z-index tokens — named layering tiers for the site.
 *
 * Per the universal-structure rule (2026-05-15): all stacking decisions
 * come from this file. No new `z-50` or `z-[100]` in component classes —
 * use the named Tailwind tokens defined in `tailwind.config.js` instead
 * (which read these constants).
 *
 * Tiers (low → high):
 *   - Z_BASE       (1)   — default layer above static content
 *   - Z_STICKY    (10)   — sticky in-flow elements (sticky verdict strip, etc.)
 *   - Z_DROPDOWN  (20)   — dropdowns, popovers, tooltips
 *   - Z_OVERLAY   (40)   — backdrops, scrim layers
 *   - Z_HEADER    (50)   — fixed page chrome (sidebar, top nav)
 *   - Z_MODAL     (60)   — modals, dialogs
 *   - Z_TOAST     (70)   — toasts, notifications
 *   - Z_TOOLTIP  (100)   — emergency-top layer (drag previews, highest-priority alerts)
 *
 * Picking a tier: pick the LOWEST that solves the problem. If you reach
 * for Z_TOOLTIP you're probably racing another stacking context — fix the
 * parent instead.
 */

export const Z_BASE = 1;
export const Z_STICKY = 10;
export const Z_DROPDOWN = 20;
export const Z_OVERLAY = 40;
export const Z_HEADER = 50;
export const Z_MODAL = 60;
export const Z_TOAST = 70;
export const Z_TOOLTIP = 100;
