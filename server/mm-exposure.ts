/**
 * Market Maker (MM) Exposure analysis from Polygon options chain snapshots.
 *
 * Three core concepts:
 *
 *   GEX (Gamma Exposure) — assumes dealers are SHORT calls / LONG puts (standard
 *   retail-skewed market). Per-contract dealer gamma:
 *       calls: -gamma * OI * contract_size  (dealer short)
 *       puts : +gamma * OI * contract_size  (dealer long)
 *   Aggregated, negative total GEX above spot means dealers must BUY as price
 *   rises (short-gamma squeeze conditions). Positive GEX suppresses volatility.
 *
 *   DEX (Delta Exposure) — same sign convention. Net dealer delta exposure.
 *
 *   Unusual volume — per-contract volume / open_interest. Values >3 on
 *   high-OI contracts often precede big moves.
 *
 * All computations work off one Polygon /v3/snapshot/options page (up to ~1000
 * contracts, paginated by getPolygonOptionsChain). We sum across all available
 * expirations for a single exposure snapshot.
 */
import { getPolygonOptionsChain, pget, apiKey } from "./polygon";

const CONTRACT_SIZE = 100;

export interface UnusualContract {
  contractSymbol: string;
  type: "call" | "put";
  strike: number;
  expiration: string; // YYYY-MM-DD
  volume: number;
  openInterest: number;
  volOiRatio: number;
  iv: number | null;
  delta: number | null;
}

export interface MMExposure {
  symbol: string;
  spot: number | null;
  asOf: string;
  // Summed across ALL expirations/strikes fetched:
  totalGEX: number;       // $ per 1% move (convention: dealer dollar-gamma)
  totalDEX: number;       // shares (dealer net delta)
  putCallOI: number;      // ratio; >1 bearish skew
  putCallVolume: number;  // intraday ratio
  // Per-strike breakdown for gamma wall / max pain visualization:
  gexByStrike: { strike: number; gex: number }[];
  // Unusual activity contracts (vol/OI > threshold, sorted desc)
  unusual: UnusualContract[];
  // Gamma wall = strike with max absolute GEX
  gammaWall: number | null;
  // Interpretive flags
  squeezeBias: "up" | "down" | "neutral";
  squeezeStrength: number; // 0..1
}

const UNUSUAL_VOL_OI_RATIO = 3.0;
const UNUSUAL_MIN_VOLUME = 500; // ignore illiquid noise

/**
 * Fetch all expirations by paginating through /v3/snapshot/options. Our existing
 * getPolygonOptionsChain only returns ONE expiration bucket; here we want the
 * full universe. We use it as a primer, then refetch per exp as needed, but
 * that's expensive, so instead we cheat: the snapshot endpoint with no
 * expiration filter already returns all contracts across ALL exps in the
 * paginated response. We'll use the polygon helper directly.
 */
async function fetchAllContracts(symbol: string): Promise<any[]> {
  // getPolygonOptionsChain pages through internally and returns just one exp.
  // To get everything, we directly hit /v3/snapshot/options ourselves.
  const allContracts: any[] = [];
  let firstPage: any = await pget(`/v3/snapshot/options/${encodeURIComponent(symbol)}`, { limit: 250 });
  allContracts.push(...(firstPage?.results || []));
  let nextUrl: string | null = firstPage?.next_url || null;
  let pages = 0;
  // Up to 8 pages (~2000 contracts) — covers most single-name tickers entirely.
  while (nextUrl && pages < 8) {
    const u = new URL(nextUrl);
    u.searchParams.append("apiKey", apiKey());
    const resp = await fetch(u.toString());
    if (!resp.ok) break;
    const json: any = await resp.json();
    allContracts.push(...(json?.results || []));
    nextUrl = json?.next_url || null;
    pages++;
  }
  return allContracts;
}

export async function computeMMExposure(symbol: string): Promise<MMExposure | null> {
  const sym = symbol.toUpperCase();
  let contracts: any[];
  try {
    contracts = await fetchAllContracts(sym);
  } catch (e: any) {
    console.log(`[mm-exposure] ${sym} fetch failed: ${e?.message || e}`);
    return null;
  }
  if (!contracts.length) return null;

  // Spot price: piggy-back on any contract's underlying, fall back to
  // getPolygonOptionsChain's lookup if missing.
  let spot: number | null = null;
  for (const c of contracts) {
    const s = c.underlying_asset?.price;
    if (typeof s === "number" && s > 0) { spot = s; break; }
  }
  if (!spot) {
    try {
      const chain = await getPolygonOptionsChain(sym);
      spot = chain?.quote?.regularMarketPrice ?? null;
    } catch {
      // ignore
    }
  }

  let totalGEX = 0;
  let totalDEX = 0;
  let callOI = 0, putOI = 0;
  let callVol = 0, putVol = 0;
  const gexByStrikeMap = new Map<number, number>();
  const unusual: UnusualContract[] = [];

  for (const c of contracts) {
    const type = c.details?.contract_type as "call" | "put" | undefined;
    const strike = Number(c.details?.strike_price) || 0;
    const exp = c.details?.expiration_date || "";
    const oi = Number(c.open_interest) || 0;
    const vol = Number(c.day?.volume) || 0;
    const gamma = Number(c.greeks?.gamma) || 0;
    const delta = Number(c.greeks?.delta) || 0;
    const iv = typeof c.implied_volatility === "number" ? c.implied_volatility : null;

    if (!type || !strike) continue;

    // OI / volume totals
    if (type === "call") { callOI += oi; callVol += vol; }
    else { putOI += oi; putVol += vol; }

    // Dealer GEX: short calls (+OI contributes NEGATIVE), long puts (+OI contributes POSITIVE)
    // Dollar-gamma per 1% move = gamma * OI * size * spot^2 * 0.01
    if (spot && gamma) {
      const dollarGamma = gamma * oi * CONTRACT_SIZE * spot * spot * 0.01;
      const signed = type === "call" ? -dollarGamma : dollarGamma;
      totalGEX += signed;
      gexByStrikeMap.set(strike, (gexByStrikeMap.get(strike) || 0) + signed);
    }

    // Dealer delta exposure (shares)
    if (delta) {
      const shareDelta = delta * oi * CONTRACT_SIZE;
      totalDEX += type === "call" ? -shareDelta : shareDelta;
    }

    // Unusual activity
    const ratio = oi > 0 ? vol / oi : 0;
    if (ratio >= UNUSUAL_VOL_OI_RATIO && vol >= UNUSUAL_MIN_VOLUME) {
      unusual.push({
        contractSymbol: c.details.ticker,
        type,
        strike,
        expiration: exp,
        volume: vol,
        openInterest: oi,
        volOiRatio: ratio,
        iv,
        delta: delta || null,
      });
    }
  }

  // Gamma wall = strike with largest |GEX|
  let gammaWall: number | null = null;
  let maxAbs = 0;
  const gexByStrike = Array.from(gexByStrikeMap.entries())
    .map(([strike, gex]) => ({ strike, gex }))
    .sort((a, b) => a.strike - b.strike);
  for (const row of gexByStrike) {
    if (Math.abs(row.gex) > maxAbs) { maxAbs = Math.abs(row.gex); gammaWall = row.strike; }
  }

  // Squeeze bias:
  //   Total GEX < 0 (dealer short gamma) + spot above the bulk of strike mass -> upside squeeze risk
  //   Total GEX < 0 + spot below -> downside squeeze risk
  //   Total GEX > 0 -> vol-suppressive, neutral
  let squeezeBias: "up" | "down" | "neutral" = "neutral";
  let squeezeStrength = 0;
  if (spot && totalGEX < 0) {
    // Weight of strikes above vs below spot
    let gexAbove = 0, gexBelow = 0;
    for (const row of gexByStrike) {
      if (row.strike > spot) gexAbove += Math.abs(row.gex);
      else gexBelow += Math.abs(row.gex);
    }
    const sum = gexAbove + gexBelow;
    if (sum > 0) {
      if (gexAbove > gexBelow) {
        squeezeBias = "up";
        squeezeStrength = Math.min(1, gexAbove / sum);
      } else {
        squeezeBias = "down";
        squeezeStrength = Math.min(1, gexBelow / sum);
      }
      // Scale by magnitude of short-gamma (cap at 1e9 $/1%)
      squeezeStrength *= Math.min(1, Math.abs(totalGEX) / 1e9);
    }
  }

  const putCallOI = callOI > 0 ? putOI / callOI : 0;
  const putCallVolume = callVol > 0 ? putVol / callVol : 0;

  // Top 20 unusual contracts by ratio, filtered for quality
  unusual.sort((a, b) => b.volOiRatio - a.volOiRatio);

  return {
    symbol: sym,
    spot,
    asOf: new Date().toISOString(),
    totalGEX,
    totalDEX,
    putCallOI,
    putCallVolume,
    gexByStrike,
    unusual: unusual.slice(0, 20),
    gammaWall,
    squeezeBias,
    squeezeStrength: Number(squeezeStrength.toFixed(3)),
  };
}
