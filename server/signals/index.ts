export { evaluateConfluence } from "./confluence";
export type { ConfluenceResult } from "./confluence";
export { evaluateGate1 } from "./gates/gate1-reversal";
export { evaluateGate2 } from "./gates/gate2-momentum";
export { evaluateGate3 } from "./gates/gate3-trend";
export { computeBBTC } from "./strategies/bbtc";
export type {
  BBTCSignal,
  BBTCTopSignal,
  BBTCTrend,
  BBTCBias,
  BBTCInput,
  BBTCResult,
} from "./strategies/bbtc";
export { computeVER } from "./strategies/ver";
export type {
  VERSignal,
  VERTopSignal,
  VERInput,
  VERResult,
} from "./strategies/ver";
