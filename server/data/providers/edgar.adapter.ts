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
import {
  readInstitutionalFresh,
  readInstitutionalStale,
  writeInstitutional,
} from "../../institutional-cache";

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

/** Drop every in-process cache entry for a ticker. Used by manual refresh
 *  endpoints so the next read goes all the way back to the network. */
export function clearEdgarTickerCache(ticker: string): void {
  const T = ticker.toUpperCase();
  for (const key of Array.from(cache.keys())) {
    if (key.includes(T)) cache.delete(key);
  }
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
  const key = `basics:v2:${ticker.toUpperCase()}`; // v2: added FMP mcap/price fallback
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

  // CUSIP from FMP profile (already on premium, no extra cost).
  // Also use FMP as FALLBACK for sharesOutstanding when XBRL didn't return one
  // (some issuers don't file CommonStockSharesOutstanding via us-gaap/dei consistently).
  let cusip: string | null = null;
  try {
    const profile: any = await fmpGet(`/profile`, { symbol: ticker });
    const row = Array.isArray(profile) ? profile[0] : profile;
    cusip = (row?.cusip ?? null) || null;
    if ((!sharesOutstanding || sharesOutstanding <= 0) && row?.marketCap && row?.price) {
      const derived = Number(row.marketCap) / Number(row.price);
      if (derived > 0 && isFinite(derived)) {
        sharesOutstanding = Math.round(derived);
        sharesAsOf = sharesAsOf || "FMP profile (mcap/price)";
      }
    }
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
 * List 13F-HR filings in an explicit date window.
 * Paginates efts.sec.gov at 100/page.
 */
export async function listThirteenFFilingsInWindow(
  startStr: string,
  endStr: string,
  maxResults = 3000
): Promise<FilingRef[]> {
  const cacheKey = `13fwin:${startStr}:${endStr}:${maxResults}`;
  const cached = getCached<FilingRef[]>(cacheKey);
  if (cached) return cached;

  const pageSize = 100;
  const refs: FilingRef[] = [];
  const seenAccession = new Set<string>();
  let pagesAttempted = 0;
  let pagesSkipped = 0;
  let consecutivePageFailures = 0;

  // EFTS pagination is flaky — individual pages can fail (Akamai throttle,
  // transient 5xx, connection reset) without anything being globally wrong.
  // Previously a single failed page broke the whole loop, leaving us with a
  // partial filer list (e.g. only the latest filers from page 0-1, missing
  // every megabank that filed mid-window). Now: retry the failing page
  // inline, then if still failing log + skip + continue. Bail only if many
  // consecutive pages fail (whole endpoint is down).
  const MAX_CONSECUTIVE_FAILURES = 5;

  for (let from = 0; from < maxResults; from += pageSize) {
    pagesAttempted++;
    const url =
      `https://efts.sec.gov/LATEST/search-index?q=&forms=13F-HR` +
      `&dateRange=custom&startdt=${startStr}&enddt=${endStr}` +
      `&from=${from}`;
    let data: EftsResponse | null = null;
    let lastErr: any = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        data = await edgarFetchJson<EftsResponse>(url);
        break;
      } catch (err: any) {
        lastErr = err;
        if (attempt < 2) await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
      }
    }
    if (!data) {
      pagesSkipped++;
      consecutivePageFailures++;
      console.warn(
        `[edgar] EFTS page from=${from} failed after retries: ${String(lastErr?.message || lastErr).substring(0, 120)} ` +
        `(skipped, ${consecutivePageFailures} consecutive)`
      );
      if (consecutivePageFailures >= MAX_CONSECUTIVE_FAILURES) {
        console.error(`[edgar] EFTS: ${MAX_CONSECUTIVE_FAILURES} consecutive page failures, aborting pagination`);
        break;
      }
      continue;
    }
    consecutivePageFailures = 0;
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
    if (hits.length < pageSize) break;
  }
  if (pagesSkipped > 0) {
    console.warn(`[edgar] EFTS pagination complete: ${pagesAttempted} attempted, ${pagesSkipped} skipped, ${refs.length} refs collected`);
  }

  const byCik = new Map<string, FilingRef>();
  for (const r of refs) {
    const existing = byCik.get(r.cik);
    if (!existing || r.filedAt > existing.filedAt) byCik.set(r.cik, r);
  }
  const latestPerFiler = Array.from(byCik.values());
  setCached(cacheKey, latestPerFiler, TTL_FILING_LIST);
  return latestPerFiler;
}

/**
 * Get the most-recently-filed 13F-HR per filer. Strategy: sample the current
 * quarter's filing deadline window (where >90% of 13Fs are filed) plus the
 * preceding quarter's window as a fallback for filers who missed the current
 * deadline.
 *
 * The 13F deadline is 45 days after the end of the calendar quarter:
 *   Q1 ends Mar 31 -> due May 15
 *   Q2 ends Jun 30 -> due Aug 14
 *   Q3 ends Sep 30 -> due Nov 14
 *   Q4 ends Dec 31 -> due Feb 14
 */
export async function listRecentThirteenFFilings(
  days = 100,
  maxResults = 2000
): Promise<FilingRef[]> {
  const now = new Date();
  // Sample a wide window that captures the most recent deadline cluster
  const end = new Date(now);
  const start = new Date(now);
  start.setDate(start.getDate() - days);
  const startStr = start.toISOString().slice(0, 10);
  const endStr = end.toISOString().slice(0, 10);

  const refs = await listThirteenFFilingsInWindow(startStr, endStr, maxResults);

  // Sort by filedAt desc (newest first). Cap to maxResults (already applied in fetch).
  refs.sort((a, b) => b.filedAt.localeCompare(a.filedAt));
  return refs;
}

/**
 * Fetch and parse primary_doc.xml to extract the filer's total portfolio value.
 * Used to rank filers by AUM. Returns 0 on any failure (filer deranked).
 */
export async function getFilerAum(ref: FilingRef): Promise<number> {
  const url =
    `https://www.sec.gov/Archives/edgar/data/${Number(ref.cik)}/${ref.accessionNoDashes}/primary_doc.xml`;
  try {
    const xml = await edgarFetch(url, { accept: "text/xml" });
    const m = xml.match(/<(?:[\w-]+:)?tableValueTotal>([^<]+)<\/(?:[\w-]+:)?tableValueTotal>/i);
    if (!m) return 0;
    return Number(m[1].replace(/,/g, "")) || 0;
  } catch {
    return 0;
  }
}

/**
 * Curated list of CIKs for major 13F filers. EFTS pagination is unreliable
 * (one bad page can drop every filer beyond it), so we hard-anchor the most
 * important AUM filers here — verified live against data.sec.gov/submissions
 * 2026-05-01 — and merge them with whatever EFTS returns.
 *
 * If EFTS fails entirely, we still cover ~60-70% of institutional ownership
 * for any megacap because these names are the long tail of "big money."
 *
 * To extend: hit `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company={NAME}&type=13F-HR&output=atom`
 * and confirm the CIK has recent 13F-HR filings via the submissions endpoint.
 */
export const KNOWN_MAJOR_FILER_CIKS: ReadonlyArray<string> = [
  "0000102909", // Vanguard Group
  "0001364742", // BlackRock Finance
  "0000093751", // State Street Corp
  "0000315066", // FMR LLC (Fidelity)
  "0001214717", // Geode Capital Management
  "0000019617", // JPMorgan Chase & Co
  "0000080255", // T. Rowe Price Associates
  "0000895421", // Morgan Stanley
  "0000902219", // Wellington Management Group
  "0001067983", // Berkshire Hathaway
  "0000886982", // Goldman Sachs Group
  "0000914208", // Invesco Ltd
  "0000316709", // Charles Schwab Corp
  "0001374170", // Norges Bank (Norway sovereign wealth)
  "0000354204", // Dimensional Fund Advisors
  "0001422849", // Capital World Investors
  "0000073124", // Northern Trust Corp
  "0001656456", // Appaloosa LP (Tepper)
  "0001029160", // Soros Fund Management
];

interface SecSubmissions {
  name?: string;
  filings?: { recent?: { form?: string[]; accessionNumber?: string[]; filingDate?: string[]; }; };
}

/**
 * For a single CIK, fetch its most recent 13F-HR (or 13F-HR/A) filing from
 * the SEC submissions endpoint and convert into a FilingRef.
 * Returns null if no recent 13F-HR exists.
 */
async function fetchLatestThirteenFForFiler(cik: string): Promise<FilingRef | null> {
  const padded = cik.padStart(10, "0");
  const url = `https://data.sec.gov/submissions/CIK${padded}.json`;
  try {
    const data = await edgarFetchJson<SecSubmissions>(url);
    const recent = data?.filings?.recent;
    if (!recent?.form?.length) return null;
    const forms = recent.form ?? [];
    const accs = recent.accessionNumber ?? [];
    const dates = recent.filingDate ?? [];
    for (let i = 0; i < forms.length; i++) {
      const f = forms[i];
      if (f === "13F-HR" || f === "13F-HR/A") {
        const acc = accs[i];
        if (!acc) continue;
        return {
          accession: acc,
          accessionNoDashes: acc.replace(/-/g, ""),
          cik: padded,
          filerName: data?.name ?? "Unknown",
          filedAt: dates[i] ?? "",
          form: f,
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Fetch the most recent 13F-HR filing for every CIK in KNOWN_MAJOR_FILER_CIKS.
 * Cached 24h. Resilient: any individual CIK that fails just gets skipped.
 */
export async function getKnownMajorFilers(): Promise<FilingRef[]> {
  const cacheKey = "known_major_filers";
  const cached = getCached<FilingRef[]>(cacheKey);
  if (cached) return cached;

  const results: FilingRef[] = [];
  // Conservative concurrency since these are independent CIK lookups against
  // data.sec.gov which shares throttle with the rest of EDGAR.
  const CONCURRENCY = 5;
  for (let i = 0; i < KNOWN_MAJOR_FILER_CIKS.length; i += CONCURRENCY) {
    const slice = KNOWN_MAJOR_FILER_CIKS.slice(i, i + CONCURRENCY);
    const refs = await Promise.all(slice.map(c => fetchLatestThirteenFForFiler(c)));
    for (const r of refs) if (r) results.push(r);
  }
  console.log(`[edgar] known-major-filers fetched: ${results.length}/${KNOWN_MAJOR_FILER_CIKS.length}`);
  setCached(cacheKey, results, TTL_FILING_LIST);
  return results;
}

/**
 * Rank recent 13F filers by AUM (tableValueTotal from primary_doc.xml).
 * Cached 24h at the module level — ticker-independent, so one cold fetch
 * per day serves every institutional lookup.
 *
 * Resilience strategy:
 *   1. Always seed with KNOWN_MAJOR_FILER_CIKS so megacap holders are
 *      covered even when EFTS pagination fails or returns only the latest
 *      tiny family-office filers.
 *   2. Augment with EFTS-discovered filers in the recent deadline window.
 *   3. Dedupe by CIK (keep the latest filing per filer).
 *   4. Rank everything by AUM, return top N.
 */
export async function rankedTopFilers(topN = 500): Promise<FilingRef[]> {
  const cacheKey = `ranked_top_filers:${topN}`;
  const cached = getCached<FilingRef[]>(cacheKey);
  if (cached) return cached;

  const { startStr, endStr } = recentDeadlineWindow(new Date());
  // Run both sources in parallel; fail-soft on either.
  const [eftsRefs, knownRefs] = await Promise.all([
    listThirteenFFilingsInWindow(startStr, endStr, 8000).catch((e: any) => {
      console.warn(`[edgar] EFTS filing-list call failed: ${String(e?.message || e).substring(0, 120)}`);
      return [] as FilingRef[];
    }),
    getKnownMajorFilers().catch((e: any) => {
      console.warn(`[edgar] known-major-filers fetch failed: ${String(e?.message || e).substring(0, 120)}`);
      return [] as FilingRef[];
    }),
  ]);

  // Dedupe by CIK; if both sources have the same filer, keep the latest filing
  const byCik = new Map<string, FilingRef>();
  for (const r of [...eftsRefs, ...knownRefs]) {
    const existing = byCik.get(r.cik);
    if (!existing || r.filedAt > existing.filedAt) byCik.set(r.cik, r);
  }
  const refs = Array.from(byCik.values());
  console.log(`[edgar] ranking ${refs.length} filers by AUM (EFTS=${eftsRefs.length}, known=${knownRefs.length}, unique=${refs.length})...`);

  // Fetch tableValueTotal in parallel batches of 10
  const CONCURRENCY = 10;
  const withAum: Array<{ ref: FilingRef; aum: number }> = [];
  const startMs = Date.now();
  for (let i = 0; i < refs.length; i += CONCURRENCY) {
    const slice = refs.slice(i, i + CONCURRENCY);
    const aums = await Promise.all(slice.map(r => getFilerAum(r)));
    for (let j = 0; j < slice.length; j++) {
      withAum.push({ ref: slice[j], aum: aums[j] });
    }
    if ((i + CONCURRENCY) % 500 === 0 || i + CONCURRENCY >= refs.length) {
      const elapsed = ((Date.now() - startMs) / 1000).toFixed(0);
      console.log(`[edgar] ranked ${Math.min(i + CONCURRENCY, refs.length)}/${refs.length} filers [${elapsed}s]`);
    }
  }

  withAum.sort((a, b) => b.aum - a.aum);
  const topFilers = withAum.slice(0, topN).map(x => x.ref);
  setCached(cacheKey, topFilers, TTL_FILING_LIST);
  return topFilers;
}

/**
 * Compute the filing-deadline window around the given date.
 * Returns a 21-day window ending on (or just before) the most recent
 * 13F deadline, which is where >80% of large-filer 13Fs are filed.
 */
export function recentDeadlineWindow(now: Date): { startStr: string; endStr: string } {
  // Deadlines for each quarter (month is 0-indexed)
  const year = now.getUTCFullYear();
  const candidates = [
    new Date(Date.UTC(year - 1, 10, 14)), // prior year Q3
    new Date(Date.UTC(year, 1, 14)),      // Q4 of prior fiscal (Feb 14)
    new Date(Date.UTC(year, 4, 15)),      // Q1 (May 15)
    new Date(Date.UTC(year, 7, 14)),      // Q2 (Aug 14)
    new Date(Date.UTC(year, 10, 14)),     // Q3 (Nov 14)
  ];
  // Most recent deadline at or before 'now'
  const past = candidates.filter(d => d.getTime() <= now.getTime());
  const deadline = past[past.length - 1] ?? candidates[0];
  const end = new Date(deadline);
  end.setUTCDate(end.getUTCDate() + 7); // grace period for late filers
  // Don't go past today
  if (end.getTime() > now.getTime()) end.setTime(now.getTime());
  const start = new Date(deadline);
  start.setUTCDate(start.getUTCDate() - 21);
  return {
    startStr: start.toISOString().slice(0, 10),
    endStr: end.toISOString().slice(0, 10),
  };
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
  const cacheKey = `inst:v2:${ticker.toUpperCase()}`; // v2: ownership pct fallback
  const cached = getCached<InstitutionalSummary>(cacheKey);
  if (cached) return cached;

  // Phase 3.8: disk cache. Survives restarts so deploys don't trigger a
  // 25-min cold path for the first user. Fresh (<3d) wins over live.
  const diskFreshRaw = readInstitutionalFresh(ticker);
  const diskFresh = isSummaryCorrupt(diskFreshRaw) ? null : diskFreshRaw;
  if (diskFresh) {
    setCached(cacheKey, diskFresh, TTL_HOLDINGS);
    return diskFresh as InstitutionalSummary;
  }

  const basics = await getCompanyBasics(ticker);
  if (!basics) return null;

  const targetCusip = basics.cusip?.replace(/\s+/g, "").toUpperCase();
  const sharesOut = basics.sharesOutstanding || 0;

  // If no CUSIP, we cannot match filings. Previously we cached an empty
  // result here, which meant a single transient FMP /profile failure (the
  // CUSIP source) poisoned the cache for 12h in-process and 3 days on disk
  // — every subsequent read served the empty result. Now we return null
  // WITHOUT caching, so the next read after FMP recovers fetches fresh.
  // Real CUSIP-less securities (rare) just retry harmlessly each call.
  if (!targetCusip) {
    console.warn(`[edgar] ${ticker}: no CUSIP available (FMP /profile empty?). Skipping cache write so next read retries.`);
    return null;
  }

  // Use the globally-cached top-AUM filer list. First cold call (once per day)
  // takes ~10-15 minutes to rank ~7000 filers; after that, every ticker lookup
  // reuses the cached top-500 list and only pays for info table fetches.
  const filerRefs = await rankedTopFilers(500);
  const startMs = Date.now();
  console.log(`[edgar] ${ticker} aggregating ${filerRefs.length} filers against CUSIP ${targetCusip}`);

  // Parse information tables with bounded concurrency (8 parallel)
  const byFiler = new Map<string, TopHolder>();
  let latest = "";
  const CONCURRENCY = 8;
  let processed = 0;
  let matched = 0;

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
    processed += slice.length;
    if (processed % 100 === 0 || processed >= filerRefs.length) {
      const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
      console.log(`[edgar] ${ticker} ${processed}/${filerRefs.length} filers processed (${matched} hold CUSIP) [${elapsed}s]`);
    }
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
      matched++;
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

  // Refuse to cache suspiciously-empty results.
  //
  // We just verified upstream that EFTS pagination can fail partway through
  // and leave us with a tiny filer list (e.g. 100 of the latest filers, all
  // small family offices). Aggregating against that list produces zero
  // matches for megacap tickers like AAPL — but it's not "no holders," it's
  // "we didn't process the right filers." Persisting that result poisons
  // the cache for 12 hours in-process and 3 days on disk.
  //
  // Heuristic: if we processed fewer than 200 filers AND found zero holders,
  // do NOT cache. Return null so the caller falls through to the snapshot's
  // Yahoo fallback, and the next read retries the warm fresh.
  //
  // 200 is well below any healthy 13F-HR window count (real windows return
  // ~2000-5000+ filers). Real "no coverage" tickers exist (micro-caps,
  // ADRs, recent IPOs) but they would still process the full filer list,
  // so they hit the `topHolders.length === 0` case with a HIGH filerRefs
  // count, which is genuinely a confirmed-empty result and we cache that.
  const suspiciouslyIncomplete = filerRefs.length < 200 && topHolders.length === 0;
  if (suspiciouslyIncomplete) {
    console.warn(
      `[edgar] ${ticker} produced empty result with only ${filerRefs.length} filers processed — ` +
      `not caching (likely EFTS pagination failure). Next read will retry.`
    );
    return null;
  }

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
  writeInstitutional(ticker, summary); // Phase 3.8: persist so restarts warm-start
  return summary;
}

/**
 * Phase 3.8: Stale-cache fallback wrapper. Use for best-effort non-blocking
 * callers (e.g. request path under time pressure). Returns disk-cached data
 * even if past TTL, rather than paying the 25-min cold path.
 *
 * Phase 4 fix: NEVER pay the cold path from a user-facing request. On cold
 * miss we kick off a background fetch and return null — the UI shows a
 * "warming" state instead of hanging for 25 minutes. Callers that genuinely
 * need a synchronous fetch should call getInstitutionalSummary() directly.
 */
const pendingWarms = new Set<string>();

// Treat a cached summary as corrupt in three patterns:
//   1. Holders > 0 but 0% ownership — old sharesOutstanding=null bug.
//   2. Zero holders for a company with sharesOutstanding > 0 — empty-cache
//      poisoning (CUSIP lookup or 13F search transiently failed and the
//      empty result got persisted as if it were valid). AAPL/MSFT/PLTR
//      have thousands of institutional holders; an empty list for them
//      is impossible, not "no coverage." Forcing a refresh here is the
//      ONLY way poisoned caches recover without manual disk-cache deletion.
//   3. Holders > 0 but every holder has zero shares — partial parse failure.
function isSummaryCorrupt(s: any): boolean {
  if (!s) return false;
  const holders = s?.topHolders?.length || 0;
  const pct = Number(s?.institutionPct || 0);
  const sharesOut = Number(s?.sharesOutstanding || 0);

  if (holders > 0 && pct === 0) return true;
  if (holders === 0 && sharesOut > 0) return true;
  if (holders > 0) {
    const totalShares = (s?.topHolders ?? []).reduce(
      (a: number, h: any) => a + (Number(h?.shares) || 0), 0,
    );
    if (totalShares === 0) return true;
  }
  return false;
}

export async function getInstitutionalSummaryStaleOk(
  ticker: string,
  topN = 25
): Promise<InstitutionalSummary | null> {
  const fresh = readInstitutionalFresh(ticker);
  if (fresh && !isSummaryCorrupt(fresh)) return fresh;
  if (fresh && isSummaryCorrupt(fresh)) {
    // Kick a warm to overwrite, but don't block the user on it.
    if (!pendingWarms.has(ticker)) {
      pendingWarms.add(ticker);
      getInstitutionalSummary(ticker, topN)
        .catch((err: any) => {
          // Surface warm-path failures so we can see when EDGAR is blocked,
          // FMP CUSIP is failing, or the parser hits an unrecoverable issue.
          // Previously this was silently swallowed, leaving the cache poisoned
          // forever with no diagnostic.
          console.error(
            `[edgar] background warm failed for ${ticker}: ${String(err?.message || err).substring(0, 200)}`,
            err?.isEdgarBlock ? "(EDGAR circuit breaker active)" : ""
          );
        })
        .finally(() => pendingWarms.delete(ticker));
    }
    return null;
  }
  const stale = readInstitutionalStale(ticker);
  if (stale) {
    // Kick off a background refresh but return stale immediately.
    if (!pendingWarms.has(ticker)) {
      pendingWarms.add(ticker);
      getInstitutionalSummary(ticker, topN)
        .catch((err: any) => {
          console.error(
            `[edgar] background warm failed for ${ticker}: ${String(err?.message || err).substring(0, 200)}`,
            err?.isEdgarBlock ? "(EDGAR circuit breaker active)" : ""
          );
        })
        .finally(() => pendingWarms.delete(ticker));
    }
    return stale;
  }
  // Cold miss — kick off background warm, return null immediately.
  if (!pendingWarms.has(ticker)) {
    pendingWarms.add(ticker);
    getInstitutionalSummary(ticker, topN)
      .catch((err: any) => {
        console.error(
          `[edgar] background warm failed for ${ticker}: ${String(err?.message || err).substring(0, 200)}`,
          err?.isEdgarBlock ? "(EDGAR circuit breaker active)" : ""
        );
      })
      .finally(() => pendingWarms.delete(ticker));
  }
  return null;
}
