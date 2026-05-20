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
export { computeAMC, scoreAMC } from "./strategies/amc";
export type {
  AMCSignal,
  AMCMode,
  AMCInput,
  AMCResult,
} from "./strategies/amc";
export { scanHtf } from "./strategies/htf";
export type { HtfHit, HtfExtras, HtfScanOptions } from "./strategies/htf";
export {
  DEFAULT_ACCOUNT_CONFIG,
  sizePosition,
  isActionable,
  PortfolioState,
  maxRiskPerTrade,
  maxPositionSize,
  maxTotalOpenRisk,
  maxSectorExposure,
} from "./risk/position-sizing";
export type {
  AccountConfig,
  PositionRecommendation,
  OpenPosition,
} from "./risk/position-sizing";
