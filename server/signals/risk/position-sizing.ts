/**
 * Position sizing + portfolio risk for HTF trades.
 *
 * 1:1 TypeScript port of `backend/patterns/position_sizing.py`. Used by the
 * /htf scanner to convert a detected breakout into a concrete "buy N shares"
 * recommendation, and by the portfolio gate to enforce account-wide caps.
 *
 * Account config is persisted in the existing `accountSettings` drizzle
 * table (per memory: reuse, don't duplicate). PortfolioState reads from the
 * existing `trades` table (no parallel portfolio.json). The dataclass-style
 * shapes below match what the API endpoints return verbatim.
 *
 * ── CAPITAL-PRESERVATION RULES (docs/RULES.md §6) ──────────────────────
 * §6 is THE success bar: "don't lose money" = positive expectancy + a
 * controlled worst-case drawdown, NOT beating SPY. The hard numbers below
 * come straight from the trading books in docs/books/:
 *
 *   • maxRiskPerTradePct = 0.02  — never risk >2% of the account on one
 *     trade (Aziz, *Mastering Trading Psychology*). Was 0.10 = 5× too hot;
 *     2% is the headline capital-preservation fix.
 *   • stopLossMaxPct     = 0.08  — cut every loss at ≤8% from cost
 *     (O'Neil, *How to Make Money in Stocks*). A wider stop only warns; the
 *     2% risk cap already shrinks the share count so total risk stays ≤2%.
 *   • maxChasePct        = 0.05  — never enter >5% above the pivot
 *     (O'Neil). Surfaced via entryIsChased() for the engine/bot.
 *   • maxDailyLossPct    = 0.01  /  maxWeeklyLossPct = 0.03 — Aziz
 *     circuit-breaker: stop trading for the day/week once realized losses
 *     hit these. Config + helpers (dailyLossBreached/weeklyLossBreached)
 *     land now; ENFORCEMENT is the trading-bot loop (not yet built).
 *   • assumedSpreadDollars = 0.10 — price-scaled slippage so a $5 name is
 *     charged far more spread than a $50 name (O'Neil O7 + the liquidity
 *     book, *Liquidity, Markets and Trading in Action*). See
 *     effectiveSlippagePct().
 *   • Never average down — canAddPosition() blocks adding to ANY held
 *     symbol (O'Neil + Aziz). See the comment there.
 *
 * Keep this file in 1:1 parity with backend/patterns/position_sizing.py
 * (npm run htf:parity). Edits here must be mirrored there identically.
 */

import type { HtfHit } from "../strategies/htf";

// ─── Configuration ─────────────────────────────────────────────────────
export interface AccountConfig {
  capital: number;
  maxRiskPerTradePct: number;       // 0.02 = 2% of capital (Aziz — never risk >2% on one trade)
  maxPositionPct: number;           // 0.25 = 25% of capital max in one name
  maxSimultaneousPositions: number;
  maxSectorExposurePct: number;     // 0.40 = 40% in one sector
  maxTotalOpenRiskPct: number;      // 0.30 = 30% of capital at risk
  minRewardRiskRatio: number;       // 2.0 = require 2:1
  commissionPerTrade: number;
  slippagePct: number;
  stopLossMaxPct: number;           // 0.08 = cut every loss at ≤8% from cost (O'Neil)
  maxChasePct: number;              // 0.05 = never enter >5% above the pivot (O'Neil)
  maxDailyLossPct: number;          // 0.01 = stop for the day at 1% realized loss (Aziz)
  maxWeeklyLossPct: number;         // 0.03 = stop for the week at 3% realized loss (Aziz)
  assumedSpreadDollars: number;     // 0.10 = assumed bid/ask spread $ (O'Neil O7 + liquidity book)
}

export const DEFAULT_ACCOUNT_CONFIG: AccountConfig = {
  capital: 7000,
  maxRiskPerTradePct: 0.02,
  maxPositionPct: 0.25,
  maxSimultaneousPositions: 5,
  maxSectorExposurePct: 0.4,
  maxTotalOpenRiskPct: 0.3,
  minRewardRiskRatio: 2.0,
  commissionPerTrade: 0,
  slippagePct: 0.002,
  stopLossMaxPct: 0.08,
  maxChasePct: 0.05,
  maxDailyLossPct: 0.01,
  maxWeeklyLossPct: 0.03,
  assumedSpreadDollars: 0.1,
};

export function maxRiskPerTrade(c: AccountConfig): number {
  return c.capital * c.maxRiskPerTradePct;
}
export function maxPositionSize(c: AccountConfig): number {
  return c.capital * c.maxPositionPct;
}
export function maxTotalOpenRisk(c: AccountConfig): number {
  return c.capital * c.maxTotalOpenRiskPct;
}
export function maxSectorExposure(c: AccountConfig): number {
  return c.capital * c.maxSectorExposurePct;
}

// ─── Capital-preservation helpers (docs/RULES.md §6) ───────────────────

/**
 * O'Neil: never chase an entry more than maxChasePct above the pivot.
 * True when currentPrice has run > pivotPrice * (1 + maxChasePct).
 * Pure helper for the engine/bot. (Note: htf.ts keeps its own
 * HTF_MAX_CHASE_PCT for htfLiveStatus — left as-is for now.)
 */
export function entryIsChased(
  currentPrice: number,
  pivotPrice: number,
  config: AccountConfig,
): boolean {
  if (pivotPrice <= 0) return false;
  return currentPrice > pivotPrice * (1 + config.maxChasePct);
}

/**
 * Aziz circuit-breaker: stop trading for the DAY once realized losses for
 * today reach maxDailyLossPct of the account. `realizedTodayPct` is a
 * signed fraction of capital (a 1% loss is -0.01). True = breached.
 * ENFORCED by the trading-bot loop (not yet built) — config + helper land now.
 */
export function dailyLossBreached(realizedTodayPct: number, config: AccountConfig): boolean {
  return realizedTodayPct <= -config.maxDailyLossPct;
}

/**
 * Aziz circuit-breaker: stop trading for the WEEK once realized losses for
 * the week reach maxWeeklyLossPct of the account. `realizedThisWeekPct` is a
 * signed fraction of capital (a 3% loss is -0.03). True = breached.
 * ENFORCED by the trading-bot loop (not yet built) — config + helper land now.
 */
export function weeklyLossBreached(realizedThisWeekPct: number, config: AccountConfig): boolean {
  return realizedThisWeekPct <= -config.maxWeeklyLossPct;
}

/**
 * Price-scaled slippage (O'Neil O7 + the liquidity book): the modeled cost is
 * the flat slippagePct PLUS half the assumed bid/ask spread expressed as a
 * fraction of price. A $5 name pays far more spread, proportionally, than a
 * $50 name. Exported for the validation harness + bot (and applied wherever
 * slippage is modeled).
 */
export function effectiveSlippagePct(price: number, config: AccountConfig): number {
  if (price <= 0) return config.slippagePct;
  return config.slippagePct + (config.assumedSpreadDollars / 2) / price;
}

// ─── Position recommendation ───────────────────────────────────────────
export interface PositionRecommendation {
  symbol: string;
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  riskPerShare: number;
  rewardPerShare: number;
  rewardRiskRatio: number;
  maxSharesByRisk: number;
  maxSharesByPosition: number;
  recommendedShares: number;        // 0 if blocked
  positionValue: number;
  actualRisk: number;
  pctOfCapital: number;
  expectedProfitAtTarget: number;
  warnings: string[];
  blockedReason: string | null;
}

export function isActionable(rec: PositionRecommendation): boolean {
  return rec.blockedReason === null && rec.recommendedShares > 0;
}

export function sizePosition(hit: HtfHit, config: AccountConfig): PositionRecommendation {
  const entry = hit.breakoutPrice;
  const stop = hit.stopPrice;
  const target = hit.targetPrice;

  const warnings: string[] = [];

  if (entry <= 0 || stop <= 0) {
    return blocked(hit.symbol, entry, stop, target, "invalid entry/stop prices");
  }

  // HTF is long-only — direction is always "long"
  const riskPerShare = entry - stop;
  const rewardPerShare = target - entry;

  if (riskPerShare <= 0) {
    return blocked(hit.symbol, entry, stop, target, "stop is on wrong side of entry");
  }

  const rewardRiskRatio = rewardPerShare / riskPerShare;
  const maxByRisk = Math.floor(maxRiskPerTrade(config) / riskPerShare);
  const maxByPosition = Math.floor(maxPositionSize(config) / entry);
  const recommended = Math.min(maxByRisk, maxByPosition);

  let blockedReason: string | null = null;
  if (recommended < 1) {
    blockedReason =
      `unaffordable: 1 share = $${entry.toFixed(2)} exceeds max position $${maxPositionSize(config).toFixed(0)}`;
  } else if (rewardRiskRatio < 1.0) {
    // Only a sub-1:1 setup is a non-trade by definition (the target is closer
    // than the stop — a losing trade by design). R/R between 1:1 and the
    // configured minimum is a non-blocking WARNING, not a hard block — matches
    // the Python reference (size_position). Hard-blocking everything below the
    // 2:1 minimum silently killed valid setups (LUNR 1.83, BKSY 1.63).
    blockedReason =
      `reward/risk ${rewardRiskRatio.toFixed(2)}:1 — losing trade by design (target closer than stop)`;
  }

  const positionValue = recommended * entry;
  const actualRisk = recommended * riskPerShare;
  const pctCapital = config.capital > 0 ? positionValue / config.capital : 0;
  const expectedProfit = recommended * rewardPerShare;

  if (rewardRiskRatio < config.minRewardRiskRatio) {
    warnings.push(`R/R ${rewardRiskRatio.toFixed(1)} below your ${config.minRewardRiskRatio}:1 minimum`);
  }
  if (pctCapital > 0.2) {
    warnings.push(`large position (${Math.round(pctCapital * 100)}% of capital)`);
  }
  if (pctCapital < 0.05 && recommended > 0) {
    warnings.push(`tiny position (${Math.round(pctCapital * 100)}% — may not be worth commissions)`);
  }
  if (hit.qualityScore < 70) {
    warnings.push(`low quality score (${hit.qualityScore})`);
  }
  if (maxByPosition < maxByRisk) {
    warnings.push("position-cap limited (wide stop on expensive stock)");
  }
  // O'Neil: cut every loss at ≤8% from cost. A wider stop is NOT blocked (the
  // 2% per-trade risk cap already shrank the share count to keep risk ≤2%), but
  // it earns a warning so the trader sees the stop is past O'Neil's max.
  const stopPct = entry > 0 ? (entry - stop) / entry : 0;
  if (stopPct > config.stopLossMaxPct) {
    warnings.push(
      `stop ${Math.round(stopPct * 100)}% below entry exceeds your ${Math.round(config.stopLossMaxPct * 100)}% max (O'Neil) — position auto-sized down to keep risk ≤${Math.round(config.maxRiskPerTradePct * 100)}%`,
    );
  }

  return {
    symbol: hit.symbol,
    entryPrice: entry,
    stopPrice: stop,
    targetPrice: target,
    riskPerShare,
    rewardPerShare,
    rewardRiskRatio,
    maxSharesByRisk: maxByRisk,
    maxSharesByPosition: maxByPosition,
    recommendedShares: recommended,
    positionValue,
    actualRisk,
    pctOfCapital: pctCapital,
    expectedProfitAtTarget: expectedProfit,
    warnings,
    blockedReason,
  };
}

function blocked(
  symbol: string,
  entry: number,
  stop: number,
  target: number,
  reason: string,
): PositionRecommendation {
  return {
    symbol,
    entryPrice: entry,
    stopPrice: stop,
    targetPrice: target,
    riskPerShare: 0,
    rewardPerShare: 0,
    rewardRiskRatio: 0,
    maxSharesByRisk: 0,
    maxSharesByPosition: 0,
    recommendedShares: 0,
    positionValue: 0,
    actualRisk: 0,
    pctOfCapital: 0,
    expectedProfitAtTarget: 0,
    warnings: [],
    blockedReason: reason,
  };
}

// ─── Portfolio state ───────────────────────────────────────────────────
export interface OpenPosition {
  symbol: string;
  sector: string;
  shares: number;
  entryPrice: number;
  /**
   * Stop price. `null` = no real stop was recorded at trade-open time, so
   * downstream risk math (`positionAtRisk`) reports 0 instead of fabricating
   * a number from `target`. The Portfolio tab UI shows "—" for null stops.
   */
  stopPrice: number | null;
  /** Profit target — surfaced on the Portfolio tab. null when not recorded. */
  targetPrice?: number | null;
  entryDate: string;          // YYYY-MM-DD
  currentPrice?: number;
}

export function positionValue(p: OpenPosition): number {
  const price = p.currentPrice ?? p.entryPrice;
  return p.shares * price;
}

export function positionAtRisk(p: OpenPosition): number {
  // Conservative: use entry-vs-stop, ignores trailing-stop adjustments.
  // If no real stop was recorded, at-risk is undefined → report 0 rather
  // than computing nonsense from a missing field.
  if (p.stopPrice == null) return 0;
  return Math.max(0, p.shares * (p.entryPrice - p.stopPrice));
}

export class PortfolioState {
  positions: OpenPosition[];

  constructor(positions: OpenPosition[] = []) {
    this.positions = positions;
  }

  get totalValue(): number {
    return this.positions.reduce((a, p) => a + positionValue(p), 0);
  }

  get totalOpenRisk(): number {
    return this.positions.reduce((a, p) => a + positionAtRisk(p), 0);
  }

  sectorExposure(sector: string): number {
    return this.positions
      .filter(p => p.sector === sector)
      .reduce((a, p) => a + positionValue(p), 0);
  }

  canAddPosition(
    rec: PositionRecommendation,
    hit: HtfHit,
    config: AccountConfig,
    sector = "Unknown",
  ): { allowed: boolean; reason: string } {
    if (!isActionable(rec)) {
      return { allowed: false, reason: rec.blockedReason || "not actionable" };
    }
    // Never average down (O'Neil + Aziz): blocking adds to ANY already-held
    // symbol enforces this — you can't pour more capital into an open loser.
    if (this.positions.some(p => p.symbol === hit.symbol)) {
      return { allowed: false, reason: `already hold ${hit.symbol}` };
    }
    if (this.positions.length >= config.maxSimultaneousPositions) {
      return {
        allowed: false,
        reason: `at max positions (${this.positions.length}/${config.maxSimultaneousPositions})`,
      };
    }
    const newTotalRisk = this.totalOpenRisk + rec.actualRisk;
    if (newTotalRisk > maxTotalOpenRisk(config)) {
      return {
        allowed: false,
        reason: `would exceed max open risk: $${newTotalRisk.toFixed(0)} > $${maxTotalOpenRisk(config).toFixed(0)}`,
      };
    }
    const newSectorExposure = this.sectorExposure(sector) + rec.positionValue;
    if (newSectorExposure > maxSectorExposure(config)) {
      return {
        allowed: false,
        reason: `would exceed ${sector} sector cap: $${newSectorExposure.toFixed(0)} > $${maxSectorExposure(config).toFixed(0)}`,
      };
    }
    return { allowed: true, reason: "" };
  }

  addPosition(rec: PositionRecommendation, hit: HtfHit, sector = "Unknown"): void {
    this.positions.push({
      symbol: hit.symbol,
      sector,
      shares: rec.recommendedShares,
      entryPrice: rec.entryPrice,
      stopPrice: rec.stopPrice,
      entryDate: new Date().toISOString().slice(0, 10),
    });
  }

  removePosition(symbol: string): void {
    this.positions = this.positions.filter(p => p.symbol !== symbol);
  }

  statusSummary(config: AccountConfig) {
    return {
      nOpen: this.positions.length,
      maxOpen: config.maxSimultaneousPositions,
      capacityRemaining: config.maxSimultaneousPositions - this.positions.length,
      totalValue: round2(this.totalValue),
      totalOpenRisk: round2(this.totalOpenRisk),
      maxOpenRisk: round2(maxTotalOpenRisk(config)),
      openRiskPct: maxTotalOpenRisk(config) > 0
        ? round1((this.totalOpenRisk / maxTotalOpenRisk(config)) * 100)
        : 0,
      cashRemainingEstimate: round2(config.capital - this.totalValue),
      positions: this.positions.map(p => {
        const currentPrice = p.currentPrice ?? null;
        const unrealizedPL = currentPrice != null
          ? round2(p.shares * (currentPrice - p.entryPrice))
          : null;
        const daysHeld = (() => {
          if (!p.entryDate) return null;
          const ms = Date.now() - new Date(p.entryDate).getTime();
          return Math.max(0, Math.floor(ms / 86400000));
        })();
        return {
          symbol: p.symbol,
          sector: p.sector,
          shares: p.shares,
          entry: round2(p.entryPrice),
          stop: p.stopPrice,                          // null when not recorded — UI shows "—"
          target: p.targetPrice ?? null,
          currentPrice,
          unrealizedPL,
          value: round2(positionValue(p)),
          atRisk: round2(positionAtRisk(p)),
          entryDate: p.entryDate,
          daysHeld,
        };
      }),
    };
  }
}

function round1(n: number): number { return Math.round(n * 10) / 10; }
function round2(n: number): number { return Math.round(n * 100) / 100; }
