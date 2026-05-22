/**
 * Morning Checklist compartment — book-anchored pre-market routine + log.
 *
 * Items + order distilled from the 16-book library synthesis
 * (memory/reference_trading_library_findings.md): O'Neil's "manage what you
 * have first" → Aziz's daily loss budget + process-over-outcome → Bennet's
 * earnings vol-crush awareness → Chris's "check the Action Queue + new
 * triggers" framing replacing the day-trader "scan for gappers" step.
 *
 * Submission writes to morning_checklist_log (one row per user per day).
 * Streak counter + last-7-days history surfaced inline.
 */
import type { ClientCompartmentEntry, CompartmentMeta } from "../types";
import { TILE_MD, TILE_MIN_MD } from "@/lib/layout-tokens";
import { MorningChecklistWidget } from "./MorningChecklistWidget";

const meta: CompartmentMeta = {
  id: "morning-checklist",
  name: "Morning Checklist",
  tier: "free",
  description: "Pre-market routine + daily log. Book-anchored items, one-sentence focus note, 7-day history.",
};

export const morningChecklistCompartment: ClientCompartmentEntry = {
  meta,
  WidgetView: MorningChecklistWidget,
  widgetDefaultSize: TILE_MD,
  widgetMinSize: TILE_MIN_MD,
};

export { meta, MorningChecklistWidget };
