/**
 * Strategies + signal-engine public surface.
 *
 * Two flavours of strategy live behind this module:
 *
 * 1. **Per-bar evaluators** — given pre-computed indicator arrays for a
 *    single ticker, compute a discrete signal at the latest bar. BBTC,
 *    VER, and AMC are this flavour. Used by the chart pages, the live
 *    scanner, and the strategy P&L diagnostics.
 *
 * 2. **Pattern detectors** — given a raw OHLCV series, scan it for
 *    multi-bar setups and emit zero or more hits with entry/target/stop.
 *    HTF (Givens-loosened) is the current detector; future Bulkowski
 *    detectors (head-and-shoulders, etc.) plug in here.
 *
 * Risk + portfolio primitives (account config, position sizing, portfolio
 * gates) are re-exported below so consumers don't have to know whether
 * sizing lives under `risk/` or under a specific strategy folder.
 */

// ─── Confluence + gates ────────────────────────────────────────────────────
export { evaluateConfluence } from "./confluence";
export type { ConfluenceResult } from "./confluence";
export { evaluateGate1 } from "./gates/gate1-reversal";
export { evaluateGate2 } from "./gates/gate2-momentum";
export { evaluateGate3 } from "./gates/gate3-trend";

// ─── Per-bar evaluators ────────────────────────────────────────────────────
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

// ─── Pattern detectors ─────────────────────────────────────────────────────
export { scanHtf, scanFormingHtf } from "./strategies/htf";
export type { HtfHit, HtfExtras, HtfScanOptions } from "./strategies/htf";

// ─── Risk + portfolio primitives ───────────────────────────────────────────
export {
  DEFAULT_ACCOUNT_CONFIG,
  sizePosition,
  isActionable,
  PortfolioState,
  maxRiskPerTrade,
  maxPositionSize,
  maxTotalOpenRisk,
  maxSectorExposure,
  entryIsChased,
  dailyLossBreached,
  weeklyLossBreached,
  effectiveSlippagePct,
} from "./risk/position-sizing";
export type {
  AccountConfig,
  PositionRecommendation,
  OpenPosition,
} from "./risk/position-sizing";
