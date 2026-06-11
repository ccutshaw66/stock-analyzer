/**
 * FMP dividend data — single canonical source for everything dividend-related
 * on the site (single-ticker lookup, scan, weekly strategy, portfolio).
 *
 * Replaces the legacy Polygon-via-canonical shape path (`extractDividendData` +
 * `getQuoteLight` → `getPolygonQuoteSummary`). Polygon is on the kill list.
 *
 * Sources (FMP stable API), fetched in parallel:
 *   - /quote        → live price + company name
 *   - /dividends    → dividend history (ex-date, pay-date, per-record yield,
 *                     frequency string) — FMP gives `frequency` directly, so
 *                     the old ratio-based frequency guess is gone.
 *   - /ratios-ttm   → dividendYieldTTM, dividendPayoutRatioTTM, dividendPerShareTTM
 *
 * Caching: fmpGet() already caches each endpoint in-memory; route-level
 * aggregation caches (scan 6h, weekly 7d) layer on top per the caching strategy.
 */
import { fmpGet } from "./fmp.client";

/** Canonical dividend shape consumed by all four dividend routes + the frontend. */
export interface DividendData {
  ticker: string;
  companyName: string;
  price: number;
  dividendYield: number;
  dividendRate: number;
  exDividendDate: string | null;
  distributionDate: string | null;
  payoutRatio: number;
  trailingYield: number;
  fiveYearAvgYield: number | null;
  lastDividendValue: number | null;
  lastDividendDate: string | null;
  frequency: string; // "Monthly" | "Quarterly" | "Semi-Annual" | "Annual"
  annualDividend: number;
  dividendGrowth: number | null;
  score: number;
}

interface FmpDividendRecord {
  date?: string;          // ex-dividend date
  recordDate?: string;
  paymentDate?: string;
  declarationDate?: string;
  adjDividend?: number;
  dividend?: number;
  yield?: number;         // annualized yield % at that record
  frequency?: string;
}

function n(x: any): number | null {
  const v = Number(x);
  return Number.isFinite(v) ? v : null;
}

/** Normalize FMP's frequency string to our canonical four values. */
function normalizeFrequency(raw: string | undefined, recordCount: number, records: FmpDividendRecord[]): string {
  const s = String(raw || "").toLowerCase();
  if (s.includes("month")) return "Monthly";
  if (s.includes("quarter")) return "Quarterly";
  if (s.includes("semi") || s.includes("bi-annual") || s.includes("biannual")) return "Semi-Annual";
  if (s.includes("annual") || s.includes("year")) return "Annual";
  // Fallback: infer from spacing of the last few ex-dates.
  if (records.length >= 2) {
    const dates = records
      .map((r) => (r.date ? new Date(r.date).getTime() : NaN))
      .filter((t) => Number.isFinite(t))
      .sort((a, b) => b - a);
    if (dates.length >= 2) {
      const gapDays = (dates[0] - dates[1]) / (1000 * 60 * 60 * 24);
      if (gapDays <= 45) return "Monthly";
      if (gapDays <= 135) return "Quarterly";
      if (gapDays <= 270) return "Semi-Annual";
      return "Annual";
    }
  }
  return "Quarterly";
}

function frequencyMultiplier(freq: string): number {
  switch (freq) {
    case "Monthly": return 12;
    case "Quarterly": return 4;
    case "Semi-Annual": return 2;
    case "Annual": return 1;
    default: return 4;
  }
}

/** Number of months between payments for a given frequency. */
function frequencyMonths(freq: string): number {
  switch (freq) {
    case "Monthly": return 1;
    case "Quarterly": return 3;
    case "Semi-Annual": return 6;
    case "Annual": return 12;
    default: return 3;
  }
}

const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * Project the next (upcoming) ex-dividend date by rolling the most recent
 * ex-date forward one frequency interval at a time until it lands in the
 * future. FMP's historical /dividends feed stops at the last PASSED ex-date,
 * and upcoming dates are often undeclared, so this projection is how we surface
 * a forward-looking "next ex-date" (matching the legacy calendar behavior).
 */
function projectForward(from: Date, frequency: string, now: number): Date {
  const months = frequencyMonths(frequency);
  const d = new Date(from);
  let guard = 0;
  while (d.getTime() <= now && guard < 120) {
    d.setMonth(d.getMonth() + months);
    guard++;
  }
  return d;
}

/**
 * Quality score (0-100). Ported verbatim from the legacy extractDividendData so
 * scan ranking and the displayed score stay identical across the migration.
 */
function scoreDividend(dividendYield: number, payoutRatio: number, fiveYearAvgYield: number | null, dividendRate: number, frequency: string): number {
  let score = 0;
  if (dividendYield > 5) score += 25;
  else if (dividendYield > 3) score += 20;
  else if (dividendYield > 2) score += 15;
  else if (dividendYield > 1) score += 10;

  if (payoutRatio > 0 && payoutRatio <= 80) score += 20;
  else if (payoutRatio > 80 && payoutRatio <= 100) score += 15;
  else if (payoutRatio > 100) score += 5;
  else if (payoutRatio === 0) score += 10;

  if (fiveYearAvgYield != null && dividendYield > fiveYearAvgYield) score += 15;
  else if (fiveYearAvgYield != null) score += 5;

  if (dividendRate > 0) score += 10;

  if (frequency === "Monthly") score += 15;
  else if (frequency === "Quarterly") score += 15;
  else if (frequency === "Semi-Annual") score += 10;
  else if (frequency === "Annual") score += 5;

  if (dividendYield >= 3 && payoutRatio > 0 && payoutRatio < 100) score += 5;
  if (dividendYield >= 4 && payoutRatio > 0 && payoutRatio <= 80) score += 5;

  return score;
}

/**
 * Fetch and assemble dividend data for one ticker from FMP. Returns null if the
 * ticker has no usable price (delisted / unknown) — callers treat null as "skip".
 * A non-payer (no dividend history and no TTM dividend) returns a zeroed record
 * so callers can decide to skip it (they check dividendRate / dividendYield).
 */
export async function getFmpDividendData(ticker: string): Promise<DividendData | null> {
  const T = ticker.toUpperCase();
  const [quoteRows, divRows, ratiosRows] = await Promise.all([
    fmpGet<any[]>(`/quote`, { symbol: T }).catch(() => []),
    fmpGet<any[]>(`/dividends`, { symbol: T, limit: 24 }).catch(() => []),
    fmpGet<any[]>(`/ratios-ttm`, { symbol: T }).catch(() => []),
  ]);

  const q = Array.isArray(quoteRows) && quoteRows.length ? quoteRows[0] : null;
  if (!q) return null;
  const price = n(q.price) ?? 0;
  if (price <= 0) return null;
  const companyName = q.name || q.companyName || T;

  const records: FmpDividendRecord[] = Array.isArray(divRows) ? divRows : [];
  const ratios = Array.isArray(ratiosRows) && ratiosRows.length ? ratiosRows[0] : {};

  const now = Date.now();
  const sorted = records
    .filter((r) => r.date)
    .sort((a, b) => new Date(b.date!).getTime() - new Date(a.date!).getTime());
  const past = sorted.filter((r) => new Date(r.date!).getTime() <= now);
  const upcoming = sorted.filter((r) => new Date(r.date!).getTime() > now);

  const mostRecent = past[0] ?? sorted[0] ?? null;
  const nextEx = upcoming.length ? upcoming[upcoming.length - 1] : null; // nearest genuine future record

  const lastDividendValue = mostRecent ? (n(mostRecent.dividend) ?? n(mostRecent.adjDividend)) : null;
  const lastDividendDate = mostRecent?.date ?? null;

  const frequency = normalizeFrequency(mostRecent?.frequency, sorted.length, sorted);

  // UPCOMING ex-date + pay-date (users buy BEFORE the ex-date to capture the
  // dividend, so the forward-looking date is what matters). Prefer a genuine
  // future record from FMP; otherwise project the next one forward from the
  // most recent ex-date by the payout frequency.
  let exDividendDate: string | null = null;
  let distributionDate: string | null = null;
  if (nextEx) {
    exDividendDate = nextEx.date ?? null;
    distributionDate = nextEx.paymentDate ?? null;
  } else if (mostRecent?.date) {
    const projEx = projectForward(new Date(mostRecent.date), frequency, now);
    exDividendDate = isoDay(projEx);
    if (mostRecent.paymentDate) {
      // Apply the most recent ex→pay gap to the projected ex-date.
      const gapMs = new Date(mostRecent.paymentDate).getTime() - new Date(mostRecent.date).getTime();
      distributionDate = Number.isFinite(gapMs) && gapMs >= 0
        ? isoDay(new Date(projEx.getTime() + gapMs))
        : null;
    }
  }

  // Annual dividend rate: prefer TTM per-share, else sum trailing 365 days of
  // ex-dated dividends, else extrapolate last dividend by frequency.
  const perShareTtm = n(ratios.dividendPerShareTTM);
  let annualDividend = perShareTtm && perShareTtm > 0 ? perShareTtm : 0;
  if (annualDividend <= 0) {
    const yearAgo = now - 365 * 24 * 60 * 60 * 1000;
    const trailing = past
      .filter((r) => new Date(r.date!).getTime() >= yearAgo)
      .reduce((s, r) => s + (n(r.dividend) ?? 0), 0);
    if (trailing > 0) annualDividend = trailing;
    else if (lastDividendValue && lastDividendValue > 0) {
      annualDividend = lastDividendValue * frequencyMultiplier(frequency);
    }
  }

  // Yield: prefer ratios-ttm (FMP returns a fraction), else annual/price.
  const dyTtm = n(ratios.dividendYieldTTM);
  let dividendYield = dyTtm != null && dyTtm > 0 ? dyTtm * 100 : (price > 0 ? (annualDividend / price) * 100 : 0);
  dividendYield = Number(dividendYield.toFixed(2));

  const payoutTtm = n(ratios.dividendPayoutRatioTTM);
  const payoutRatio = payoutTtm != null ? Number((payoutTtm * 100).toFixed(2)) : 0;

  // 5-year average yield: mean of the per-record annualized yields within 5y.
  const fiveYearAgo = now - 5 * 365 * 24 * 60 * 60 * 1000;
  const yieldsInWindow = past
    .filter((r) => new Date(r.date!).getTime() >= fiveYearAgo)
    .map((r) => n(r.yield))
    .filter((v): v is number => v != null && v > 0);
  const fiveYearAvgYield = yieldsInWindow.length
    ? Number((yieldsInWindow.reduce((s, v) => s + v, 0) / yieldsInWindow.length).toFixed(2))
    : null;

  const trailingYield = dividendYield; // TTM yield == trailing annual yield on FMP

  const score = scoreDividend(dividendYield, payoutRatio, fiveYearAvgYield, annualDividend, frequency);

  return {
    ticker: T,
    companyName,
    price: Number(price.toFixed(2)),
    dividendYield,
    dividendRate: Number(annualDividend.toFixed(2)),
    exDividendDate,
    distributionDate,
    payoutRatio,
    trailingYield,
    fiveYearAvgYield,
    lastDividendValue: lastDividendValue != null ? Number(lastDividendValue.toFixed(4)) : null,
    lastDividendDate,
    frequency,
    annualDividend: Number(annualDividend.toFixed(2)),
    dividendGrowth: null,
    score,
  };
}
