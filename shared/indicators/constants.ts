/**
 * Indicator constants — canonical source for industry-standard indicator
 * periods and signal levels.
 *
 * Per the universal-structure rule (2026-05-15): every strategy, signal,
 * chart pane, and visualization uses these constants. Strategies that
 * intentionally diverge (e.g. BBTC uses RSI ceiling 65 instead of the
 * generic 70) keep their own named constants for that specific override
 * AND comment why — but they still consume PERIOD constants from here.
 *
 * Why one module: when the TradingView-style chart rolls out across every
 * page, every chart pane will render EMA21/50/200 with the SAME period
 * the strategies score against. Drift between "what the chart shows" and
 * "what the strategy computes" makes signals look wrong to users.
 */

// ─── Periods (lookback windows) ─────────────────────────────────────────

/** RSI lookback — Wilder's standard. */
export const RSI_PERIOD = 14;

/** ATR lookback — Wilder's standard. */
export const ATR_PERIOD = 14;

/** ADX lookback — Wilder's standard. */
export const ADX_PERIOD = 14;

/** EMA periods used across the site. The four canonical trend lines. */
export const EMA_FAST = 9;
export const EMA_MID = 21;
export const EMA_SLOW = 50;
export const EMA_TREND = 200;

/** Tuple form for code that iterates over the canonical EMA set. */
export const EMA_PERIODS = [EMA_FAST, EMA_MID, EMA_SLOW, EMA_TREND] as const;

/** MACD — fast EMA, slow EMA, signal EMA. */
export const MACD_FAST = 12;
export const MACD_SLOW = 26;
export const MACD_SIGNAL = 9;

/** Bollinger Bands — period (SMA basis) and standard-deviation multiplier. */
export const BB_PERIOD = 20;
export const BB_STDDEV = 2;

/** Volume moving average — used for relative-volume / volume-spike signals. */
export const VOLUME_MA_PERIOD = 20;

/** SMA 200 — long-term trend line used by TFT and others. */
export const SMA_TREND_PERIOD = 200;

// ─── RSI standard levels ────────────────────────────────────────────────

/** RSI overbought threshold — classical level. */
export const RSI_OVERBOUGHT = 70;

/** RSI oversold threshold — classical level. */
export const RSI_OVERSOLD = 30;

/** RSI midline — neutral pivot. */
export const RSI_MIDLINE = 50;

// ─── Chart annotation defaults ─────────────────────────────────────────

/** Default number of bars to render on a small indicator pane (MACD/RSI snapshot). */
export const COMPACT_PANE_BAR_COUNT = 60;
