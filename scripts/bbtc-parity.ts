/**
 * BBTC parity test — verifies computeBBTC() produces bit-identical output
 * to the old inline BBTC logic that lived in routes.ts (Trade Analysis + Scanner).
 *
 * Runs on synthetic OHLC data so it does not hit any API. If the inline
 * reference and the extracted function diverge on any bar for any of the
 * synthetic series, the test fails.
 */

import { computeBBTC, type BBTCSignal } from "../server/signals/strategies/bbtc";

// EMA/ATR are defined inline in routes.ts — replicate here verbatim for parity test.
function computeEMA(closes: number[], length: number): number[] {
  const ema: number[] = new Array(closes.length).fill(NaN);
  const k = 2 / (length + 1);
  let sum = 0;
  for (let i = 0; i < length && i < closes.length; i++) sum += closes[i];
  if (closes.length >= length) {
    ema[length - 1] = sum / length;
    for (let i = length; i < closes.length; i++) {
      ema[i] = closes[i] * k + ema[i - 1] * (1 - k);
    }
  }
  return ema;
}

function computeATR(highs: number[], lows: number[], closes: number[], period: number): number[] {
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

type ReferenceResult = {
  signals: BBTCSignal[];
  lastSignal: BBTCSignal;
  topSignal: "HOLD" | "ENTER" | "SELL";
  trend: "UP" | "DOWN" | "SIDEWAYS";
  bias: "LONG" | "SHORT" | "FLAT";
  entryPrice: number;
  highestSinceEntry: number;
};

/**
 * Reference implementation — verbatim copy of the inline BBTC loop that was
 * previously in routes.ts line 2289 (Trade Analysis route). Do NOT refactor.
 */
function referenceBBTC(
  closes: number[],
  highs: number[],
  lows: number[],
  ema9: number[],
  ema21: number[],
  ema50: number[],
  atr14: number[],
): ReferenceResult {
  type Sig = "BUY" | "SELL" | "ADD_LONG" | "REDUCE" | "STOP_HIT" | null;
  const bbtcSignals: Sig[] = new Array(closes.length).fill(null);
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
        bbtcSignals[i] = "BUY";
        inPosition = true;
        positionSide = "LONG";
        entryPrice = closes[i];
        highestSinceEntry = highs[i];
      } else if (crossBelow && closes[i] < ema50[i]) {
        bbtcSignals[i] = "SELL";
        inPosition = true;
        positionSide = "SHORT";
        entryPrice = closes[i];
        highestSinceEntry = highs[i];
      }
    } else {
      highestSinceEntry = Math.max(highestSinceEntry, highs[i]);
      if (positionSide === "LONG") {
        const stopLoss = entryPrice - atr14[i] * 2.0;
        const trailStop = highestSinceEntry - atr14[i] * 1.5;
        const target = entryPrice + atr14[i] * 3.0;
        if (lows[i] <= stopLoss || lows[i] <= trailStop) {
          bbtcSignals[i] = "STOP_HIT";
          inPosition = false;
          positionSide = null;
        } else if (highs[i] >= target) {
          bbtcSignals[i] = "REDUCE";
        } else if (crossAbove && closes[i] > ema50[i]) {
          bbtcSignals[i] = "ADD_LONG";
        } else if (crossBelow && closes[i] < ema50[i]) {
          bbtcSignals[i] = "SELL";
          inPosition = false;
          positionSide = null;
        }
      } else if (positionSide === "SHORT") {
        if (crossAbove && closes[i] > ema50[i]) {
          bbtcSignals[i] = "BUY";
          inPosition = false;
          positionSide = null;
        } else if (crossBelow && closes[i] < ema50[i]) {
          bbtcSignals[i] = "ADD_LONG";
        }
      }
    }
  }

  const lastIdx = closes.length - 1;
  let lastSignal: Sig = null;
  for (let i = lastIdx; i >= 0; i--) {
    if (bbtcSignals[i]) { lastSignal = bbtcSignals[i]; break; }
  }
  let topSignal: "HOLD" | "ENTER" | "SELL" = "HOLD";
  if (lastSignal === "BUY" || lastSignal === "ADD_LONG") topSignal = "ENTER";
  else if (lastSignal === "SELL" || lastSignal === "STOP_HIT" || lastSignal === "REDUCE") topSignal = "SELL";

  const stackReady =
    !isNaN(ema9[lastIdx]) && !isNaN(ema21[lastIdx]) && !isNaN(ema50[lastIdx]);

  const trend: "UP" | "DOWN" | "SIDEWAYS" = stackReady
    ? ema9[lastIdx] > ema21[lastIdx] && closes[lastIdx] > ema50[lastIdx]
      ? "UP"
      : ema9[lastIdx] < ema21[lastIdx] && closes[lastIdx] < ema50[lastIdx]
        ? "DOWN"
        : "SIDEWAYS"
    : "SIDEWAYS";

  const bias: "LONG" | "SHORT" | "FLAT" = stackReady
    ? ema9[lastIdx] > ema21[lastIdx] && closes[lastIdx] > ema50[lastIdx]
      ? "LONG"
      : ema9[lastIdx] < ema21[lastIdx] && closes[lastIdx] < ema50[lastIdx]
        ? "SHORT"
        : "FLAT"
    : "FLAT";

  return { signals: bbtcSignals as BBTCSignal[], lastSignal, topSignal, trend, bias, entryPrice, highestSinceEntry };
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

/** Generate synthetic OHLC with trend + volatility so BBTC actually fires signals. */
function generateOHLC(seed: number, bars: number, drift: number, vol: number) {
  const rng = makeRng(seed);
  const closes: number[] = [];
  const highs: number[] = [];
  const lows: number[] = [];
  let price = 100;
  for (let i = 0; i < bars; i++) {
    const ret = drift + (rng() - 0.5) * vol;
    const open = price;
    price = price * (1 + ret);
    const barRange = price * vol * 0.5;
    const high = Math.max(open, price) + barRange * rng();
    const low = Math.min(open, price) - barRange * rng();
    closes.push(price);
    highs.push(high);
    lows.push(Math.max(0.01, low));
  }
  return { closes, highs, lows };
}

function compareSignals(a: BBTCSignal[], b: BBTCSignal[]): { match: boolean; firstDiff: number } {
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
    const { closes, highs, lows } = generateOHLC(c.seed, BARS, c.drift, c.vol);
    const ema9 = computeEMA(closes, 9);
    const ema21 = computeEMA(closes, 21);
    const ema50 = computeEMA(closes, 50);
    const atr14 = computeATR(highs, lows, closes, 14);

    const ref = referenceBBTC(closes, highs, lows, ema9, ema21, ema50, atr14);
    const got = computeBBTC({ closes, highs, lows, ema9, ema21, ema50, atr14 });

    const sigCmp = compareSignals(ref.signals, got.signals);
    const scalarsMatch =
      ref.lastSignal === got.lastSignal &&
      ref.topSignal === got.topSignal &&
      ref.trend === got.trend &&
      ref.bias === got.bias &&
      ref.entryPrice === got.entryPrice &&
      ref.highestSinceEntry === got.highestSinceEntry;

    const nonNullCount = got.signals.filter(Boolean).length;

    if (sigCmp.match && scalarsMatch) {
      console.log(`PASS  ${c.name.padEnd(16)} bars=${BARS} signals=${nonNullCount.toString().padStart(3)} last=${got.lastSignal ?? "-"}`);
    } else {
      allPass = false;
      console.log(`FAIL  ${c.name.padEnd(16)} signals-match=${sigCmp.match} scalars-match=${scalarsMatch}`);
      if (!sigCmp.match) console.log(`      first signal diff at bar ${sigCmp.firstDiff}: ref=${ref.signals[sigCmp.firstDiff]} got=${got.signals[sigCmp.firstDiff]}`);
      if (!scalarsMatch) {
        console.log(`      ref: last=${ref.lastSignal} top=${ref.topSignal} trend=${ref.trend} bias=${ref.bias} entry=${ref.entryPrice} hi=${ref.highestSinceEntry}`);
        console.log(`      got: last=${got.lastSignal} top=${got.topSignal} trend=${got.trend} bias=${got.bias} entry=${got.entryPrice} hi=${got.highestSinceEntry}`);
      }
    }
  }

  console.log("");
  console.log(allPass ? `ALL PASS (${cases.length}/${cases.length})` : "FAILURES PRESENT");
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(2); });
