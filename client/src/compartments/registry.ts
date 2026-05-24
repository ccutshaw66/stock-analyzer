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
import { htfScannerCompartment } from "./htf-scanner";
// Dashboard rebuild v1 — 6 new compartments, each plugs in here.
import { morningBriefCompartment } from "./morning-brief";
import { actionQueueCompartment } from "./action-queue";
import { positionNewsCompartment } from "./position-news";
import { morningChecklistCompartment } from "./morning-checklist";
import { askOtterCompartment } from "./ask-otter";
import { confluencePulseCompartment } from "./confluence-pulse";
import { positionInsidersCompartment } from "./position-insiders";
import { insiderClustersCompartment } from "./insider-clusters";
import { insiderRatioCompartment } from "./insider-ratio";
// Experimental group — research surfaces, opt-in widgets.
import { hermesCompartment } from "./hermes";
import { markovCompartment } from "./markov";
import { wheelCompartment } from "./wheel";

const clientCompartments: ClientCompartmentEntry[] = [
  // Dashboard rebuild v1 — the new curated default layout uses these nine.
  morningBriefCompartment,
  actionQueueCompartment,
  confluencePulseCompartment,
  morningChecklistCompartment,
  positionNewsCompartment,
  insiderRatioCompartment,
  positionInsidersCompartment,
  insiderClustersCompartment,
  askOtterCompartment,
  // Legacy widgets — kept registered so existing saved layouts still resolve,
  // but no longer mounted by default. Users can opt-in via "Customize layout".
  favoritesCompartment,
  scannerCompartment,
  tradesCompartment,
  confluenceChartCompartment,
  htfScannerCompartment,
  // Experimental — registered so dashboard widgets can opt-in.
  hermesCompartment,
  markovCompartment,
  wheelCompartment,
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
