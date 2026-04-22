/**
 * VER parity test — verifies computeVER() produces bit-identical output
 * to the old inline VER logic that lived in routes.ts (Trade Analysis + Scanner).
 *
 * Runs on synthetic OHLCV data so it does not hit any API.
 */

import { computeRSISeries } from "../server/indicators";
import { computeVER, type VERSignal } from "../server/signals/strategies/ver";

type ReferenceResult = {
  signals: VERSignal[];
  lastSignal: VERSignal;
  topSignal: "HOLD" | "ENTER" | "SELL";
};

/**
 * Reference VER — verbatim copy of the inline VER loop that was in routes.ts
 * line 2296 (Trade Analysis). Do NOT refactor.
 */
function referenceVER(
  closes: number[],
  highs: number[],
  lows: number[],
  volumes: number[],
  rsi14: number[],
  bbUpper: number[],
  bbLower: number[],
  volAvg20: number[],
): ReferenceResult {
  type Sig = "BUY" | "SELL" | null;
  const verSignals: Sig[] = new Array(closes.length).fill(null);

  for (let i = 2; i < closes.length; i++) {
    if (isNaN(rsi14[i]) || isNaN(rsi14[i-1]) || isNaN(bbUpper[i]) || isNaN(bbLower[i]) || isNaN(volAvg20[i])) continue;

    const volumeSpike = (volumes[i] || 0) >= volAvg20[i] * 2;

    if (i >= 5) {
      let hasBullishDiv = false;
      for (let lookback = 5; lookback <= Math.min(20, i); lookback++) {
        const prevIdx = i - lookback;
        if (prevIdx < 0 || isNaN(rsi14[prevIdx])) continue;
        if (closes[i] < closes[prevIdx] && rsi14[i] > rsi14[prevIdx] && rsi14[i] < 40) {
          hasBullishDiv = true;
          break;
        }
      }

      const touchedLowerBB = lows[i] <= bbLower[i] || closes[i-1] <= bbLower[i-1];
      const closedBackInside = closes[i] > bbLower[i];

      if (hasBullishDiv && volumeSpike && touchedLowerBB && closedBackInside) {
        verSignals[i] = "BUY";
      }
    }

    if (i >= 5) {
      let hasBearishDiv = false;
      for (let lookback = 5; lookback <= Math.min(20, i); lookback++) {
        const prevIdx = i - lookback;
        if (prevIdx < 0 || isNaN(rsi14[prevIdx])) continue;
        if (closes[i] > closes[prevIdx] && rsi14[i] < rsi14[prevIdx] && rsi14[i] > 60) {
          hasBearishDiv = true;
          break;
        }
      }

      const touchedUpperBB = highs[i] >= bbUpper[i] || closes[i-1] >= bbUpper[i-1];
      const closedBackInsideUpper = closes[i] < bbUpper[i];

      if (hasBearishDiv && volumeSpike && touchedUpperBB && closedBackInsideUpper) {
        verSignals[i] = "SELL";
      }
    }
  }

  let lastSignal: Sig = null;
  for (let i = closes.length - 1; i >= 0; i--) {
    if (verSignals[i]) { lastSignal = verSignals[i]; break; }
  }
  let topSignal: "HOLD" | "ENTER" | "SELL" = "HOLD";
  if (lastSignal === "BUY") topSignal = "ENTER";
  else if (lastSignal === "SELL") topSignal = "SELL";

  return { signals: verSignals as VERSignal[], lastSignal, topSignal };
}

/** Deterministic PRNG (mulberry32). */
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

/** Generate synthetic OHLCV with trend + volatility + occasional volume spikes. */
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
    // base volume around 1M with occasional 2-4x spikes
    const baseVol = 1_000_000 + rng() * 500_000;
    const spike = rng() < 0.08 ? (2 + rng() * 2) : 1;
    closes.push(price);
    highs.push(high);
    lows.push(Math.max(0.01, low));
    volumes.push(Math.floor(baseVol * spike));
  }
  return { closes, highs, lows, volumes };
}

// Minimal SMA / BB / volAvg helpers copied from routes.ts
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

function computeBollinger(closes: number[], period = 20, stdDev = 2) {
  const sma = computeSMA(closes, period);
  const upper: number[] = new Array(closes.length).fill(NaN);
  const lower: number[] = new Array(closes.length).fill(NaN);
  for (let i = period - 1; i < closes.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += (closes[j] - sma[i]) ** 2;
    const sd = Math.sqrt(sum / period);
    upper[i] = sma[i] + stdDev * sd;
    lower[i] = sma[i] - stdDev * sd;
  }
  return { upper, lower };
}

function computeVolAvg(volumes: number[], period = 20): number[] {
  const out: number[] = new Array(volumes.length).fill(NaN);
  for (let i = period - 1; i < volumes.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += volumes[j] || 0;
    out[i] = sum / period;
  }
  return out;
}

function compareSignals(a: VERSignal[], b: VERSignal[]): { match: boolean; firstDiff: number } {
  if (a.length !== b.length) return { match: false, firstDiff: -1 };
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return { match: false, firstDiff: i };
  }
  return { match: true, firstDiff: -1 };
}

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

  for (const c of cases) {
    const { closes, highs, lows, volumes } = generateOHLCV(c.seed, BARS, c.drift, c.vol);
    const rsi14 = computeRSISeries(closes, { period: 14 });
    const { upper: bbUpper, lower: bbLower } = computeBollinger(closes, 20, 2);
    const volAvg20 = computeVolAvg(volumes, 20);

    const ref = referenceVER(closes, highs, lows, volumes, rsi14, bbUpper, bbLower, volAvg20);
    const got = computeVER({ closes, highs, lows, volumes, rsi14, bbUpper, bbLower, volAvg20 });

    const sigCmp = compareSignals(ref.signals, got.signals);
    const scalarsMatch =
      ref.lastSignal === got.lastSignal &&
      ref.topSignal === got.topSignal;

    const nonNullCount = got.signals.filter(Boolean).length;

    if (sigCmp.match && scalarsMatch) {
      console.log(`PASS  ${c.name.padEnd(16)} bars=${BARS} signals=${nonNullCount.toString().padStart(3)} last=${got.lastSignal ?? "-"}`);
    } else {
      allPass = false;
      console.log(`FAIL  ${c.name.padEnd(16)} signals-match=${sigCmp.match} scalars-match=${scalarsMatch}`);
      if (!sigCmp.match) console.log(`      first signal diff at bar ${sigCmp.firstDiff}: ref=${ref.signals[sigCmp.firstDiff]} got=${got.signals[sigCmp.firstDiff]}`);
      if (!scalarsMatch) {
        console.log(`      ref: last=${ref.lastSignal} top=${ref.topSignal}`);
        console.log(`      got: last=${got.lastSignal} top=${got.topSignal}`);
      }
    }
  }

  console.log("");
  console.log(allPass ? `ALL PASS (${cases.length}/${cases.length})` : "FAILURES PRESENT");
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(2); });
