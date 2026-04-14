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
  signal: "STRONG_BUY" | "BUY" | "WATCH" | "HOLD" | "SELL" | "STRONG_SELL";
  summary: string;            // Human-readable one-liner
  gate1: Gate1Result;
  gate2: Gate2Result;
  gate3: Gate3Result;
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
  const rsi: number[] = new Array(closes.length).fill(NaN);
  if (closes.length < period + 1) return rsi;
  for (let idx = period; idx < closes.length; idx++) {
    let gains = 0, losses = 0;
    for (let i = idx - period + 1; i <= idx; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff > 0) gains += diff;
      else losses += Math.abs(diff);
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    rsi[idx] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
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

export function runGateSystem(input: SignalEngineInput): GateSystemResult {
  const { ticker, closes, highs, lows, volumes, mmeData } = input;

  if (closes.length < 60) {
    return {
      ticker,
      direction: null,
      gatesCleared: 0,
      confidence: "NEUTRAL",
      signal: "HOLD",
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

  // ── Gate 1 ──
  const gate1 = evaluateGate1(
    { closes, highs, lows, volumes, rsi, bbUpper, bbLower, volAvg20 },
    5 // Look back 5 trading days for reversal
  );

  // ── Always compute live AMC score (even if Gate 1 hasn't cleared) ──
  // Use bullish as default direction for preview when no gate has fired
  const previewDirection: GateDirection = gate1.direction || "BULLISH";
  const liveGate2 = gate1.cleared && gate1.direction
    ? evaluateGate2({
        closes, volumes, rsi, ema9, ema50,
        histogram, vamiScaled,
        ema9Values: ema9, ema21Values: ema21,
        gate1Direction: gate1.direction,
        gate1DaysAgo: gate1.daysAgo || 0,
      }, 5)
    : computeLiveAmcScore(closes, rsi, histogram, vamiScaled, ema9, ema21, previewDirection);

  // ── Always compute live EMA/trend status (even if Gate 2 hasn't cleared) ──
  const liveGate3Direction = liveGate2.direction || previewDirection;
  const liveGate3 = evaluateGate3({
    closes, ema9, ema21, ema50,
    gate2Direction: liveGate3Direction,
    mmeData,
  });

  if (!gate1.cleared || !gate1.direction) {
    return {
      ticker,
      direction: null,
      gatesCleared: 0,
      confidence: "NEUTRAL",
      signal: "HOLD",
      summary: "No reversal detected — waiting for setup",
      gate1,
      gate2: { ...liveGate2, cleared: false, direction: null, daysAfterGate1: null, detail: `AMC Score: ${liveGate2.amcScore}/5 — waiting for reversal` },
      gate3: { ...liveGate3, cleared: false, direction: null, detail: `${liveGate3.emaStackAligned ? "EMA aligned" : "EMA not aligned"} — waiting for reversal` },
    };
  }

  // ── Gate 2 ──
  const gate2 = liveGate2;

  if (!gate2.cleared) {
    return {
      ticker,
      direction: gate1.direction,
      gatesCleared: 1,
      confidence: "EARLY",
      signal: "WATCH",
      summary: `Reversal detected (${gate1.direction.toLowerCase()}) — waiting for momentum confirmation`,
      gate1,
      gate2,
      gate3: { ...liveGate3, cleared: false, direction: null, detail: `${liveGate3.emaStackAligned ? "EMA aligned" : "EMA not aligned"} — waiting for momentum` },
    };
  }

  // ── Gate 3 ──
  const gate3 = evaluateGate3({
    closes, ema9, ema21, ema50,
    gate2Direction: gate2.direction || gate1.direction,
    mmeData,
  });

  if (!gate3.cleared) {
    const signal = gate2.direction === "BULLISH" ? "BUY" : "SELL";
    return {
      ticker,
      direction: gate2.direction,
      gatesCleared: 2,
      confidence: "MODERATE",
      signal,
      summary: `Reversal + momentum confirmed (${gate2.direction?.toLowerCase()}) — trend/MME not yet aligned`,
      gate1,
      gate2,
      gate3,
    };
  }

  // All 3 gates cleared
  const direction = gate3.direction || gate2.direction || gate1.direction;
  const signal = direction === "BULLISH" ? "STRONG_BUY" : "STRONG_SELL";
  return {
    ticker,
    direction,
    gatesCleared: 3,
    confidence: "HIGH",
    signal,
    summary: `All gates cleared — ${direction?.toLowerCase()} with high confidence`,
    gate1,
    gate2,
    gate3,
  };
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
