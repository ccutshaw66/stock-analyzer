/**
 * AMC parity test — verifies computeAMC() matches the two ORIGINAL inline
 * AMC implementations (Trade Analysis + AMC Scanner) bit-for-bit, under the
 * same caller-specific knobs each route used.
 *
 * Runs on synthetic OHLCV.
 */

import { computeRSISeries } from "../server/indicators";
import { computeAMC, type AMCResult } from "../server/signals/strategies/amc";

// -------------------- Reference inline implementations (verbatim) --------------------

type InlineResult = { score: number; signal: "ENTER" | "HOLD" | "SELL"; mode: "momentum" | "reversion" | "flat"; greenClose: boolean };

/** Verbatim copy of routes.ts Trade Analysis AMC (pre-extraction). */
function referenceAMC_TA(
  closes: number[],
  histogram: number[],
  rsi14: number[],
  ema9: number[],
  ema21: number[],
  ema50: number[],
  vamiScaled: number[],
  sma200Daily: number[],
): InlineResult {
  const li = closes.length - 1;
  let amcScore = 0;
  if (!isNaN(histogram[li]) && histogram[li] > 0 && histogram[li] > (histogram[li-1]||0)) amcScore++;
  if (!isNaN(rsi14[li]) && rsi14[li] >= 45 && rsi14[li] <= 65) amcScore++;
  if (!isNaN(ema9[li]) && !isNaN(ema50[li]) && closes[li] > ema9[li] && ema9[li] > ema50[li]) amcScore++;
  if (vamiScaled[li] > 0 && vamiScaled[li] > vamiScaled[li-1]) amcScore++;
  if (!isNaN(ema9[li]) && !isNaN(ema21[li]) && Math.abs(ema9[li] - ema21[li]) / closes[li] * 100 > 0.5) amcScore++;

  const greenClose = closes[li] > closes[li-1];
  const amcMomentumEntry = amcScore >= 4 && greenClose;
  const amcReversionEntry = !isNaN(rsi14[li]) && rsi14[li] < 30 && !isNaN(sma200Daily[li]) && closes[li] > sma200Daily[li] * 0.95 && greenClose && vamiScaled[li] > vamiScaled[li-1];

  let amcSignal: "ENTER" | "HOLD" | "SELL" = "HOLD";
  let amcMode: "momentum" | "reversion" | "flat" = "flat";
  if (amcMomentumEntry) { amcSignal = "ENTER"; amcMode = "momentum"; }
  else if (amcReversionEntry) { amcSignal = "ENTER"; amcMode = "reversion"; }
  if (!isNaN(rsi14[li]) && rsi14[li] > 75) { amcSignal = "SELL"; }
  if (!isNaN(histogram[li]) && histogram[li] < 0 && !isNaN(histogram[li-1]) && histogram[li-1] >= 0) { amcSignal = "SELL"; }

  return { score: amcScore, signal: amcSignal, mode: amcMode, greenClose };
}

/** Verbatim copy of routes.ts AMC Scanner AMC (pre-extraction). */
function referenceAMC_Scanner(
  closes: number[],
  histogram: number[],
  rsi14: number[],
  ema20: number[],
  ema50: number[],
  vami: number[],
  bbLo: number[],
): InlineResult {
  const li = closes.length - 1;
  let amcScore = 0;
  if (!isNaN(histogram[li]) && histogram[li] > 0 && histogram[li] > (histogram[li-1]||0)) amcScore++;
  if (!isNaN(rsi14[li]) && rsi14[li] >= 45 && rsi14[li] <= 65) amcScore++;
  if (!isNaN(ema20[li]) && !isNaN(ema50[li]) && closes[li] > ema20[li] && ema20[li] > ema50[li]) amcScore++;
  if (vami[li] > 0 && vami[li] > vami[li-1]) amcScore++;
  if (!isNaN(ema20[li]) && !isNaN(ema50[li]) && Math.abs(ema20[li] - ema50[li]) / closes[li] * 100 > 0.5) amcScore++;

  const greenClose = closes[li] > closes[li-1];
  const momentumEntry = amcScore >= 4 && greenClose;
  const reversionEntry = !isNaN(rsi14[li]) && rsi14[li] < 30 && !isNaN(bbLo[li]) && closes[li] <= bbLo[li] * 1.01 && greenClose && vami[li] > vami[li-1];

  const rsiExit = !isNaN(rsi14[li]) && rsi14[li] > 75;
  const macdFlip = !isNaN(histogram[li]) && histogram[li] < 0 && !isNaN(histogram[li-1]) && histogram[li-1] >= 0;

  let signal: "ENTER" | "HOLD" | "SELL" = "HOLD";
  let mode: "momentum" | "reversion" | "flat" = "flat";
  if (momentumEntry) { signal = "ENTER"; mode = "momentum"; }
  else if (reversionEntry) { signal = "ENTER"; mode = "reversion"; }
  if (rsiExit || macdFlip) { signal = "SELL"; }

  return { score: amcScore, signal, mode, greenClose };
}

// -------------------- Helpers --------------------

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateOHLCV(seed: number, bars: number, drift: number, vol: number) {
  const rng = makeRng(seed);
  const closes: number[] = [];
  const highs: number[] = [];
  const lows: number[] = [];
  const volumes: number[] = [];
  let price = 100;
  for (let i = 0; i < bars; i++) {
    const ret = drift + (rng() - 0.5) * vol;
    const open = price;
    price = price * (1 + ret);
    const barRange = price * vol * 0.5;
    const high = Math.max(open, price) + barRange * rng();
    const low = Math.min(open, price) - barRange * rng();
    const baseVol = 1_000_000 + rng() * 500_000;
    const spike = rng() < 0.08 ? (2 + rng() * 2) : 1;
    closes.push(price);
    highs.push(high);
    lows.push(Math.max(0.01, low));
    volumes.push(Math.floor(baseVol * spike));
  }
  return { closes, highs, lows, volumes };
}

function computeEMA(closes: number[], length: number): number[] {
  const ema: number[] = new Array(closes.length).fill(NaN);
  const k = 2 / (length + 1);
  let sum = 0;
  for (let i = 0; i < length && i < closes.length; i++) sum += closes[i];
  if (closes.length >= length) {
    ema[length - 1] = sum / length;
    for (let i = length; i < closes.length; i++) ema[i] = closes[i] * k + ema[i - 1] * (1 - k);
  }
  return ema;
}

function computeSMA(closes: number[], length: number): number[] {
  const sma: number[] = new Array(closes.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i];
    if (i >= length) sum -= closes[i - length];
    if (i >= length - 1) sma[i] = sum / length;
  }
  return sma;
}

function computeMACDHistogram(closes: number[]): number[] {
  const ema12 = computeEMA(closes, 12);
  const ema26 = computeEMA(closes, 26);
  const macdLine = closes.map((_, i) => (!isNaN(ema12[i]) && !isNaN(ema26[i])) ? ema12[i] - ema26[i] : NaN);
  const validVals: number[] = []; const validIdx: number[] = [];
  macdLine.forEach((v, i) => { if (!isNaN(v)) { validVals.push(v); validIdx.push(i); } });
  const sigEma = computeEMA(validVals, 9);
  const signalArr = new Array(closes.length).fill(NaN);
  validIdx.forEach((idx, j) => { signalArr[idx] = sigEma[j]; });
  return closes.map((_, i) => (!isNaN(macdLine[i]) && !isNaN(signalArr[i])) ? macdLine[i] - signalArr[i] : NaN);
}

function computeBBLower(closes: number[], period = 20, stdDev = 2): number[] {
  const sma = computeSMA(closes, period);
  const lower: number[] = new Array(closes.length).fill(NaN);
  for (let i = period - 1; i < closes.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += (closes[j] - sma[i]) ** 2;
    const sd = Math.sqrt(sum / period);
    lower[i] = sma[i] - stdDev * sd;
  }
  return lower;
}

/** Compute VAMI identical to Trade Analysis (wr * k form). */
function computeVAMI_TA(closes: number[], volumes: number[]): number[] {
  const vamiArr: number[] = new Array(closes.length).fill(0);
  const avgVol20 = computeSMA(volumes.map(v => v || 0), 20);
  for (let i = 1; i < closes.length; i++) {
    if (closes[i-1] === 0 || isNaN(avgVol20[i]) || avgVol20[i] === 0) continue;
    const ret = (closes[i] - closes[i-1]) / closes[i-1] * 100;
    const vr = Math.min(2.5, Math.max(0.5, volumes[i] / avgVol20[i]));
    const wr = ret * vr;
    const k = 2 / (12 + 1);
    vamiArr[i] = wr * k + vamiArr[i-1] * (1 - k);
  }
  return vamiArr.map(v => v * 8);
}

/** Compute VAMI identical to Scanner (ret * vr * k form — algebraically same). */
function computeVAMI_Scanner(closes: number[], volumes: number[]): number[] {
  const vamiArr: number[] = new Array(closes.length).fill(0);
  const avgV = computeSMA(volumes.map(v => v || 0), 20);
  for (let i = 1; i < closes.length; i++) {
    if (closes[i-1] === 0 || isNaN(avgV[i]) || avgV[i] === 0) continue;
    const ret = (closes[i] - closes[i-1]) / closes[i-1] * 100;
    const vr = Math.min(2.5, Math.max(0.5, volumes[i] / avgV[i]));
    const k = 2 / (12 + 1);
    vamiArr[i] = ret * vr * k + vamiArr[i-1] * (1 - k);
  }
  return vamiArr.map(v => v * 8);
}

// -------------------- Test --------------------

async function main() {
  const cases = [
    { name: "up-trend",      seed: 1, drift: 0.002,  vol: 0.02 },
    { name: "down-trend",    seed: 2, drift: -0.002, vol: 0.02 },
    { name: "sideways",      seed: 3, drift: 0,      vol: 0.015 },
    { name: "high-vol-up",   seed: 4, drift: 0.003,  vol: 0.04 },
    { name: "high-vol-down", seed: 5, drift: -0.003, vol: 0.04 },
    { name: "low-vol",       seed: 6, drift: 0.0005, vol: 0.008 },
    { name: "whipsaw",       seed: 7, drift: 0,      vol: 0.03 },
    { name: "long-trend",    seed: 8, drift: 0.001,  vol: 0.025 },
  ];

  const BARS = 400;
  let allPass = true;

  for (const caller of ["TA", "Scanner"] as const) {
    for (const c of cases) {
      const { closes, highs, lows, volumes } = generateOHLCV(c.seed, BARS, c.drift, c.vol);
      const histogram = computeMACDHistogram(closes);
      const rsi14 = computeRSISeries(closes, { period: 14 });
      const ema9 = computeEMA(closes, 9);
      const ema20 = computeEMA(closes, 20);
      const ema21 = computeEMA(closes, 21);
      const ema50 = computeEMA(closes, 50);
      const sma200 = computeSMA(closes, 200);
      const bbLo = computeBBLower(closes, 20, 2);

      let ref: InlineResult;
      let got: AMCResult;

      if (caller === "TA") {
        const vami = computeVAMI_TA(closes, volumes);
        ref = referenceAMC_TA(closes, histogram, rsi14, ema9, ema21, ema50, vami, sma200);
        got = computeAMC({
          closes, histogram, rsi14,
          trendShortEma: ema9,
          trendLongEma: ema50,
          trendStrengthRefEma: ema21,
          vamiScaled: vami,
          reversionRefLevel: sma200.map(v => isNaN(v) ? NaN : v * 0.95),
          reversionDirection: "above",
        });
      } else {
        const vami = computeVAMI_Scanner(closes, volumes);
        ref = referenceAMC_Scanner(closes, histogram, rsi14, ema20, ema50, vami, bbLo);
        got = computeAMC({
          closes, histogram, rsi14,
          trendShortEma: ema20,
          trendLongEma: ema50,
          trendStrengthRefEma: ema50,
          vamiScaled: vami,
          reversionRefLevel: bbLo.map(v => isNaN(v) ? NaN : v * 1.01),
          reversionDirection: "below",
        });
      }

      const match =
        ref.score === got.score &&
        ref.signal === got.signal &&
        ref.mode === got.mode &&
        ref.greenClose === got.greenClose;

      if (match) {
        console.log(`PASS  ${caller.padEnd(8)} ${c.name.padEnd(16)} score=${got.score} signal=${got.signal} mode=${got.mode}`);
      } else {
        allPass = false;
        console.log(`FAIL  ${caller.padEnd(8)} ${c.name.padEnd(16)}`);
        console.log(`      ref: score=${ref.score} signal=${ref.signal} mode=${ref.mode} green=${ref.greenClose}`);
        console.log(`      got: score=${got.score} signal=${got.signal} mode=${got.mode} green=${got.greenClose}`);
      }
    }
  }

  console.log("");
  console.log(allPass ? `ALL PASS (${cases.length * 2}/${cases.length * 2})` : "FAILURES PRESENT");
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(2); });
