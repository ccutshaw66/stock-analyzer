/**
 * 3-Gate Signal Engine — "Ready → Set → Go"
 * 
 * Gate 1 (READY) — Reversal Detection (VER)
 *   Catches exhaustion reversals: RSI divergence + volume spike + BB extreme.
 *   Must fire FIRST. If Gate 1 hasn't triggered, no signal.
 * 
 * Gate 2 (SET) — Momentum Confirmation (AMC)
 *   After Gate 1 fires, monitors for momentum confirmation within a lookback window.
 *   MACD histogram turn + VAMI positive + RSI recovering toward neutral.
 *   If momentum never confirms within window, the reversal was a fake-out.
 * 
 * Gate 3 (GO) — Trend Alignment + MME
 *   Full EMA stack alignment (9 > 21 > 50 for buys, reverse for sells)
 *   PLUS Market Maker Exposure alignment:
 *     - Gamma regime supports direction
 *     - Price on correct side of max pain
 *     - Not buying into call wall / not selling into put wall
 *   All three conditions must align = HIGH CONFIDENCE signal.
 * 
 * Confidence Tiers:
 *   Gate 3 cleared = HIGH (all aligned, actionable)
 *   Gate 2 cleared = MODERATE (momentum confirmed, watching for trend)
 *   Gate 1 cleared = EARLY (reversal detected, monitoring)
 *   No gates       = NEUTRAL (no setup)
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type GateDirection = "BULLISH" | "BEARISH";

export interface Gate1Result {
  cleared: boolean;
  direction: GateDirection | null;
  daysAgo: number | null;       // How many days ago Gate 1 fired
  detail: string;
  rsi: number | null;
  volumeRatio: number | null;
  hasDivergence: boolean;
  touchedBB: boolean;
}

export interface Gate2Result {
  cleared: boolean;
  direction: GateDirection | null;
  daysAfterGate1: number | null;  // How many days after Gate 1 did Gate 2 clear
  detail: string;
  macdHistogram: number | null;
  macdTurning: boolean;
  vamiPositive: boolean;
  rsiRecovering: boolean;
  amcScore: number;               // 0-5 AMC confluence score
}

export interface Gate3Result {
  cleared: boolean;
  direction: GateDirection | null;
  detail: string;
  emaStackAligned: boolean;
  priceAboveEma9: boolean;
  // MME factors (null if MME data not available)
  mmeAligned: boolean | null;
  gammaRegime: "POSITIVE" | "NEGATIVE" | null;
  gammaSupports: boolean | null;
  maxPainAlignment: "ABOVE" | "BELOW" | "AT" | null;
  maxPainSupports: boolean | null;
  nearCallWall: boolean | null;   // true = close to resistance (bad for buys)
  nearPutWall: boolean | null;    // true = close to support (good for buys)
}

export interface GateSystemResult {
  ticker: string;
  direction: GateDirection | null;
  gatesCleared: number;       // 0, 1, 2, or 3
  confidence: "HIGH" | "MODERATE" | "EARLY" | "NEUTRAL";
  signal: string;             // Gate language: "READY ↑", "SET ↑", "GO ↑", "GATES CLOSED", "PULLBACK", "NO SETUP"
  summary: string;            // Human-readable one-liner
  gate1: Gate1Result;
  gate2: Gate2Result;
  gate3: Gate3Result;
  // Exit / pullback context (populated when a prior bullish/bearish setup is unwinding)
  priorSetup?: {
    direction: GateDirection;        // Direction of the setup that is now at risk
    gatesClearedPrior: number;       // How many gates had cleared in the prior setup
    daysSincePriorSetup: number;     // Bars since the prior setup last cleared
  } | null;
  // Fibonacci retracement context (populated when signal is PULLBACK)
  fib?: {
    zone: "SHALLOW" | "HEALTHY" | "DEEP" | "FAILED";  // retracement depth bucket
    label: string;                   // Short human label: "shallow", "golden pocket", "deep", "failed"
    retracementPct: number;          // 0..1+, where current price sits on the impulse leg
    swingHigh: number;               // Impulse leg high price
    swingLow: number;                // Impulse leg low price
    invalidationPrice: number;       // Break of this = trend invalidated
  } | null;
}

// ─── Helper: Compute indicators ─────────────────────────────────────────────

function computeEMA(data: number[], period: number): number[] {
  const ema: number[] = new Array(data.length).fill(NaN);
  if (data.length < period) return ema;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += data[i];
  ema[period - 1] = sum / period;
  const k = 2 / (period + 1);
  for (let i = period; i < data.length; i++) {
    ema[i] = data[i] * k + ema[i - 1] * (1 - k);
  }
  return ema;
}

function computeSMA(data: number[], period: number): number[] {
  const sma: number[] = new Array(data.length).fill(NaN);
  for (let i = period - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += data[j];
    sma[i] = sum / period;
  }
  return sma;
}

function computeRSI(closes: number[], period: number = 14): number[] {
  // Wilder-smoothed RSI — matches TradingView/TOS and the VER calculation in routes.ts
  const rsi: number[] = new Array(closes.length).fill(NaN);
  if (closes.length < period + 1) return rsi;
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) avgGain += diff;
    else avgLoss += Math.abs(diff);
  }
  avgGain /= period;
  avgLoss /= period;
  rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return rsi;
}

// ─── Gate 1: Reversal Detection ─────────────────────────────────────────────

interface Gate1Input {
  closes: number[];
  highs: number[];
  lows: number[];
  volumes: number[];
  rsi: number[];
  bbUpper: number[];
  bbLower: number[];
  volAvg20: number[];
}

function evaluateGate1(input: Gate1Input, lookbackWindow: number = 5): Gate1Result {
  const { closes, highs, lows, volumes, rsi, bbUpper, bbLower, volAvg20 } = input;
  const len = closes.length;
  const lastIdx = len - 1;

  // Scan the last `lookbackWindow` trading days for a reversal signal
  for (let daysBack = 0; daysBack < lookbackWindow; daysBack++) {
    const i = lastIdx - daysBack;
    if (i < 20 || isNaN(rsi[i]) || isNaN(bbUpper[i]) || isNaN(bbLower[i]) || isNaN(volAvg20[i])) continue;

    const volumeSpike = (volumes[i] || 0) >= volAvg20[i] * 1.8; // Slightly more forgiving than 2x

    // ── Bullish Reversal ──
    let hasBullishDiv = false;
    for (let lb = 5; lb <= Math.min(20, i); lb++) {
      const prevIdx = i - lb;
      if (prevIdx < 0 || isNaN(rsi[prevIdx])) continue;
      // Price makes lower low, RSI makes higher low (divergence)
      if (closes[i] < closes[prevIdx] && rsi[i] > rsi[prevIdx] && rsi[i] < 40) {
        hasBullishDiv = true;
        break;
      }
    }
    const touchedLowerBB = lows[i] <= bbLower[i] || (i > 0 && closes[i - 1] <= bbLower[i - 1]);
    const closedBackInside = closes[i] > bbLower[i];

    if (hasBullishDiv && volumeSpike && touchedLowerBB && closedBackInside) {
      return {
        cleared: true,
        direction: "BULLISH",
        daysAgo: daysBack,
        detail: `Bullish reversal ${daysBack === 0 ? "TODAY" : daysBack + "d ago"}: RSI divergence at ${rsi[i]?.toFixed(1)}, volume ${((volumes[i] || 0) / volAvg20[i]).toFixed(1)}x avg, bounced off lower BB`,
        rsi: rsi[i] ? Number(rsi[i].toFixed(1)) : null,
        volumeRatio: volAvg20[i] > 0 ? Number(((volumes[i] || 0) / volAvg20[i]).toFixed(2)) : null,
        hasDivergence: true,
        touchedBB: true,
      };
    }

    // ── Bearish Reversal ──
    let hasBearishDiv = false;
    for (let lb = 5; lb <= Math.min(20, i); lb++) {
      const prevIdx = i - lb;
      if (prevIdx < 0 || isNaN(rsi[prevIdx])) continue;
      if (closes[i] > closes[prevIdx] && rsi[i] < rsi[prevIdx] && rsi[i] > 60) {
        hasBearishDiv = true;
        break;
      }
    }
    const touchedUpperBB = highs[i] >= bbUpper[i] || (i > 0 && closes[i - 1] >= bbUpper[i - 1]);
    const closedBackInsideUpper = closes[i] < bbUpper[i];

    if (hasBearishDiv && volumeSpike && touchedUpperBB && closedBackInsideUpper) {
      return {
        cleared: true,
        direction: "BEARISH",
        daysAgo: daysBack,
        detail: `Bearish reversal ${daysBack === 0 ? "TODAY" : daysBack + "d ago"}: RSI divergence at ${rsi[i]?.toFixed(1)}, volume ${((volumes[i] || 0) / volAvg20[i]).toFixed(1)}x avg, rejected at upper BB`,
        rsi: rsi[i] ? Number(rsi[i].toFixed(1)) : null,
        volumeRatio: volAvg20[i] > 0 ? Number(((volumes[i] || 0) / volAvg20[i]).toFixed(2)) : null,
        hasDivergence: true,
        touchedBB: true,
      };
    }
  }

  // No reversal detected
  const lastRsi = !isNaN(rsi[lastIdx]) ? Number(rsi[lastIdx].toFixed(1)) : null;
  const lastVolRatio = (!isNaN(volAvg20[lastIdx]) && volAvg20[lastIdx] > 0)
    ? Number(((volumes[lastIdx] || 0) / volAvg20[lastIdx]).toFixed(2))
    : null;

  return {
    cleared: false,
    direction: null,
    daysAgo: null,
    detail: `No reversal detected — RSI ${lastRsi ?? "N/A"}, Vol ${lastVolRatio ?? "N/A"}x avg`,
    rsi: lastRsi,
    volumeRatio: lastVolRatio,
    hasDivergence: false,
    touchedBB: false,
  };
}

// ─── Gate 2: Momentum Confirmation ──────────────────────────────────────────

interface Gate2Input {
  closes: number[];
  volumes: number[];
  rsi: number[];
  ema9: number[];
  ema50: number[];
  histogram: number[];  // MACD histogram
  vamiScaled: number[];
  ema9Values: number[];
  ema21Values: number[];
  gate1Direction: GateDirection;
  gate1DaysAgo: number;
}

function evaluateGate2(input: Gate2Input, confirmWindow: number = 5): Gate2Result {
  const { closes, rsi, histogram, vamiScaled, ema9, ema50, ema9Values, ema21Values, gate1Direction, gate1DaysAgo } = input;
  const lastIdx = closes.length - 1;

  // Check each day from Gate 1 firing to today for momentum confirmation
  const startCheck = Math.max(0, lastIdx - gate1DaysAgo);
  const endCheck = Math.min(lastIdx, startCheck + confirmWindow);

  for (let i = startCheck; i <= endCheck; i++) {
    if (i < 1) continue;

    // AMC-style scoring for this bar
    let amcScore = 0;

    // 1. MACD histogram turning in our direction
    const macdTurning = gate1Direction === "BULLISH"
      ? (!isNaN(histogram[i]) && histogram[i] > (histogram[i - 1] || 0))
      : (!isNaN(histogram[i]) && histogram[i] < (histogram[i - 1] || 0));
    if (macdTurning) amcScore++;

    // 2. RSI recovering toward neutral (not extreme anymore)
    const rsiRecovering = gate1Direction === "BULLISH"
      ? (!isNaN(rsi[i]) && rsi[i] > 35 && rsi[i] < 65)
      : (!isNaN(rsi[i]) && rsi[i] > 35 && rsi[i] < 65);
    if (rsiRecovering) amcScore++;

    // 3. Price momentum (close > previous close for bull, < for bear)
    const priceConfirms = gate1Direction === "BULLISH"
      ? closes[i] > closes[i - 1]
      : closes[i] < closes[i - 1];
    if (priceConfirms) amcScore++;

    // 4. VAMI confirming direction
    const vamiPositive = gate1Direction === "BULLISH"
      ? (vamiScaled[i] > 0 && vamiScaled[i] > (vamiScaled[i - 1] || 0))
      : (vamiScaled[i] < 0 && vamiScaled[i] < (vamiScaled[i - 1] || 0));
    if (vamiPositive) amcScore++;

    // 5. EMA convergence (directional strength)
    if (!isNaN(ema9Values[i]) && !isNaN(ema21Values[i])) {
      const emaSep = Math.abs(ema9Values[i] - ema21Values[i]) / closes[i] * 100;
      if (emaSep > 0.3) amcScore++; // EMAs separating = trend building
    }

    // Need at least 3/5 for momentum confirmation
    if (amcScore >= 3) {
      const daysAfter = i - startCheck;
      return {
        cleared: true,
        direction: gate1Direction,
        daysAfterGate1: daysAfter,
        detail: `Momentum confirmed (${amcScore}/5) ${daysAfter === 0 ? "same day as reversal" : daysAfter + "d after reversal"}: ${[
          macdTurning && "MACD turning",
          rsiRecovering && "RSI recovering",
          priceConfirms && "Price confirming",
          vamiPositive && "VAMI confirming",
        ].filter(Boolean).join(", ")}`,
        macdHistogram: !isNaN(histogram[i]) ? Number(histogram[i].toFixed(4)) : null,
        macdTurning,
        vamiPositive,
        rsiRecovering,
        amcScore,
      };
    }
  }

  // Momentum not yet confirmed
  const li = lastIdx;
  const currentScore = (() => {
    let sc = 0;
    if (!isNaN(histogram[li]) && (gate1Direction === "BULLISH" ? histogram[li] > (histogram[li - 1] || 0) : histogram[li] < (histogram[li - 1] || 0))) sc++;
    if (!isNaN(rsi[li]) && rsi[li] > 35 && rsi[li] < 65) sc++;
    if (li > 0 && (gate1Direction === "BULLISH" ? closes[li] > closes[li - 1] : closes[li] < closes[li - 1])) sc++;
    if (gate1Direction === "BULLISH" ? vamiScaled[li] > 0 : vamiScaled[li] < 0) sc++;
    if (!isNaN(ema9Values[li]) && !isNaN(ema21Values[li]) && Math.abs(ema9Values[li] - ema21Values[li]) / closes[li] * 100 > 0.3) sc++;
    return sc;
  })();

  return {
    cleared: false,
    direction: null,
    daysAfterGate1: null,
    detail: `Waiting for momentum — AMC score ${currentScore}/5 (need 3+)`,
    macdHistogram: !isNaN(histogram[li]) ? Number(histogram[li].toFixed(4)) : null,
    macdTurning: false,
    vamiPositive: false,
    rsiRecovering: false,
    amcScore: currentScore,
  };
}

// ─── Gate 3: Trend + MME Alignment ──────────────────────────────────────────

interface Gate3Input {
  closes: number[];
  ema9: number[];
  ema21: number[];
  ema50: number[];
  gate2Direction: GateDirection;
  // MME data (optional — may not be available for all tickers)
  mmeData?: {
    spot: number;
    totalGEX: number;
    maxPain: number;
    callWallStrike: number | null;
    putWallStrike: number | null;
    gammaFlip: number | null;
  } | null;
}

function evaluateGate3(input: Gate3Input): Gate3Result {
  const { closes, ema9, ema21, ema50, gate2Direction, mmeData } = input;
  const li = closes.length - 1;

  // ── EMA Stack Check ──
  const e9 = ema9[li], e21 = ema21[li], e50 = ema50[li];
  const price = closes[li];
  let emaStackAligned = false;
  let priceAboveEma9 = false;

  if (!isNaN(e9) && !isNaN(e21) && !isNaN(e50)) {
    if (gate2Direction === "BULLISH") {
      emaStackAligned = e9 > e21 && e21 > e50;
      priceAboveEma9 = price > e9;
    } else {
      emaStackAligned = e9 < e21 && e21 < e50;
      priceAboveEma9 = price < e9; // "above" = below for bearish (price confirming)
    }
  }

  // ── MME Alignment ──
  let mmeAligned: boolean | null = null;
  let gammaRegime: "POSITIVE" | "NEGATIVE" | null = null;
  let gammaSupports: boolean | null = null;
  let maxPainAlignment: "ABOVE" | "BELOW" | "AT" | null = null;
  let maxPainSupports: boolean | null = null;
  let nearCallWall: boolean | null = null;
  let nearPutWall: boolean | null = null;

  if (mmeData) {
    const { spot, totalGEX, maxPain, callWallStrike, putWallStrike, gammaFlip } = mmeData;

    gammaRegime = totalGEX > 0 ? "POSITIVE" : "NEGATIVE";

    // Gamma regime support:
    // Positive gamma = mean-reverting (MMs dampen moves) — better for reversals/range trades
    // Negative gamma = trend-following (MMs amplify moves) — better for breakouts
    if (gate2Direction === "BULLISH") {
      // For buys: negative gamma = MMs will amplify the upside move (good)
      // Positive gamma = MMs will dampen the rally (less ideal but not blocking)
      gammaSupports = totalGEX < 0; // Negative gamma amplifies bullish moves
    } else {
      gammaSupports = totalGEX < 0; // Negative gamma amplifies bearish moves too
    }

    // Max pain alignment
    if (maxPain > 0) {
      const pctFromMaxPain = ((spot - maxPain) / maxPain) * 100;
      maxPainAlignment = pctFromMaxPain > 1 ? "ABOVE" : pctFromMaxPain < -1 ? "BELOW" : "AT";

      if (gate2Direction === "BULLISH") {
        // For buys: price at or below max pain = gravitational pull upward (good)
        maxPainSupports = pctFromMaxPain <= 2;
      } else {
        // For sells: price at or above max pain = gravitational pull downward (good)
        maxPainSupports = pctFromMaxPain >= -2;
      }
    }

    // Wall proximity (within 3% of a wall is "near")
    if (callWallStrike && spot > 0) {
      nearCallWall = ((callWallStrike - spot) / spot) * 100 < 3;
    }
    if (putWallStrike && spot > 0) {
      nearPutWall = ((spot - putWallStrike) / spot) * 100 < 3;
    }

    // Overall MME alignment
    let mmeScore = 0;
    let mmeChecks = 0;

    if (gammaSupports !== null) { mmeChecks++; if (gammaSupports) mmeScore++; }
    if (maxPainSupports !== null) { mmeChecks++; if (maxPainSupports) mmeScore++; }

    // Wall check: for buys, NOT near call wall is good. For sells, NOT near put wall is good.
    if (gate2Direction === "BULLISH" && nearCallWall !== null) {
      mmeChecks++;
      if (!nearCallWall) mmeScore++; // Not near ceiling = good for buys
    }
    if (gate2Direction === "BEARISH" && nearPutWall !== null) {
      mmeChecks++;
      if (!nearPutWall) mmeScore++; // Not near floor = good for sells
    }

    mmeAligned = mmeChecks > 0 ? mmeScore >= Math.ceil(mmeChecks / 2) : null;
  }

  // ── Final Gate 3 Decision ──
  // Without MME data: need EMA stack + price above EMA9
  // With MME data: need EMA stack + price above EMA9 + MME alignment
  const trendAligned = emaStackAligned && priceAboveEma9;
  const cleared = mmeData
    ? trendAligned && (mmeAligned === true)
    : trendAligned;

  // Build detail string
  const parts: string[] = [];
  if (emaStackAligned) parts.push("EMA stack aligned ✓");
  else parts.push("EMA stack NOT aligned ✗");
  if (priceAboveEma9) parts.push("Price confirms ✓");
  else parts.push("Price not confirming ✗");
  if (mmeData) {
    if (mmeAligned) parts.push("MME aligned ✓");
    else parts.push("MME not aligned ✗");
    if (gammaRegime) parts.push(`${gammaRegime === "POSITIVE" ? "Dampening" : "Amplifying"} gamma`);
    if (maxPainAlignment) parts.push(`Price ${maxPainAlignment.toLowerCase()} max pain`);
  } else {
    parts.push("MME data not available");
  }

  return {
    cleared,
    direction: cleared ? gate2Direction : null,
    detail: parts.join(" | "),
    emaStackAligned,
    priceAboveEma9,
    mmeAligned,
    gammaRegime,
    gammaSupports,
    maxPainAlignment,
    maxPainSupports,
    nearCallWall,
    nearPutWall,
  };
}

// ─── Live AMC Score (preview, no Gate 1 required) ──────────────────────────

function computeLiveAmcScore(
  closes: number[], rsi: number[], histogram: number[],
  vamiScaled: number[], ema9: number[], ema21: number[],
  direction: GateDirection,
): Gate2Result {
  const li = closes.length - 1;
  if (li < 1) return { cleared: false, direction: null, daysAfterGate1: null, detail: "Insufficient data", macdHistogram: null, macdTurning: false, vamiPositive: false, rsiRecovering: false, amcScore: 0 };

  let score = 0;

  const macdTurning = direction === "BULLISH"
    ? (!isNaN(histogram[li]) && histogram[li] > (isNaN(histogram[li - 1]) ? 0 : histogram[li - 1]))
    : (!isNaN(histogram[li]) && histogram[li] < (isNaN(histogram[li - 1]) ? 0 : histogram[li - 1]));
  if (macdTurning) score++;

  const rsiRecovering = !isNaN(rsi[li]) && rsi[li] > 35 && rsi[li] < 65;
  if (rsiRecovering) score++;

  const priceConfirms = direction === "BULLISH"
    ? closes[li] > closes[li - 1]
    : closes[li] < closes[li - 1];
  if (priceConfirms) score++;

  const vamiPositive = direction === "BULLISH"
    ? (vamiScaled[li] > 0 && vamiScaled[li] > (vamiScaled[li - 1] || 0))
    : (vamiScaled[li] < 0 && vamiScaled[li] < (vamiScaled[li - 1] || 0));
  if (vamiPositive) score++;

  if (!isNaN(ema9[li]) && !isNaN(ema21[li]) && closes[li] > 0) {
    if (Math.abs(ema9[li] - ema21[li]) / closes[li] * 100 > 0.3) score++;
  }

  const parts: string[] = [];
  if (macdTurning) parts.push("MACD");
  if (rsiRecovering) parts.push("RSI");
  if (priceConfirms) parts.push("Price");
  if (vamiPositive) parts.push("VAMI");

  return {
    cleared: false,
    direction: null,
    daysAfterGate1: null,
    detail: parts.length > 0 ? `Live: ${parts.join(", ")} confirming (${score}/5)` : `Live score: ${score}/5`,
    macdHistogram: !isNaN(histogram[li]) ? Number(histogram[li].toFixed(4)) : null,
    macdTurning,
    vamiPositive,
    rsiRecovering,
    amcScore: score,
  };
}

// ─── Main Entry Point ───────────────────────────────────────────────────────

export interface SignalEngineInput {
  ticker: string;
  closes: number[];
  highs: number[];
  lows: number[];
  volumes: number[];
  // Pre-computed strategy data from routes.ts (if available, used instead of signal engine's own calcs)
  precomputed?: {
    verSignal: string;           // "ENTER" | "SELL" | "HOLD"
    verRsi: number | null;
    verVolRatio: number | null;
    amcScore: number;            // 0-5 from routes.ts AMC
    amcSignal: string;           // "ENTER" | "SELL" | "HOLD"
    bbtcSignal: string;          // "ENTER" | "SELL" | "HOLD"
    bbtcBias: string;            // "LONG" | "SHORT" | "FLAT"
    bbtcTrend: string;           // "UP" | "DOWN" | "SIDEWAYS"
    emaStackBull: boolean;       // ema9 > ema21 > ema50
    emaStackBear: boolean;       // ema9 < ema21 < ema50
    priceAboveEma9: boolean;
  } | null;
  // Optional MME data (for Gate 3)
  mmeData?: {
    spot: number;
    totalGEX: number;
    maxPain: number;
    callWallStrike: number | null;
    putWallStrike: number | null;
    gammaFlip: number | null;
  } | null;
}

// ─── Exit-signal helpers (GATES CLOSED / PULLBACK detection) ────────────────

interface FindPriorSetupInput {
  closes: number[];
  highs: number[];
  lows: number[];
  volumes: number[];
  rsi: number[];
  bbUpper: number[];
  bbLower: number[];
  volAvg20: number[];
  currentGate1: Gate1Result;
  lookbackBars: number;
}

/**
 * Walk backward through the price history looking for a Gate-1 reversal that
 * fired in the OPPOSITE direction from the current setup. If we find one and it
 * was "real" (had Gate 2 momentum confirming in its direction), we return info
 * about it so the caller can decide between GATES CLOSED and PULLBACK.
 *
 * We skip the last 3 bars so we don't double-count the current Gate 1 itself.
 */
function findPriorOppositeSetup(input: FindPriorSetupInput): {
  direction: GateDirection;
  gatesClearedPrior: number;
  daysSincePriorSetup: number;
} | null {
  const { closes, highs, lows, volumes, rsi, bbUpper, bbLower, volAvg20, currentGate1, lookbackBars } = input;
  const len = closes.length;

  // Scan bars [lastIdx - 3 .. lastIdx - lookbackBars]
  for (let daysBack = 4; daysBack <= lookbackBars; daysBack++) {
    const i = len - 1 - daysBack;
    if (i < 25 || isNaN(rsi[i]) || isNaN(bbUpper[i]) || isNaN(bbLower[i]) || isNaN(volAvg20[i])) continue;

    const volumeSpike = (volumes[i] || 0) >= volAvg20[i] * 1.8;
    if (!volumeSpike) continue;

    // Check for BULLISH reversal at bar i
    let hasBullishDiv = false;
    for (let lb = 5; lb <= Math.min(20, i); lb++) {
      const prevIdx = i - lb;
      if (prevIdx < 0 || isNaN(rsi[prevIdx])) continue;
      if (closes[i] < closes[prevIdx] && rsi[i] > rsi[prevIdx] && rsi[i] < 40) { hasBullishDiv = true; break; }
    }
    const touchedLowerBB = lows[i] <= bbLower[i] || (i > 0 && closes[i - 1] <= bbLower[i - 1]);
    const closedBackInside = closes[i] > bbLower[i];
    if (hasBullishDiv && touchedLowerBB && closedBackInside) {
      // Prior BULLISH setup found. Only meaningful if the CURRENT direction isn't still BULLISH.
      if (currentGate1.direction !== "BULLISH") {
        return { direction: "BULLISH", gatesClearedPrior: 2, daysSincePriorSetup: daysBack };
      }
      continue;
    }

    // Check for BEARISH reversal at bar i
    let hasBearishDiv = false;
    for (let lb = 5; lb <= Math.min(20, i); lb++) {
      const prevIdx = i - lb;
      if (prevIdx < 0 || isNaN(rsi[prevIdx])) continue;
      if (closes[i] > closes[prevIdx] && rsi[i] < rsi[prevIdx] && rsi[i] > 60) { hasBearishDiv = true; break; }
    }
    const touchedUpperBB = highs[i] >= bbUpper[i] || (i > 0 && closes[i - 1] >= bbUpper[i - 1]);
    const closedBackInsideUpper = closes[i] < bbUpper[i];
    if (hasBearishDiv && touchedUpperBB && closedBackInsideUpper) {
      if (currentGate1.direction !== "BEARISH") {
        return { direction: "BEARISH", gatesClearedPrior: 2, daysSincePriorSetup: daysBack };
      }
    }
  }

  return null;
}

interface TrendWeightInput {
  closes: number[];
  ema9: number[];
  ema21: number[];
  ema50: number[];
  histogram: number[];
  vamiScaled: number[];
  priorDirection: GateDirection;
}

/**
 * Is the trend (AMC momentum + BBTC EMA stack) still "heavy" in the prior
 * direction? We need BOTH to be heavy to classify a Gate-1 flip as a PULLBACK
 * rather than GATES CLOSED. If only one is heavy, the gates have closed.
 */
function evaluateTrendWeight(input: TrendWeightInput): {
  amcHeavy: boolean;
  bbtcHeavy: boolean;
  bothHeavy: boolean;
} {
  const { closes, ema9, ema21, ema50, histogram, vamiScaled, priorDirection } = input;
  const i = closes.length - 1;
  const isBull = priorDirection === "BULLISH";

  // AMC momentum heaviness: histogram still solidly positive/negative in prior direction,
  // AND VAMI still aligned.
  const histOk = !isNaN(histogram[i]) &&
    (isBull ? histogram[i] > 0 : histogram[i] < 0);
  const vamiOk = isBull ? vamiScaled[i] > 0 : vamiScaled[i] < 0;
  // Look 5 bars back to check momentum isn't already rolling
  let consecutiveHeavy = 0;
  for (let k = 0; k < 5 && i - k >= 0; k++) {
    const h = histogram[i - k];
    if (isNaN(h)) continue;
    if ((isBull && h > 0) || (!isBull && h < 0)) consecutiveHeavy++;
  }
  const amcHeavy = histOk && vamiOk && consecutiveHeavy >= 3;

  // BBTC EMA stack heaviness: full 9>21>50 (or inverse) plus price still on the right side of 50
  const e9 = ema9[i], e21 = ema21[i], e50 = ema50[i], px = closes[i];
  const stackAligned = !isNaN(e9) && !isNaN(e21) && !isNaN(e50) && (
    isBull ? (e9 > e21 && e21 > e50 && px > e21) : (e9 < e21 && e21 < e50 && px < e21)
  );
  // Also check the 50-day EMA hasn't already rolled against the trend
  const ema50Sloping = !isNaN(ema50[i]) && !isNaN(ema50[i - 5])
    ? (isBull ? ema50[i] > ema50[i - 5] : ema50[i] < ema50[i - 5])
    : false;
  const bbtcHeavy = stackAligned && ema50Sloping;

  return { amcHeavy, bbtcHeavy, bothHeavy: amcHeavy && bbtcHeavy };
}

// ─── Fibonacci retracement (PULLBACK depth classification) ────────────────

interface FibImpulseInput {
  closes: number[];
  highs: number[];
  lows: number[];
  priorDirection: GateDirection;
  lookbackBars: number;    // how far back to search for the impulse leg
  pivotWindow: number;     // bars on each side for pivot confirmation
}

interface FibImpulseLeg {
  swingHigh: number;
  swingLow: number;
  swingHighIdx: number;
  swingLowIdx: number;
}

/**
 * Identify the most recent impulse leg in the prior-setup direction using
 * N-bar pivot highs/lows. For a BULLISH setup we want the most recent
 * swing-low → swing-high sequence; for BEARISH we want swing-high → swing-low.
 * The retracement is then measured from the endpoint of that leg back toward
 * its origin.
 */
function findImpulseLeg(input: FibImpulseInput): FibImpulseLeg | null {
  const { highs, lows, priorDirection, lookbackBars, pivotWindow } = input;
  const len = highs.length;
  if (len < lookbackBars + pivotWindow * 2) return null;

  const start = Math.max(pivotWindow, len - 1 - lookbackBars);
  const end = len - 1 - pivotWindow;

  // Collect confirmed pivot highs and lows within the window.
  const pivotHighs: { idx: number; price: number }[] = [];
  const pivotLows: { idx: number; price: number }[] = [];
  for (let i = start; i <= end; i++) {
    let isHigh = true, isLow = true;
    for (let k = 1; k <= pivotWindow; k++) {
      if (highs[i] <= highs[i - k] || highs[i] <= highs[i + k]) isHigh = false;
      if (lows[i] >= lows[i - k] || lows[i] >= lows[i + k]) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) pivotHighs.push({ idx: i, price: highs[i] });
    if (isLow) pivotLows.push({ idx: i, price: lows[i] });
  }

  if (pivotHighs.length === 0 || pivotLows.length === 0) return null;

  if (priorDirection === "BULLISH") {
    // Most recent swing high is the leg endpoint; need the preceding swing low.
    const lastHigh = pivotHighs[pivotHighs.length - 1];
    const priorLows = pivotLows.filter(p => p.idx < lastHigh.idx);
    if (priorLows.length === 0) return null;
    const precedingLow = priorLows[priorLows.length - 1];
    if (lastHigh.price <= precedingLow.price) return null;
    return {
      swingHigh: lastHigh.price,
      swingLow: precedingLow.price,
      swingHighIdx: lastHigh.idx,
      swingLowIdx: precedingLow.idx,
    };
  } else {
    const lastLow = pivotLows[pivotLows.length - 1];
    const priorHighs = pivotHighs.filter(p => p.idx < lastLow.idx);
    if (priorHighs.length === 0) return null;
    const precedingHigh = priorHighs[priorHighs.length - 1];
    if (precedingHigh.price <= lastLow.price) return null;
    return {
      swingHigh: precedingHigh.price,
      swingLow: lastLow.price,
      swingHighIdx: precedingHigh.idx,
      swingLowIdx: lastLow.idx,
    };
  }
}

/**
 * Given the impulse leg and current price, classify into a Fib retracement
 * zone. Retracement % = how far price has retraced back toward the leg origin.
 *   0%    = still at the leg endpoint (no pullback)
 *   38.2% = shallow
 *   50%   = golden pocket entry
 *   61.8% = golden pocket exit
 *   78.6% = deep — last-chance zone
 *   >100% = failed, leg origin broken
 */
function classifyFibZone(
  currentPrice: number,
  leg: FibImpulseLeg,
  priorDirection: GateDirection,
): NonNullable<GateSystemResult["fib"]> {
  const range = leg.swingHigh - leg.swingLow;
  const isBull = priorDirection === "BULLISH";

  // Retracement % from the leg endpoint back toward its origin.
  const retracementPct = isBull
    ? (leg.swingHigh - currentPrice) / range   // fell from high toward low
    : (currentPrice - leg.swingLow) / range;   // rose from low toward high

  // Invalidation = origin of the leg
  const invalidationPrice = isBull ? leg.swingLow : leg.swingHigh;

  // Zone thresholds per design:
  //   < 38.2%  → SHALLOW  (very strong trend, just a pause)
  //   38.2–61.8 → HEALTHY (golden pocket — best re-entry)
  //   61.8–78.6 → DEEP    (still valid but risky)
  //   > 78.6%  → FAILED   (trend likely broken — downgrade to GATES CLOSED)
  let zone: "SHALLOW" | "HEALTHY" | "DEEP" | "FAILED";
  let label: string;
  if (retracementPct < 0.382) {
    zone = "SHALLOW"; label = "shallow";
  } else if (retracementPct < 0.618) {
    zone = "HEALTHY"; label = "golden pocket";
  } else if (retracementPct < 0.786) {
    zone = "DEEP"; label = "deep";
  } else {
    zone = "FAILED"; label = "failed";
  }

  return {
    zone,
    label,
    retracementPct,
    swingHigh: leg.swingHigh,
    swingLow: leg.swingLow,
    invalidationPrice,
  };
}

export function runGateSystem(input: SignalEngineInput): GateSystemResult {
  const { ticker, closes, highs, lows, volumes, mmeData, precomputed } = input;

  if (closes.length < 60) {
    return {
      ticker,
      direction: null,
      gatesCleared: 0,
      confidence: "NEUTRAL",
      signal: "NO SETUP",
      summary: "Insufficient data for analysis",
      gate1: { cleared: false, direction: null, daysAgo: null, detail: "Need 60+ bars", rsi: null, volumeRatio: null, hasDivergence: false, touchedBB: false },
      gate2: { cleared: false, direction: null, daysAfterGate1: null, detail: "Waiting for Gate 1", macdHistogram: null, macdTurning: false, vamiPositive: false, rsiRecovering: false, amcScore: 0 },
      gate3: { cleared: false, direction: null, detail: "Waiting for Gate 2", emaStackAligned: false, priceAboveEma9: false, mmeAligned: null, gammaRegime: null, gammaSupports: null, maxPainAlignment: null, maxPainSupports: null, nearCallWall: null, nearPutWall: null },
    };
  }

  // ── Compute all indicators ──
  const rsi = computeRSI(closes, 14);
  const ema9 = computeEMA(closes, 9);
  const ema21 = computeEMA(closes, 21);
  const ema50 = computeEMA(closes, 50);

  // Bollinger Bands
  const bbPeriod = 20;
  const bbSma = computeSMA(closes, bbPeriod);
  const bbUpper: number[] = new Array(closes.length).fill(NaN);
  const bbLower: number[] = new Array(closes.length).fill(NaN);
  for (let i = bbPeriod - 1; i < closes.length; i++) {
    let sum = 0;
    for (let j = i - bbPeriod + 1; j <= i; j++) sum += (closes[j] - bbSma[i]) ** 2;
    const stdDev = Math.sqrt(sum / bbPeriod);
    bbUpper[i] = bbSma[i] + 2 * stdDev;
    bbLower[i] = bbSma[i] - 2 * stdDev;
  }

  // Volume average
  const volAvg20 = computeSMA(volumes, 20);

  // MACD histogram
  const macdEma12 = computeEMA(closes, 12);
  const macdEma26 = computeEMA(closes, 26);
  const macdLine = closes.map((_, i) => (!isNaN(macdEma12[i]) && !isNaN(macdEma26[i])) ? macdEma12[i] - macdEma26[i] : NaN);
  const validMacd: number[] = []; const validIdx: number[] = [];
  macdLine.forEach((v, i) => { if (!isNaN(v)) { validMacd.push(v); validIdx.push(i); } });
  const macdSigEma = computeEMA(validMacd, 9);
  const macdSignal = new Array(closes.length).fill(NaN);
  validIdx.forEach((idx, j) => { macdSignal[idx] = macdSigEma[j]; });
  const histogram = closes.map((_, i) => (!isNaN(macdLine[i]) && !isNaN(macdSignal[i])) ? macdLine[i] - macdSignal[i] : NaN);

  // VAMI
  const vamiArr: number[] = new Array(closes.length).fill(0);
  const avgVol20 = computeSMA(volumes, 20);
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] === 0 || isNaN(avgVol20[i]) || avgVol20[i] === 0) continue;
    const ret = (closes[i] - closes[i - 1]) / closes[i - 1] * 100;
    const vr = Math.min(2.5, Math.max(0.5, volumes[i] / avgVol20[i]));
    const wr = ret * vr;
    const k = 2 / (12 + 1);
    vamiArr[i] = wr * k + vamiArr[i - 1] * (1 - k);
  }
  const vamiScaled = vamiArr.map(v => v * 8);

  // ── Gate 1: Use precomputed VER data if available ──
  let gate1: Gate1Result;
  if (precomputed && precomputed.verSignal !== undefined) {
    // Use the same VER signal/RSI/vol from routes.ts
    const verIsBuy = precomputed.verSignal === "ENTER";
    const verIsSell = precomputed.verSignal === "SELL";
    gate1 = {
      cleared: verIsBuy || verIsSell,
      direction: verIsBuy ? "BULLISH" : verIsSell ? "BEARISH" : null,
      daysAgo: 0,
      detail: verIsBuy
        ? `Bullish reversal — RSI ${precomputed.verRsi ?? "N/A"}, Vol ${precomputed.verVolRatio ?? "N/A"}x avg`
        : verIsSell
        ? `Bearish reversal — RSI ${precomputed.verRsi ?? "N/A"}, Vol ${precomputed.verVolRatio ?? "N/A"}x avg`
        : `No reversal detected — RSI ${precomputed.verRsi ?? "N/A"}, Vol ${precomputed.verVolRatio ?? "N/A"}x avg`,
      rsi: precomputed.verRsi,
      volumeRatio: precomputed.verVolRatio,
      hasDivergence: verIsBuy || verIsSell,
      touchedBB: verIsBuy || verIsSell,
    };
  } else {
    gate1 = evaluateGate1(
      { closes, highs, lows, volumes, rsi, bbUpper, bbLower, volAvg20 },
      5
    );
  }

  // ── Gate 2: Use precomputed AMC score if available ──
  // DIRECTION LOCK: Gate 1 sets the direction. Gate 2 must confirm in the SAME direction.
  const previewDirection: GateDirection = gate1.direction || "BULLISH";
  let liveGate2: Gate2Result;
  if (precomputed && precomputed.amcScore !== undefined) {
    const amcIsBuy = precomputed.amcSignal === "ENTER";
    const amcIsSell = precomputed.amcSignal === "SELL";

    // Momentum must agree with Gate 1's direction
    const g1Dir = gate1.direction;
    const momentumAgreesWithGate1 = g1Dir
      ? (g1Dir === "BULLISH" && amcIsBuy) || (g1Dir === "BEARISH" && amcIsSell)
      : false;
    const directionConflict = gate1.cleared && g1Dir && !momentumAgreesWithGate1 && (amcIsBuy || amcIsSell);

    const cleared = gate1.cleared && precomputed.amcScore >= 4 && momentumAgreesWithGate1;
    const dir: GateDirection | null = cleared ? g1Dir : null;

    let detail: string;
    if (cleared) {
      detail = `Momentum confirmed — AMC ${precomputed.amcScore}/5`;
    } else if (directionConflict) {
      detail = `AMC ${precomputed.amcScore}/5 — CONFLICT: reversal is ${g1Dir?.toLowerCase()} but momentum is ${amcIsBuy ? "bullish" : "bearish"}`;
    } else if (!gate1.cleared) {
      detail = `AMC Score: ${precomputed.amcScore}/5 — waiting for reversal`;
    } else if (precomputed.amcScore < 4) {
      detail = `AMC Score: ${precomputed.amcScore}/5 — need 4+ to confirm`;
    } else {
      detail = `AMC Score: ${precomputed.amcScore}/5 — waiting for directional alignment`;
    }

    liveGate2 = {
      cleared,
      direction: dir,
      daysAfterGate1: cleared ? 0 : null,
      detail,
      macdHistogram: !isNaN(histogram[closes.length - 1]) ? Number(histogram[closes.length - 1].toFixed(4)) : null,
      macdTurning: false,
      vamiPositive: false,
      rsiRecovering: false,
      amcScore: precomputed.amcScore,
    };
  } else if (gate1.cleared && gate1.direction) {
    liveGate2 = evaluateGate2({
      closes, volumes, rsi, ema9, ema50,
      histogram, vamiScaled,
      ema9Values: ema9, ema21Values: ema21,
      gate1Direction: gate1.direction,
      gate1DaysAgo: gate1.daysAgo || 0,
    }, 5);
  } else {
    liveGate2 = computeLiveAmcScore(closes, rsi, histogram, vamiScaled, ema9, ema21, previewDirection);
  }

  // ── Gate 3: Use precomputed BBTC data if available ──
  // DIRECTION LOCK: Always evaluate Gate 3 in Gate 1's direction (if set)
  const liveGate3Direction = gate1.direction || liveGate2.direction || previewDirection;
  let liveGate3: Gate3Result;
  if (precomputed) {
    const isBull = liveGate3Direction === "BULLISH";
    const stackAligned = isBull ? precomputed.emaStackBull : precomputed.emaStackBear;
    const priceOk = precomputed.priceAboveEma9;
    const trendConfirms = isBull ? precomputed.bbtcTrend === "UP" : precomputed.bbtcTrend === "DOWN";
    // Direction lock: trend must agree with Gate 1's direction
    const trendConflict = gate1.direction && (
      (gate1.direction === "BULLISH" && precomputed.bbtcTrend === "DOWN") ||
      (gate1.direction === "BEARISH" && precomputed.bbtcTrend === "UP")
    );
    const cleared = liveGate2.cleared && stackAligned && priceOk && !trendConflict;

    // Still check MME if available
    let mmeAligned: boolean | null = null;
    let gammaRegime: "POSITIVE" | "NEGATIVE" | null = null;
    let gammaSupports: boolean | null = null;
    let maxPainAlignment: "ABOVE" | "BELOW" | "AT" | null = null;
    let maxPainSupports: boolean | null = null;
    let nearCallWall: boolean | null = null;
    let nearPutWall: boolean | null = null;

    if (mmeData) {
      // Run MME evaluation from the existing evaluateGate3
      const mmeGate3 = evaluateGate3({ closes, ema9, ema21, ema50, gate2Direction: liveGate3Direction, mmeData });
      mmeAligned = mmeGate3.mmeAligned;
      gammaRegime = mmeGate3.gammaRegime;
      gammaSupports = mmeGate3.gammaSupports;
      maxPainAlignment = mmeGate3.maxPainAlignment;
      maxPainSupports = mmeGate3.maxPainSupports;
      nearCallWall = mmeGate3.nearCallWall;
      nearPutWall = mmeGate3.nearPutWall;
    }

    const finalCleared = mmeData ? cleared && (mmeAligned === true) : cleared;

    const parts: string[] = [];
    parts.push(stackAligned ? "EMA stack aligned ✓" : "EMA stack NOT aligned ✗");
    parts.push(priceOk ? "Price confirms ✓" : "Price not confirming ✗");
    if (trendConflict) {
      parts.push(`CONFLICT: reversal is ${gate1.direction?.toLowerCase()} but trend is ${precomputed.bbtcTrend}`);
    } else {
      parts.push(trendConfirms ? `Trend ${precomputed.bbtcTrend} ✓` : `Trend ${precomputed.bbtcTrend}`);
    }
    if (!liveGate2.cleared) parts.push("waiting for momentum");
    else if (!gate1.cleared) parts.push("waiting for reversal");

    liveGate3 = {
      cleared: finalCleared,
      direction: finalCleared ? liveGate3Direction : null,
      detail: parts.join(" | "),
      emaStackAligned: stackAligned,
      priceAboveEma9: priceOk,
      mmeAligned, gammaRegime, gammaSupports, maxPainAlignment, maxPainSupports, nearCallWall, nearPutWall,
    };
  } else {
    liveGate3 = evaluateGate3({ closes, ema9, ema21, ema50, gate2Direction: liveGate3Direction, mmeData });
  }

  // ── Exit-signal detection: look back for a prior opposite-direction reversal ──
  // If a prior setup fired in the last 30 bars and the CURRENT Gate 1 has flipped
  // direction (or Gate 3's trend has decisively broken), we need to decide between:
  //   1. GATES CLOSED — reversal flipped AND momentum/trend are losing conviction
  //   2. PULLBACK      — reversal flipped BUT AMC + BBTC are still heavy in the
  //                      original direction; treat as a shake-out, not an exit
  const priorSetup = findPriorOppositeSetup({
    closes, highs, lows, volumes, rsi, bbUpper, bbLower, volAvg20,
    currentGate1: gate1,
    lookbackBars: 30,
  });

  if (priorSetup) {
    // Evaluate how heavy the trend still is in the PRIOR direction
    const isPriorBull = priorSetup.direction === "BULLISH";
    const trendStillHeavy = evaluateTrendWeight({
      closes, ema9, ema21, ema50, histogram, vamiScaled,
      priorDirection: priorSetup.direction,
    });

    // A reversal flip counts as "closing the gates" only when:
    //   (a) Gate 1 has fired in the OPPOSITE direction very recently (last 3 bars), OR
    //   (b) The EMA stack has decisively broken against the prior direction
    const gate1Flipped = gate1.cleared && gate1.direction && gate1.direction !== priorSetup.direction
      && (gate1.daysAgo ?? 99) <= 3;
    const stackBroken = isPriorBull
      ? (!isNaN(ema9[closes.length - 1]) && !isNaN(ema21[closes.length - 1]) && ema9[closes.length - 1] < ema21[closes.length - 1])
      : (!isNaN(ema9[closes.length - 1]) && !isNaN(ema21[closes.length - 1]) && ema9[closes.length - 1] > ema21[closes.length - 1]);

    if (gate1Flipped || stackBroken) {
      // Compute Fibonacci retracement on the prior-direction impulse leg so we
      // know HOW DEEP the pullback is. A shallow/healthy retracement keeps the
      // PULLBACK label; a retracement past 78.6% (FAILED) downgrades to
      // GATES CLOSED even if AMC+BBTC still look heavy — the origin of the
      // impulse leg has been taken out, so the prior trend structure is gone.
      const impulseLeg = findImpulseLeg({
        closes, highs, lows,
        priorDirection: priorSetup.direction,
        lookbackBars: 60,
        pivotWindow: 3,
      });
      const fib = impulseLeg
        ? classifyFibZone(closes[closes.length - 1], impulseLeg, priorSetup.direction)
        : null;

      const fibQualifiesForPullback = fib ? fib.zone !== "FAILED" : true;

      if (trendStillHeavy.bothHeavy && fibQualifiesForPullback) {
        // PULLBACK: reversal flipped but momentum + trend are still in the prior
        // direction AND price hasn't retraced past the 78.6% fib level.
        // Don't shake the trader out.
        const zoneSuffix = fib ? ` (${fib.label})` : "";
        return {
          ticker,
          direction: priorSetup.direction,
          gatesCleared: priorSetup.gatesClearedPrior,
          confidence: "MODERATE",
          signal: `PULLBACK${zoneSuffix}`,
          summary: fib
            ? `Reversal flipped but ${priorSetup.direction.toLowerCase()} trend still heavy — ${fib.label} retracement (${(fib.retracementPct * 100).toFixed(0)}%), invalidation at ${fib.invalidationPrice.toFixed(2)}`
            : `Reversal flipped but ${priorSetup.direction.toLowerCase()} trend still heavy — likely a pullback, not an exit`,
          gate1,
          gate2: liveGate2,
          gate3: liveGate3,
          priorSetup,
          fib,
        };
      }
      // GATES CLOSED: either trend conviction is gone OR price has retraced
      // past the 78.6% fib level — the prior trend structure is broken.
      const fibNote = fib && fib.zone === "FAILED"
        ? ` — fib invalidation (${(fib.retracementPct * 100).toFixed(0)}% retrace)`
        : "";
      return {
        ticker,
        direction: priorSetup.direction,
        gatesCleared: 0,
        confidence: "NEUTRAL",
        signal: "GATES CLOSED",
        summary: `Reversal against prior ${priorSetup.direction.toLowerCase()} setup${fibNote} — take profit / exit`,
        gate1,
        gate2: liveGate2,
        gate3: liveGate3,
        priorSetup,
        fib,
      };
    }
  }

  // ── Return based on gate progression ──
  if (!gate1.cleared || !gate1.direction) {
    return {
      ticker,
      direction: null,
      gatesCleared: 0,
      confidence: "NEUTRAL",
      signal: "NO SETUP",
      summary: "No reversal detected — waiting for setup",
      gate1,
      gate2: { ...liveGate2, cleared: false, direction: null, daysAfterGate1: null, detail: `AMC Score: ${liveGate2.amcScore}/5 — waiting for reversal` },
      gate3: { ...liveGate3, cleared: false, direction: null, detail: `${liveGate3.emaStackAligned ? "EMA aligned" : "EMA not aligned"} — waiting for reversal` },
    };
  }

  const gate2 = liveGate2;
  if (!gate2.cleared) {
    return {
      ticker,
      direction: gate1.direction,
      gatesCleared: 1,
      confidence: "EARLY",
      signal: `READY ${gate1.direction === "BULLISH" ? "↑" : "↓"}`,
      summary: `Reversal detected (${gate1.direction.toLowerCase()}) — waiting for momentum confirmation`,
      gate1,
      gate2,
      gate3: { ...liveGate3, cleared: false, direction: null, detail: `${liveGate3.emaStackAligned ? "EMA aligned" : "EMA not aligned"} — waiting for momentum` },
    };
  }

  const gate3 = liveGate3;

  if (!gate3.cleared) {
    const arrow = gate2.direction === "BULLISH" ? "↑" : "↓";
    return {
      ticker,
      direction: gate2.direction,
      gatesCleared: 2,
      confidence: "MODERATE",
      signal: `SET ${arrow}`,
      summary: `Reversal + momentum confirmed (${gate2.direction?.toLowerCase()}) — trend/MME not yet aligned`,
      gate1,
      gate2,
      gate3,
    };
  }

  // All 3 gates cleared
  const direction = gate3.direction || gate2.direction || gate1.direction;
  const arrow = direction === "BULLISH" ? "↑" : "↓";
  return {
    ticker,
    direction,
    gatesCleared: 3,
    confidence: "HIGH",
    signal: `GO ${arrow}`,
    summary: `All gates cleared — ${direction?.toLowerCase()} with high confidence`,
    gate1,
    gate2,
    gate3,
  };
}

// ─── UNIFIED TICKER ANALYSIS ──────────────────────────────────────────────────
//
// `analyzeTicker` is the single entry point that scanner + watchlist + any other
// non-Trade-Analysis path should use. It computes VER/AMC/BBTC exactly the same
// way the /api/analyze route does, then calls runGateSystem with precomputed,
// so the same ticker produces the SAME answer everywhere on the site.
//
// Trade Analysis uses its own deep computation path and already passes precomputed
// directly, so it stays as-is.
// ──────────────────────────────────────────────────────────────────────────────────────

export interface AnalyzeTickerInput {
  ticker: string;
  closes: number[];
  highs: number[];
  lows: number[];
  volumes: number[];
  mmeData?: SignalEngineInput["mmeData"];
}

// Internal: ATR (14) — used by BBTC stateful walk (matches routes.ts computeATR)
function computeATR14(highs: number[], lows: number[], closes: number[], period = 14): number[] {
  const atr: number[] = new Array(closes.length).fill(NaN);
  const tr: number[] = new Array(closes.length).fill(0);
  tr[0] = highs[0] - lows[0];
  for (let i = 1; i < closes.length; i++) {
    tr[i] = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
  }
  let sum = 0;
  for (let i = 0; i < period && i < tr.length; i++) sum += tr[i];
  if (tr.length >= period) {
    atr[period - 1] = sum / period;
    for (let i = period; i < tr.length; i++) {
      atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
    }
  }
  return atr;
}

export function analyzeTicker(input: AnalyzeTickerInput): GateSystemResult {
  const { ticker, closes, highs, lows, volumes, mmeData } = input;

  if (closes.length < 60) {
    return runGateSystem({ ticker, closes, highs, lows, volumes, mmeData: mmeData ?? null });
  }

  const lastIdx = closes.length - 1;

  // ── Compute indicators (mirrors routes.ts /api/analyze exactly) ──
  const rsi14 = computeRSI(closes, 14);
  const ema9 = computeEMA(closes, 9);
  const ema21 = computeEMA(closes, 21);
  const ema50 = computeEMA(closes, 50);
  const atr14 = computeATR14(highs, lows, closes, 14);

  // Bollinger Bands
  const bbPeriod = 20;
  const bbSma = computeSMA(closes, bbPeriod);
  const bbUpper = new Array(closes.length).fill(NaN);
  const bbLower = new Array(closes.length).fill(NaN);
  for (let i = bbPeriod - 1; i < closes.length; i++) {
    let sum = 0;
    for (let j = i - bbPeriod + 1; j <= i; j++) sum += (closes[j] - bbSma[i]) ** 2;
    const stdDev = Math.sqrt(sum / bbPeriod);
    bbUpper[i] = bbSma[i] + 2 * stdDev;
    bbLower[i] = bbSma[i] - 2 * stdDev;
  }
  const volAvg20 = computeSMA(volumes, 20);

  // MACD histogram
  const macdEma12 = computeEMA(closes, 12);
  const macdEma26 = computeEMA(closes, 26);
  const macdLine = closes.map((_, i) => (!isNaN(macdEma12[i]) && !isNaN(macdEma26[i])) ? macdEma12[i] - macdEma26[i] : NaN);
  const validMacd: number[] = []; const validIdx: number[] = [];
  macdLine.forEach((v, i) => { if (!isNaN(v)) { validMacd.push(v); validIdx.push(i); } });
  const macdSigEma = computeEMA(validMacd, 9);
  const macdSignal = new Array(closes.length).fill(NaN);
  validIdx.forEach((idx, j) => { macdSignal[idx] = macdSigEma[j]; });
  const histogram = closes.map((_, i) => (!isNaN(macdLine[i]) && !isNaN(macdSignal[i])) ? macdLine[i] - macdSignal[i] : NaN);

  // VAMI
  const vamiArr = new Array(closes.length).fill(0);
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] === 0 || isNaN(volAvg20[i]) || volAvg20[i] === 0) continue;
    const ret = (closes[i] - closes[i - 1]) / closes[i - 1] * 100;
    const vr = Math.min(2.5, Math.max(0.5, volumes[i] / volAvg20[i]));
    const wr = ret * vr;
    const k = 2 / (12 + 1);
    vamiArr[i] = wr * k + vamiArr[i - 1] * (1 - k);
  }
  const vamiScaled = vamiArr.map(v => v * 8);

  // ── BBTC EMA Pyramid (stateful walk — MATCHES /api/trade-analysis Strategy 1) ──
  type BBTCSig = "BUY" | "SELL" | "ADD_LONG" | "REDUCE" | "STOP_HIT" | null;
  const bbtcSignals: BBTCSig[] = new Array(closes.length).fill(null);
  {
    let inPosition = false;
    let positionSide: "LONG" | "SHORT" | null = null;
    let entryPrice = 0;
    let highestSinceEntry = 0;
    for (let i = 1; i < closes.length; i++) {
      if (isNaN(ema9[i]) || isNaN(ema21[i]) || isNaN(ema50[i]) || isNaN(atr14[i])) continue;
      const crossAbove = ema9[i] > ema21[i] && ema9[i - 1] <= ema21[i - 1];
      const crossBelow = ema9[i] < ema21[i] && ema9[i - 1] >= ema21[i - 1];
      if (!inPosition) {
        if (crossAbove && closes[i] > ema50[i]) {
          bbtcSignals[i] = "BUY"; inPosition = true; positionSide = "LONG"; entryPrice = closes[i]; highestSinceEntry = highs[i];
        } else if (crossBelow && closes[i] < ema50[i]) {
          bbtcSignals[i] = "SELL"; inPosition = true; positionSide = "SHORT"; entryPrice = closes[i]; highestSinceEntry = highs[i];
        }
      } else {
        highestSinceEntry = Math.max(highestSinceEntry, highs[i]);
        if (positionSide === "LONG") {
          const stopLoss = entryPrice - atr14[i] * 2.0;
          const trailStop = highestSinceEntry - atr14[i] * 1.5;
          const target = entryPrice + atr14[i] * 3.0;
          if (lows[i] <= stopLoss || lows[i] <= trailStop) {
            bbtcSignals[i] = "STOP_HIT"; inPosition = false; positionSide = null;
          } else if (highs[i] >= target) {
            bbtcSignals[i] = "REDUCE";
          } else if (crossAbove && closes[i] > ema50[i]) {
            bbtcSignals[i] = "ADD_LONG";
          } else if (crossBelow && closes[i] < ema50[i]) {
            bbtcSignals[i] = "SELL"; inPosition = false; positionSide = null;
          }
        } else if (positionSide === "SHORT") {
          if (crossAbove && closes[i] > ema50[i]) {
            bbtcSignals[i] = "BUY"; inPosition = false; positionSide = null;
          } else if (crossBelow && closes[i] < ema50[i]) {
            bbtcSignals[i] = "ADD_LONG";
          }
        }
      }
    }
  }
  // Most recent BBTC state — walk all of history
  let lastBbtcSignal: BBTCSig = null;
  for (let i = lastIdx; i >= 0; i--) { if (bbtcSignals[i]) { lastBbtcSignal = bbtcSignals[i]; break; } }
  let bbtcSignal: "HOLD" | "ENTER" | "SELL" = "HOLD";
  if (lastBbtcSignal === "BUY" || lastBbtcSignal === "ADD_LONG") bbtcSignal = "ENTER";
  else if (lastBbtcSignal === "SELL" || lastBbtcSignal === "STOP_HIT" || lastBbtcSignal === "REDUCE") bbtcSignal = "SELL";

  const e9 = ema9[lastIdx], e21 = ema21[lastIdx], e50 = ema50[lastIdx], px = closes[lastIdx];
  let bbtcBias: "LONG" | "SHORT" | "FLAT" = "FLAT";
  let bbtcTrend: "UP" | "DOWN" | "SIDEWAYS" = "SIDEWAYS";
  if (!isNaN(e9) && !isNaN(e21) && !isNaN(e50)) {
    if (e9 > e21 && px > e50) { bbtcBias = "LONG"; bbtcTrend = "UP"; }
    else if (e9 < e21 && px < e50) { bbtcBias = "SHORT"; bbtcTrend = "DOWN"; }
  }

  // ── VER (full-history scan — MATCHES /api/trade-analysis Strategy 2) ──
  // Volume spike threshold = 2.0x avg (was 1.8x), scan from day 2 to lastIdx
  type VERSig = "BUY" | "SELL" | null;
  const verSignals: VERSig[] = new Array(closes.length).fill(null);
  for (let i = 2; i < closes.length; i++) {
    if (isNaN(rsi14[i]) || isNaN(rsi14[i - 1]) || isNaN(bbUpper[i]) || isNaN(bbLower[i]) || isNaN(volAvg20[i])) continue;
    const volumeSpike = (volumes[i] || 0) >= volAvg20[i] * 2;
    if (i >= 5) {
      let hasBullishDiv = false;
      for (let lookback = 5; lookback <= Math.min(20, i); lookback++) {
        const prevIdx = i - lookback;
        if (prevIdx < 0 || isNaN(rsi14[prevIdx])) continue;
        if (closes[i] < closes[prevIdx] && rsi14[i] > rsi14[prevIdx] && rsi14[i] < 40) { hasBullishDiv = true; break; }
      }
      const touchedLowerBB = lows[i] <= bbLower[i] || closes[i - 1] <= bbLower[i - 1];
      const closedBackInside = closes[i] > bbLower[i];
      if (hasBullishDiv && volumeSpike && touchedLowerBB && closedBackInside) verSignals[i] = "BUY";
    }
    if (i >= 5) {
      let hasBearishDiv = false;
      for (let lookback = 5; lookback <= Math.min(20, i); lookback++) {
        const prevIdx = i - lookback;
        if (prevIdx < 0 || isNaN(rsi14[prevIdx])) continue;
        if (closes[i] > closes[prevIdx] && rsi14[i] < rsi14[prevIdx] && rsi14[i] > 60) { hasBearishDiv = true; break; }
      }
      const touchedUpperBB = highs[i] >= bbUpper[i] || closes[i - 1] >= bbUpper[i - 1];
      const closedBackInsideUpper = closes[i] < bbUpper[i];
      if (hasBearishDiv && volumeSpike && touchedUpperBB && closedBackInsideUpper) verSignals[i] = "SELL";
    }
  }
  // Most recent VER across entire history
  let lastVerSignal: VERSig = null;
  for (let i = lastIdx; i >= 0; i--) { if (verSignals[i]) { lastVerSignal = verSignals[i]; break; } }
  let verSignal: "HOLD" | "ENTER" | "SELL" = "HOLD";
  if (lastVerSignal === "BUY") verSignal = "ENTER";
  else if (lastVerSignal === "SELL") verSignal = "SELL";

  // verRsi & verVolRatio reported from CURRENT bar (matches /api/analyze lines 2600-2601)
  const currentVol = volumes[lastIdx] || 0;
  const curAvgVol = !isNaN(volAvg20[lastIdx]) ? volAvg20[lastIdx] : 0;
  const curVolRatio = curAvgVol > 0 ? currentVol / curAvgVol : 0;
  const verRsi: number | null = !isNaN(rsi14[lastIdx]) ? Number(rsi14[lastIdx].toFixed(1)) : null;
  const verVolRatio: number | null = Number(curVolRatio.toFixed(2));

  // ── AMC score (matches /api/analyze exactly) ──
  const li = lastIdx;
  let amcScore = 0;
  if (!isNaN(histogram[li]) && histogram[li] > 0 && histogram[li] > (histogram[li - 1] || 0)) amcScore++;
  if (!isNaN(rsi14[li]) && rsi14[li] >= 45 && rsi14[li] <= 65) amcScore++;
  if (!isNaN(e9) && !isNaN(e50) && closes[li] > e9 && e9 > e50) amcScore++;
  if (vamiScaled[li] > 0 && vamiScaled[li] > vamiScaled[li - 1]) amcScore++;
  if (!isNaN(e9) && !isNaN(e21) && Math.abs(e9 - e21) / closes[li] * 100 > 0.5) amcScore++;

  let amcSignal: "ENTER" | "HOLD" | "SELL" = "HOLD";
  if (amcScore >= 4 && closes[li] > closes[li - 1]) amcSignal = "ENTER";
  if (!isNaN(rsi14[li]) && rsi14[li] > 75) amcSignal = "SELL";
  if (!isNaN(histogram[li]) && histogram[li] < 0 && !isNaN(histogram[li - 1]) && histogram[li - 1] >= 0) amcSignal = "SELL";

  return runGateSystem({
    ticker,
    closes,
    highs,
    lows,
    volumes,
    mmeData: mmeData ?? null,
    precomputed: {
      verSignal,
      verRsi,
      verVolRatio,
      amcScore,
      amcSignal,
      bbtcSignal,
      bbtcBias,
      bbtcTrend,
      emaStackBull: !isNaN(e9) && !isNaN(e21) && !isNaN(e50) && e9 > e21 && e21 > e50,
      emaStackBear: !isNaN(e9) && !isNaN(e21) && !isNaN(e50) && e9 < e21 && e21 < e50,
      priceAboveEma9: !isNaN(e9) && closes[li] > e9,
    },
  });
}

// ─── Backtest helper: run gate system on each day ───────────────────────────

export interface BacktestSignal {
  ticker: string;
  date: string;
  dayIndex: number;
  signal: string;
  gatesCleared: number;
  confidence: string;
  direction: string | null;
  price: number;
  return7d: number | null;
  return30d: number | null;
  return90d: number | null;
}

export function backtestGateSystem(
  ticker: string,
  timestamps: number[],
  closes: number[],
  highs: number[],
  lows: number[],
  volumes: number[],
): BacktestSignal[] {
  const signals: BacktestSignal[] = [];
  if (closes.length < 60) return signals;

  // Walk through each day starting from day 60
  for (let day = 60; day < closes.length; day++) {
    // Slice data up to this day
    const sliceCloses = closes.slice(0, day + 1);
    const sliceHighs = highs.slice(0, day + 1);
    const sliceLows = lows.slice(0, day + 1);
    const sliceVols = volumes.slice(0, day + 1);

    const result = runGateSystem({
      ticker,
      closes: sliceCloses,
      highs: sliceHighs,
      lows: sliceLows,
      volumes: sliceVols,
      mmeData: null, // No MME in backtest (not available historically)
    });

    // Only log signals where at least Gate 2 cleared (actionable signals)
    if (result.gatesCleared >= 2) {
      const price = closes[day];
      let ret7d: number | null = null;
      let ret30d: number | null = null;
      let ret90d: number | null = null;

      if (day + 7 < closes.length && closes[day + 7] > 0) {
        ret7d = ((closes[day + 7] - price) / price) * 100;
      }
      if (day + 30 < closes.length && closes[day + 30] > 0) {
        ret30d = ((closes[day + 30] - price) / price) * 100;
      }
      if (day + 90 < closes.length && closes[day + 90] > 0) {
        ret90d = ((closes[day + 90] - price) / price) * 100;
      }

      signals.push({
        ticker,
        date: timestamps[day] ? new Date(timestamps[day] * 1000).toISOString().split("T")[0] : `day-${day}`,
        dayIndex: day,
        signal: result.signal,
        gatesCleared: result.gatesCleared,
        confidence: result.confidence,
        direction: result.direction,
        price: Number(price.toFixed(2)),
        return7d: ret7d !== null ? Number(ret7d.toFixed(2)) : null,
        return30d: ret30d !== null ? Number(ret30d.toFixed(2)) : null,
        return90d: ret90d !== null ? Number(ret90d.toFixed(2)) : null,
      });
    }
  }

  return signals;
}
