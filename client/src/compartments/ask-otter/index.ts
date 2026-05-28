/**
 * Ask Otter compartment — paid AI Q&A agent (shell-only in v1).
 *
 * v1 ships the chat UI with a "Connect API key in Settings" placeholder.
 * Server route returns 503 unless ANTHROPIC_API_KEY is set + the user has
 * askOtterEnabled flipped on. Activating later requires no client changes.
 */
import type { ClientCompartmentEntry, CompartmentMeta } from "../types";
import { TILE_MD, TILE_MIN_MD } from "@/lib/layout-tokens";
import { AskOtterWidget } from "./AskOtterWidget";

const meta: CompartmentMeta = {
  id: "ask-otter",
  name: "Ask Otter",
  tier: "pro",
  description: "Conversational trading-question agent (Claude). v1 ships the shell — pay-per-use, enable per account.",
};

export const askOtterCompartment: ClientCompartmentEntry = {
  meta,
  WidgetView: AskOtterWidget,
  widgetDefaultSize: TILE_MD,
  widgetMinSize: TILE_MIN_MD,
};

export { meta, AskOtterWidget };
