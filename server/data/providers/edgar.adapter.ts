/**
 * SEC EDGAR 13F adapter.
 *
 * Replaces Yahoo institutional ownership. Returns top institutional holders
 * and percent-of-shares-outstanding held, sourced from 13F-HR filings.
 *
 * NOTE: This is the Phase 3.4a minimal implementation:
 *   - Top N holders by position value (latest 13F filed for the ticker's CUSIP)
 *   - institutionPct = sum(positions) / sharesOutstanding
 *   - No QoQ flow scoring yet (that's 3.4b)
 *
 * Approach:
 *   1. Resolve ticker -> CIK via SEC company_tickers.json
 *   2. Fetch company submissions to get CUSIP + sharesOutstanding (from /api/xbrl)
 *   3. Iterate recent 13F-HR filings from a curated list of major filers,
 *      OR use EDGAR full-text search for the CUSIP.
 *   4. Parse 13F Information Table XML for matching CUSIP rows.
 *   5. Aggregate by filer, sort by value, return top N.
 *
 * Since cross-referencing every 13F filer globally is expensive, 3.4a uses
 * EDGAR's full-text search (efts.sec.gov) to find filings that reference the
 * target CUSIP, then parses only those Information Tables.
 */

import { edgarFetch, edgarFetchJson } from "./edgar.client";

// In-process cache (same pattern as fmp.adapter)
type CacheEntry<T> = { value: T; expiresAt: number };
const cache = new Map<string, CacheEntry<any>>();
function getCached<T>(k: string): T | null {
  const e = cache.get(k);
  if (!e) return null;
  if (Date.now() > e.expiresAt) { cache.delete(k); return null; }
  return e.value as T;
}
function setCached<T>(k: string, v: T, ttlMs: number) {
  cache.set(k, { value: v, expiresAt: Date.now() + ttlMs });
}

const TTL_TICKER_MAP = 24 * 60 * 60 * 1000; // 24h
const TTL_FILING_LIST = 6 * 60 * 60 * 1000; // 6h
const TTL_HOLDINGS = 6 * 60 * 60 * 1000;    // 6h

// ------------------------------------------------------------
// 1. Ticker -> CIK mapping
// ------------------------------------------------------------

interface CompanyTicker { cik_str: number; ticker: string; title: string; }
interface TickerMap { [ticker: string]: { cik: string; title: string } }

let tickerMapPromise: Promise<TickerMap> | null = null;

export async function getTickerMap(): Promise<TickerMap> {
  const cached = getCached<TickerMap>("ticker_map");
  if (cached) return cached;
  if (tickerMapPromise) return tickerMapPromise;

  tickerMapPromise = (async () => {
    const raw = await edgarFetchJson<Record<string, CompanyTicker>>(
      "https://www.sec.gov/files/company_tickers.json"
    );
    const map: TickerMap = {};
    for (const row of Object.values(raw)) {
      map[row.ticker.toUpperCase()] = {
        cik: String(row.cik_str).padStart(10, "0"),
        title: row.title,
      };
    }
    setCached("ticker_map", map, TTL_TICKER_MAP);
    return map;
  })();

  try {
    return await tickerMapPromise;
  } finally {
    tickerMapPromise = null;
  }
}

export async function tickerToCik(ticker: string): Promise<{ cik: string; title: string } | null> {
  const map = await getTickerMap();
  return map[ticker.toUpperCase()] ?? null;
}

// ------------------------------------------------------------
// 2. Shares outstanding + CUSIP via XBRL company facts
// ------------------------------------------------------------

export interface CompanyBasics {
  cik: string;
  title: string;
  sharesOutstanding: number | null;
  sharesAsOf: string | null;
}

export async function getCompanyBasics(ticker: string): Promise<CompanyBasics | null> {
  const key = `basics:${ticker.toUpperCase()}`;
  const cached = getCached<CompanyBasics>(key);
  if (cached) return cached;

  const lookup = await tickerToCik(ticker);
  if (!lookup) return null;

  // XBRL company facts — pull CommonStockSharesOutstanding (most recent)
  let sharesOutstanding: number | null = null;
  let sharesAsOf: string | null = null;
  try {
    const facts: any = await edgarFetchJson(
      `https://data.sec.gov/api/xbrl/companyfacts/CIK${lookup.cik}.json`
    );
    const unitList =
      facts?.facts?.["us-gaap"]?.CommonStockSharesOutstanding?.units?.shares ??
      facts?.facts?.["dei"]?.EntityCommonStockSharesOutstanding?.units?.shares ??
      [];
    if (Array.isArray(unitList) && unitList.length) {
      // Take the most recent by 'end' date
      const sorted = [...unitList].sort((a: any, b: any) =>
        String(b.end || "").localeCompare(String(a.end || ""))
      );
      const latest = sorted[0];
      sharesOutstanding = Number(latest?.val) || null;
      sharesAsOf = latest?.end || null;
    }
  } catch {
    // non-fatal; basics is still usable without shares
  }

  const basics: CompanyBasics = {
    cik: lookup.cik,
    title: lookup.title,
    sharesOutstanding,
    sharesAsOf,
  };
  setCached(key, basics, TTL_FILING_LIST);
  return basics;
}

// ------------------------------------------------------------
// 3. Find 13F-HR filings referencing this security (via full-text search)
// ------------------------------------------------------------

interface EftsHit {
  _id: string;               // e.g. "0001234567-24-000123:primary_doc.xml"
  _source: {
    ciks: string[];
    display_names: string[]; // filer names
    file_date: string;
    form: string;
    adsh: string;            // accession number w/ dashes
  };
}

interface EftsResponse {
  hits: { hits: EftsHit[]; total: { value: number } };
}

export interface FilingRef {
  accession: string;        // 0001234567-24-000123
  accessionNoDashes: string;
  cik: string;
  filerName: string;
  filedAt: string;
  form: string;
}

/**
 * Use EDGAR full-text search to find 13F-HR filings referencing the ticker.
 * Filer names often include the ticker symbol or company name in their
 * Information Table; this is a starting set we then narrow by CUSIP.
 */
export async function searchThirteenFFilings(
  query: string,
  limit = 40
): Promise<FilingRef[]> {
  const url =
    `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(`"${query}"`)}` +
    `&dateRange=custom&startdt=${getStartDate()}&enddt=${getEndDate()}` +
    `&forms=13F-HR`;
  const data = await edgarFetchJson<EftsResponse>(url);
  const hits = data?.hits?.hits ?? [];
  const refs: FilingRef[] = [];
  for (const h of hits.slice(0, limit)) {
    const s = h._source;
    if (!s?.adsh) continue;
    refs.push({
      accession: s.adsh,
      accessionNoDashes: s.adsh.replace(/-/g, ""),
      cik: (s.ciks?.[0] ?? "").padStart(10, "0"),
      filerName: s.display_names?.[0] ?? "Unknown",
      filedAt: s.file_date,
      form: s.form,
    });
  }
  return refs;
}

function getEndDate(): string {
  return new Date().toISOString().slice(0, 10);
}
function getStartDate(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 6); // last 6 months captures most recent quarter's 13Fs
  return d.toISOString().slice(0, 10);
}

// ------------------------------------------------------------
// 4. Parse 13F Information Table XML
// ------------------------------------------------------------

export interface HoldingRow {
  nameOfIssuer: string;
  cusip: string;
  value: number;       // in USD (13Fs post-2022 are in whole dollars; pre-2022 in thousands)
  sshPrnamt: number;   // shares
  sshPrnamtType: string; // 'SH' or 'PRN'
}

/**
 * Fetch and parse the Information Table for a 13F filing.
 * Returns rows matching the target CUSIP (or all rows if cusip omitted).
 */
export async function getInformationTable(
  ref: FilingRef,
  cusipFilter?: string
): Promise<HoldingRow[]> {
  // Filing index: https://www.sec.gov/Archives/edgar/data/{cik}/{accessionNoDashes}/
  const base = `https://www.sec.gov/Archives/edgar/data/${Number(ref.cik)}/${ref.accessionNoDashes}`;

  // Try to locate the Information Table XML. Filers commonly name it
  // "infotable.xml" or "*_informationtable.xml"; the index.json lists items.
  let infoUrl: string | null = null;
  try {
    const idx: any = await edgarFetchJson(`${base}/index.json`);
    const items: any[] = idx?.directory?.item ?? [];
    const match = items.find((i: any) => {
      const n = String(i.name || "").toLowerCase();
      return n.endsWith(".xml") && (n.includes("infotable") || n.includes("information"));
    });
    if (match) infoUrl = `${base}/${match.name}`;
  } catch {
    return [];
  }
  if (!infoUrl) return [];

  let xml: string;
  try {
    xml = await edgarFetch(infoUrl, { accept: "text/xml" });
  } catch {
    return [];
  }

  return parseInformationTableXml(xml, cusipFilter);
}

/**
 * Lightweight 13F Information Table XML parser. Avoids pulling a full XML
 * dependency: uses regex across the `<infoTable>...</infoTable>` blocks.
 */
export function parseInformationTableXml(xml: string, cusipFilter?: string): HoldingRow[] {
  const rows: HoldingRow[] = [];
  const blockRe = /<(?:ns1:|n1:|\w+:)?infoTable[^>]*>([\s\S]*?)<\/(?:ns1:|n1:|\w+:)?infoTable>/gi;
  const wantedCusip = cusipFilter?.replace(/\s+/g, "").toUpperCase();
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(xml)) !== null) {
    const block = m[1];
    const cusip = pickTag(block, "cusip");
    if (wantedCusip && cusip?.replace(/\s+/g, "").toUpperCase() !== wantedCusip) continue;
    const nameOfIssuer = pickTag(block, "nameOfIssuer") || "Unknown";
    const valueStr = pickTag(block, "value") || "0";
    const sshPrnamtStr = pickTag(block, "sshPrnamt") || "0";
    const sshPrnamtType = pickTag(block, "sshPrnamtType") || "SH";
    rows.push({
      nameOfIssuer,
      cusip: cusip ?? "",
      value: Number(valueStr.replace(/,/g, "")) || 0,
      sshPrnamt: Number(sshPrnamtStr.replace(/,/g, "")) || 0,
      sshPrnamtType,
    });
  }
  return rows;
}

function pickTag(xml: string, tag: string): string | null {
  const re = new RegExp(`<(?:\\w+:)?${tag}>([^<]*)</(?:\\w+:)?${tag}>`, "i");
  const m = xml.match(re);
  return m ? m[1].trim() : null;
}

// ------------------------------------------------------------
// 5. Aggregator — top institutional holders
// ------------------------------------------------------------

export interface TopHolder {
  name: string;
  cik: string;
  accession: string;
  filedAt: string;
  shares: number;
  value: number;        // USD (already normalized to whole dollars)
  pctHeld: number;      // 0..1 of sharesOutstanding
  reportDate: string;   // = filedAt (3.4a)
}

export interface InstitutionalSummary {
  ticker: string;
  cik: string;
  companyName: string;
  sharesOutstanding: number | null;
  sharesAsOf: string | null;
  institutionPct: number;       // 0..100
  institutionCount: number;
  topHolders: TopHolder[];
  asOf: string;                 // latest filedAt seen
  source: "sec-edgar-13f";
}

/**
 * Build top-holder list for a ticker.
 *
 * 3.4a implementation:
 *   - Full-text search 13F-HR filings mentioning the ticker or company name
 *   - Fetch each filing's Information Table; filter to the target CUSIP
 *     (auto-detected from the most common CUSIP tied to the issuer name across filings)
 *   - Aggregate by filer (latest filing per CIK)
 *   - Compute pctHeld = shares / sharesOutstanding
 */
export async function getInstitutionalSummary(
  ticker: string,
  topN = 25
): Promise<InstitutionalSummary | null> {
  const cacheKey = `inst:${ticker.toUpperCase()}`;
  const cached = getCached<InstitutionalSummary>(cacheKey);
  if (cached) return cached;

  const basics = await getCompanyBasics(ticker);
  if (!basics) return null;

  // Search by company title (more reliable than raw ticker for 13F text)
  const queryName = basics.title.replace(/\s+(INC|CORP|CORPORATION|COMPANY|CO|LTD|PLC|LLC)\.?$/i, "");
  const refs = await searchThirteenFFilings(queryName, 60);

  if (!refs.length) {
    // Nothing found; return empty-but-valid summary so callers don't crash
    const empty: InstitutionalSummary = {
      ticker: ticker.toUpperCase(),
      cik: basics.cik,
      companyName: basics.title,
      sharesOutstanding: basics.sharesOutstanding,
      sharesAsOf: basics.sharesAsOf,
      institutionPct: 0,
      institutionCount: 0,
      topHolders: [],
      asOf: getEndDate(),
      source: "sec-edgar-13f",
    };
    setCached(cacheKey, empty, TTL_HOLDINGS);
    return empty;
  }

  // Parse information tables in parallel (bounded concurrency 6)
  const limit = 6;
  const perFilerRows: Array<{ ref: FilingRef; rows: HoldingRow[] }> = [];
  for (let i = 0; i < refs.length; i += limit) {
    const slice = refs.slice(i, i + limit);
    const results = await Promise.all(
      slice.map(async r => ({ ref: r, rows: await getInformationTable(r).catch(() => []) }))
    );
    perFilerRows.push(...results);
  }

  // Auto-detect the dominant CUSIP that matches our issuer name
  const cusipCounts = new Map<string, number>();
  const nameUpper = basics.title.toUpperCase();
  for (const { rows } of perFilerRows) {
    for (const row of rows) {
      if (!row.cusip) continue;
      const n = (row.nameOfIssuer || "").toUpperCase();
      // Heuristic: issuer name should share a word with company title
      const firstWord = nameUpper.split(/\s+/)[0];
      if (!n.includes(firstWord)) continue;
      cusipCounts.set(row.cusip, (cusipCounts.get(row.cusip) ?? 0) + 1);
    }
  }
  const targetCusip = Array.from(cusipCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  // Pick the largest holding row matching targetCusip per filer (latest filing)
  const byFiler = new Map<string, TopHolder>();
  let latest = "";
  const sharesOut = basics.sharesOutstanding || 0;

  for (const { ref, rows } of perFilerRows) {
    if (!targetCusip) continue;
    const match = rows.find(r => r.cusip.replace(/\s+/g, "").toUpperCase() === targetCusip);
    if (!match) continue;
    const shares = Number(match.sshPrnamt) || 0;
    if (shares <= 0) continue;
    const value = Number(match.value) || 0;
    if (ref.filedAt > latest) latest = ref.filedAt;

    const existing = byFiler.get(ref.cik);
    if (!existing || ref.filedAt > existing.filedAt) {
      byFiler.set(ref.cik, {
        name: ref.filerName,
        cik: ref.cik,
        accession: ref.accession,
        filedAt: ref.filedAt,
        shares,
        value,
        pctHeld: sharesOut > 0 ? shares / sharesOut : 0,
        reportDate: ref.filedAt,
      });
    }
  }

  const allHolders = Array.from(byFiler.values()).sort((a, b) => b.value - a.value);
  const topHolders = allHolders.slice(0, topN);
  const totalShares = allHolders.reduce((acc, h) => acc + h.shares, 0);
  const institutionPct = sharesOut > 0 ? Math.min(100, (totalShares / sharesOut) * 100) : 0;

  const summary: InstitutionalSummary = {
    ticker: ticker.toUpperCase(),
    cik: basics.cik,
    companyName: basics.title,
    sharesOutstanding: basics.sharesOutstanding,
    sharesAsOf: basics.sharesAsOf,
    institutionPct,
    institutionCount: allHolders.length,
    topHolders,
    asOf: latest || getEndDate(),
    source: "sec-edgar-13f",
  };
  setCached(cacheKey, summary, TTL_HOLDINGS);
  return summary;
}
