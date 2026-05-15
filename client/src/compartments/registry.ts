/**
 * Client compartment registry. One import + one array entry per compartment.
 *
 * The dashboard widget catalog reads from `listClientCompartments()` to
 * discover available widgets. Per `docs/DASHBOARD_PLAN.md` P2/P3, adding a
 * new compartment is exactly two lines here plus the compartment folder.
 */
import type { ClientCompartmentEntry } from "./types";
import { favoritesCompartment } from "./favorites";
import { scannerCompartment } from "./scanner";
import { tradesCompartment } from "./trades";
import { confluenceChartCompartment } from "./confluence-chart";

const clientCompartments: ClientCompartmentEntry[] = [
  favoritesCompartment,
  scannerCompartment,
  tradesCompartment,
  confluenceChartCompartment,
];

export function listClientCompartments(): readonly ClientCompartmentEntry[] {
  return clientCompartments;
}

export function getClientCompartment(id: string): ClientCompartmentEntry | undefined {
  return clientCompartments.find((c) => c.meta.id === id);
}

/** Subset that have a dashboard Widget view defined — what the catalog shows. */
export function listWidgetCompartments(): readonly ClientCompartmentEntry[] {
  return clientCompartments.filter((c) => c.WidgetView !== undefined);
}
