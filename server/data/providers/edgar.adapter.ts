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
import { fmpGet } from "./fmp.client";

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

const TTL_TICKER_MAP = 24 * 60 * 60 * 1000;    // 24h
const TTL_FILING_LIST = 24 * 60 * 60 * 1000;   // 24h (13Fs only update quarterly)
const TTL_HOLDINGS = 12 * 60 * 60 * 1000;      // 12h per ticker

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
  cusip: string | null;
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

  // CUSIP from FMP profile (already on premium, no extra cost)
  let cusip: string | null = null;
  try {
    const profile: any = await fmpGet(`/profile`, { symbol: ticker });
    const row = Array.isArray(profile) ? profile[0] : profile;
    cusip = (row?.cusip ?? null) || null;
  } catch {
    // non-fatal
  }

  const basics: CompanyBasics = {
    cik: lookup.cik,
    title: lookup.title,
    sharesOutstanding,
    sharesAsOf,
    cusip,
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

/**
 * List ALL recent 13F-HR filings filed in the last N days.
 *
 * Paginates EDGAR full-text search (100 per page, up to 10,000 results).
 * This replaces the name-based search: instead of hoping the filer mentions
 * the target company in their primary document, we enumerate every 13F filer
 * and then parse their Information Tables for the target CUSIP.
 */
export async function listRecentThirteenFFilings(
  days = 100,
  maxResults = 2000
): Promise<FilingRef[]> {
  const cacheKey = `all13f:${days}:${maxResults}`;
  const cached = getCached<FilingRef[]>(cacheKey);
  if (cached) return cached;

  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);
  const startStr = start.toISOString().slice(0, 10);
  const endStr = end.toISOString().slice(0, 10);

  const pageSize = 100;
  const refs: FilingRef[] = [];
  const seenAccession = new Set<string>();

  for (let from = 0; from < maxResults; from += pageSize) {
    const url =
      `https://efts.sec.gov/LATEST/search-index?q=&forms=13F-HR` +
      `&dateRange=custom&startdt=${startStr}&enddt=${endStr}` +
      `&from=${from}`;
    let data: EftsResponse;
    try {
      data = await edgarFetchJson<EftsResponse>(url);
    } catch {
      break;
    }
    const hits = data?.hits?.hits ?? [];
    if (!hits.length) break;
    for (const h of hits) {
      const s = h._source;
      if (!s?.adsh || seenAccession.has(s.adsh)) continue;
      seenAccession.add(s.adsh);
      refs.push({
        accession: s.adsh,
        accessionNoDashes: s.adsh.replace(/-/g, ""),
        cik: (s.ciks?.[0] ?? "").padStart(10, "0"),
        filerName: s.display_names?.[0] ?? "Unknown",
        filedAt: s.file_date,
        form: s.form,
      });
    }
    // EFTS caps at 10k; break early if we got less than a full page
    if (hits.length < pageSize) break;
  }

  // Deduplicate to latest filing per filer CIK (only need one 13F per filer)
  const byCik = new Map<string, FilingRef>();
  for (const r of refs) {
    const existing = byCik.get(r.cik);
    if (!existing || r.filedAt > existing.filedAt) byCik.set(r.cik, r);
  }
  const latestPerFiler = Array.from(byCik.values());
  setCached(cacheKey, latestPerFiler, TTL_FILING_LIST);
  return latestPerFiler;
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

  // Locate the Information Table XML. Filers use inconsistent filenames
  // (infotable.xml, informationtable.xml, EPF13F2009Q2.xml, Form13FInfoTable.xml, etc.)
  // Strategy: pick all .xml files that are NOT primary_doc.xml, try each.
  let candidates: string[] = [];
  try {
    const idx: any = await edgarFetchJson(`${base}/index.json`);
    const items: any[] = idx?.directory?.item ?? [];
    candidates = items
      .map((i: any) => String(i.name || ""))
      .filter(n => n.toLowerCase().endsWith(".xml") && n.toLowerCase() !== "primary_doc.xml");
  } catch {
    return [];
  }
  if (!candidates.length) return [];

  // Try candidates in order; return on first successful parse
  for (const name of candidates) {
    try {
      const xml = await edgarFetch(`${base}/${name}`, { accept: "text/xml" });
      // Quick sanity check: looks like an information table?
      if (!/informationTable|infoTable/i.test(xml)) continue;
      const rows = parseInformationTableXml(xml, cusipFilter);
      if (rows.length > 0 || !cusipFilter) return rows;
      // If we filtered by CUSIP and got 0, this filing genuinely doesn't hold it
      return rows;
    } catch {
      // try next candidate
    }
  }
  return [];
}

/**
 * Lightweight 13F Information Table XML parser. Avoids pulling a full XML
 * dependency: uses regex across the `<infoTable>...</infoTable>` blocks.
 */
export function parseInformationTableXml(xml: string, cusipFilter?: string): HoldingRow[] {
  const rows: HoldingRow[] = [];
  // Match any namespace prefix (ns1:, n1:, f:, etc.) or no prefix
  const blockRe = /<(?:[\w-]+:)?infoTable[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?infoTable>/gi;
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
  const re = new RegExp(`<(?:[\\w-]+:)?${tag}>([^<]*)</(?:[\\w-]+:)?${tag}>`, "i");
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
 * 3.4a (coverage-fix) implementation:
 *   1. Resolve CUSIP from FMP profile (authoritative)
 *   2. Enumerate latest 13F-HR per filer from last ~100 days (cached 6h)
 *   3. Parse each filer's Information Table, find row matching target CUSIP
 *   4. Aggregate top holders by position value; compute institutionPct
 *
 * First run is slow (~1-2 min for 1000+ filers), subsequent lookups hit cache.
 * Concurrency limited to 8 parallel requests to stay under SEC 10/sec cap.
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

  const targetCusip = basics.cusip?.replace(/\s+/g, "").toUpperCase();
  const sharesOut = basics.sharesOutstanding || 0;

  // If no CUSIP, we cannot match filings. Return empty but valid shape.
  if (!targetCusip) {
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

  // Enumerate 13F filers from last ~100 days (latest filing per CIK).
  // Capped at 800 most recent filers — covers the largest AUM filers since
  // big institutions file at or near the deadline. Cached 24h (13Fs only
  // update quarterly anyway).
  const filerRefs = await listRecentThirteenFFilings(100, 800);
  console.log(`[edgar] ${ticker} aggregating ${filerRefs.length} filers against CUSIP ${targetCusip}`);

  // Parse information tables with bounded concurrency (8 parallel)
  const byFiler = new Map<string, TopHolder>();
  let latest = "";
  const CONCURRENCY = 8;

  for (let i = 0; i < filerRefs.length; i += CONCURRENCY) {
    const slice = filerRefs.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      slice.map(async ref => {
        try {
          const rows = await getInformationTable(ref, targetCusip);
          return { ref, rows };
        } catch {
          return { ref, rows: [] as HoldingRow[] };
        }
      })
    );
    for (const { ref, rows } of results) {
      if (!rows.length) continue;
      // Sum all rows for this CUSIP in this filing (a filer may have multiple
      // position rows — e.g. different share classes or sub-accounts).
      let shares = 0;
      let value = 0;
      for (const r of rows) {
        shares += Number(r.sshPrnamt) || 0;
        value += Number(r.value) || 0;
      }
      if (shares <= 0) continue;
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
