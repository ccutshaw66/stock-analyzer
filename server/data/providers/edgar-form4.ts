/**
 * SEC EDGAR Form 4 client + parser.
 *
 * Pulls recent Form 4 (insider transaction) filings from EDGAR's full-text
 * Atom feed and parses each filing's primary XML to extract:
 *   - Issuer (ticker, CIK)
 *   - Reporting owner (name, CIK, relationship to issuer)
 *   - Non-derivative transactions (open-market buys/sells with shares + price)
 *   - Footnote text (10b5-1 plan detection lives here)
 *
 * 10b5-1 detection: scans all footnotes referenced by a transaction for any
 * mention of "10b5-1" / "Rule 10b5-1" / "trading plan." If any footnote on a
 * transaction matches, the transaction is flagged. Buys are almost never
 * 10b5-1 plans (planned buys are rare); sells often are.
 *
 * Uses the existing hardened EDGAR HTTP client (`edgarFetch`) which enforces
 * 4 req/sec sustained + circuit-breaker on Akamai 403s. Caller responsibility
 * is to call in a cron, not a request path.
 */
import { XMLParser } from "fast-xml-parser";
import { edgarFetch } from "./edgar.client";

// ─── Atom feed: list recent filings ──────────────────────────────────────

export interface Form4FeedEntry {
  /** Display title, e.g. "4 - Cook Timothy D (0001214156) (Reporting)" */
  title: string;
  /** Atom updated timestamp (ISO). */
  updated: string;
  /** Filing index URL (.htm) — used to derive the directory containing the XML. */
  filingIndexUrl: string;
  /** SEC accession number (dash-separated form, e.g. "0000320193-25-000123"). */
  accessionNo: string;
}

const ATOM_FEED_URL =
  "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=4&output=atom&count=100";

function extractAccessionFromUrl(url: string): string | null {
  // .../Archives/edgar/data/{cik}/{accession-no-dashes}/{accession-with-dashes}-index.htm
  const m = url.match(/\/(\d{10}-\d{2}-\d{6})-index/);
  return m ? m[1] : null;
}

/** List the N most recent Form 4 filings from the EDGAR Atom feed. */
export async function listRecentForm4Filings(): Promise<Form4FeedEntry[]> {
  const xml = await edgarFetch(ATOM_FEED_URL, { accept: "application/atom+xml" });
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    isArray: (name) => name === "entry",
  });
  const parsed = parser.parse(xml);
  const entries: any[] = parsed?.feed?.entry ?? [];
  const out: Form4FeedEntry[] = [];
  for (const e of entries) {
    const title = String(e?.title ?? "");
    const updated = String(e?.updated ?? "");
    let linkHref: string | null = null;
    const link = e?.link;
    if (Array.isArray(link)) {
      const alt = link.find((l: any) => l?.["@_rel"] === "alternate");
      linkHref = alt?.["@_href"] ?? link[0]?.["@_href"] ?? null;
    } else if (link?.["@_href"]) {
      linkHref = link["@_href"];
    }
    if (!linkHref) continue;
    const accessionNo = extractAccessionFromUrl(linkHref);
    if (!accessionNo) continue;
    out.push({ title, updated, filingIndexUrl: linkHref, accessionNo });
  }
  return out;
}

// ─── Filing directory: find the Form 4 XML inside the filing ─────────────

/**
 * Given a filing index URL, derive the directory's `index.json` and return
 * the URL to the primary Form 4 XML file. SEC name conventions vary —
 * "primary_doc.xml" is most common, "form4.xml" / "wf-form4_*.xml" exist
 * historically. We pick whichever .xml ends up being the Form 4.
 */
export async function locateForm4XmlUrl(filingIndexUrl: string): Promise<string | null> {
  // Strip "-index.htm" suffix to get the directory URL
  const dirUrl = filingIndexUrl.replace(/-index\.htm$/, "").replace(/\/[^/]+$/, "");
  const indexJsonUrl = `${dirUrl}/index.json`;
  const text = await edgarFetch(indexJsonUrl, { accept: "application/json" });
  let json: any;
  try { json = JSON.parse(text); } catch { return null; }
  const items: any[] = json?.directory?.item ?? [];
  const xmlCandidates = items
    .map(it => it?.name)
    .filter((name): name is string => typeof name === "string" && name.toLowerCase().endsWith(".xml"));
  if (xmlCandidates.length === 0) return null;
  // Prefer primary_doc.xml; then wf-form4_*.xml; then first .xml
  const primary = xmlCandidates.find(n => n === "primary_doc.xml")
    ?? xmlCandidates.find(n => n.toLowerCase().includes("form4"))
    ?? xmlCandidates[0];
  return `${dirUrl}/${primary}`;
}

// ─── Form 4 XML parser ───────────────────────────────────────────────────

export interface Form4Transaction {
  /** 0-based index within the filing's transaction list. */
  txIndex: number;
  /** YYYY-MM-DD. */
  transactionDate: string;
  /** SEC transaction code — P=Purchase, S=Sale, A=Award, F=InKind tax, M=Exercise, etc. */
  transactionCode: string;
  /** "buy" / "sell" / "other" — buy = P + acquired; sell = S + disposed. */
  direction: "buy" | "sell" | "other";
  /**
   * Share count in the *tradeable security's* terms. For US common stock
   * this is the SEC-reported count unchanged. For ADRs/ADSs (foreign
   * issuers), the SEC-reported ordinary-share count is normalized down by
   * the ADR ratio so this field represents marketable ADS units — matches
   * what shows up on broker statements and what aggregators (Finviz,
   * Stocktitan) display.
   */
  shares: number;
  pricePerShare: number | null;
  totalValue: number | null;
  /**
   * ADR-to-ordinary ratio detected in this transaction's footnotes.
   * 1 = US common stock (no normalization). >1 = foreign issuer; original
   * ordinary-share count was `shares × adrRatio`.
   */
  adrRatio: number;
  rule10b5_1: boolean;
  /** Concatenated footnote text referenced by this transaction. */
  footnotes: string;
}

export interface ParsedForm4 {
  filingAccessionNo: string;
  filingDate: string;                         // YYYY-MM-DD
  ticker: string;                             // UPPER
  issuerCik: string;
  reportingOwnerCik: string | null;
  reportingOwnerName: string;
  reportingOwnerRelation: string;             // pipe-joined
  transactions: Form4Transaction[];
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function strOrNull(v: any): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s;
}

function numOrNull(v: any): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** True if the text mentions a 10b5-1 plan (case-insensitive, hyphen-flexible). */
function looksLike10b51(text: string): boolean {
  const t = text.toLowerCase().replace(/[\s‐-―]+/g, " ");
  return (
    t.includes("10b5 1") ||
    t.includes("10b5-1") ||
    t.includes("rule 10b5") ||
    (t.includes("trading plan") && t.includes("10b5"))
  );
}

/**
 * Detect the ADR-to-ordinary-share ratio from Form 4 footnote text.
 *
 * Foreign issuers (Israeli, Chinese, etc.) report transactions in *ordinary
 * shares* but the actual tradeable security in the US is the ADS (American
 * Depositary Share). One ADS typically represents N ordinary shares — N is
 * disclosed in a footnote like "Each ADS represents 43,200 ordinary shares."
 *
 * Without applying this ratio, `shares × pricePerShare` inflates by a factor
 * of N — e.g. SVRE showed a fake $6B insider buy when the real money was
 * $167K. Returns 1 (no normalization) when no ratio is detected.
 */
export function detectAdrRatio(footnotesText: string): number {
  if (!footnotesText) return 1;
  const t = footnotesText.replace(/\s+/g, " ");
  // Patterns covered:
  //   "Each ADS represents 43,200 ordinary shares"
  //   "Each American Depositary Share represents 10 ordinary shares"
  //   "Each ADR represents 5 ordinary shares"
  //   "One ADS = 100 ordinary shares"
  const patterns: RegExp[] = [
    // "Each ADS represents N ordinary shares" / "Each ADR represents..."
    /each\s+(?:ads|adr)(?:\s*\([^)]*\))?\s+(?:represents?|equals?|=)\s+([\d,]+)\s+ordinary\s+shares?/i,
    // "Each American Depositary Share [(ADS)] represents N ordinary shares"
    /each\s+american\s+depositary\s+(?:share|receipt)s?(?:\s*\([^)]*\))?\s+(?:represents?|equals?|=)\s+([\d,]+)\s+ordinary\s+shares?/i,
    // "One ADS = N ordinary shares" / "One ADR represents N ordinary shares"
    /one\s+(?:ads|adr)\s+(?:=|represents?|equals?)\s+([\d,]+)\s+ordinary\s+shares?/i,
    // "1 ADS : N ordinary shares"
    /1\s+(?:ads|adr)\s*[=:]\s*([\d,]+)\s+ordinary\s+shares?/i,
  ];
  for (const re of patterns) {
    const m = re.exec(t);
    if (m) {
      const n = Number(m[1].replace(/,/g, ""));
      if (Number.isFinite(n) && n > 1) return n;
    }
  }
  return 1;
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
});

/**
 * Parse a Form 4 XML payload into a normalized record. Returns null if the
 * document is missing required fields (issuer or owner) or has no
 * non-derivative transactions worth recording.
 */
export function parseForm4Xml(xml: string, filingAccessionNo: string): ParsedForm4 | null {
  let parsed: any;
  try { parsed = xmlParser.parse(xml); } catch { return null; }
  const doc = parsed?.ownershipDocument;
  if (!doc) return null;

  const ticker = strOrNull(doc?.issuer?.issuerTradingSymbol)?.toUpperCase() ?? null;
  const issuerCik = strOrNull(doc?.issuer?.issuerCik);
  if (!ticker || !issuerCik) return null;

  const owners = asArray<any>(doc?.reportingOwner);
  if (owners.length === 0) return null;
  // For multi-owner Form 4s (rare), take the first owner — the rest are
  // usually trustees or co-signers. Stored owner name reflects the lead.
  const owner = owners[0];
  const reportingOwnerName = strOrNull(owner?.reportingOwnerId?.rptOwnerName) ?? "Unknown";
  const reportingOwnerCik = strOrNull(owner?.reportingOwnerId?.rptOwnerCik);
  const rel = owner?.reportingOwnerRelationship ?? {};
  const relationBits: string[] = [];
  if (strOrNull(rel.isDirector) === "1" || strOrNull(rel.isDirector)?.toLowerCase() === "true") relationBits.push("Director");
  if (strOrNull(rel.isOfficer) === "1" || strOrNull(rel.isOfficer)?.toLowerCase() === "true") {
    const title = strOrNull(rel.officerTitle);
    relationBits.push(title ? `Officer:${title}` : "Officer");
  }
  if (strOrNull(rel.isTenPercentOwner) === "1" || strOrNull(rel.isTenPercentOwner)?.toLowerCase() === "true") relationBits.push("10%Owner");
  if (strOrNull(rel.isOther) === "1" || strOrNull(rel.isOther)?.toLowerCase() === "true") {
    const text = strOrNull(rel.otherText);
    relationBits.push(text ? `Other:${text}` : "Other");
  }

  // Footnote map: id → text
  const footnoteMap = new Map<string, string>();
  const fnEntries = asArray<any>(doc?.footnotes?.footnote);
  for (const fn of fnEntries) {
    const id = strOrNull(fn?.["@_id"]);
    const text = strOrNull(fn?.["#text"]) ?? (typeof fn === "string" ? fn : strOrNull(fn));
    if (id && text) footnoteMap.set(id, text);
  }

  // Filing date: documentDocsType has no date, but periodOfReport is the
  // reporting date (we use this as filingDate since the Atom feed gives us
  // accession but not date).
  const filingDate = strOrNull(doc?.periodOfReport) ?? new Date().toISOString().slice(0, 10);

  const txs: Form4Transaction[] = [];
  const nonDerivative = asArray<any>(doc?.nonDerivativeTable?.nonDerivativeTransaction);
  for (let i = 0; i < nonDerivative.length; i++) {
    const t = nonDerivative[i];
    const transactionDate = strOrNull(t?.transactionDate?.value);
    const txCoding = t?.transactionCoding ?? {};
    const code = strOrNull(txCoding?.transactionCode) ?? "";
    const amounts = t?.transactionAmounts ?? {};
    const shares = numOrNull(amounts?.transactionShares?.value) ?? 0;
    const price = numOrNull(amounts?.transactionPricePerShare?.value);
    const acquiredDisposed = strOrNull(amounts?.transactionAcquiredDisposedCode?.value); // "A" or "D"

    let direction: Form4Transaction["direction"] = "other";
    if (code === "P" && acquiredDisposed === "A") direction = "buy";
    else if (code === "S" && acquiredDisposed === "D") direction = "sell";

    // Collect footnote IDs referenced anywhere on this transaction.
    const referencedIds = new Set<string>();
    const collectFnIds = (node: any) => {
      if (!node || typeof node !== "object") return;
      const fnAttr = node?.footnoteId ?? node?.["@_footnoteId"];
      if (Array.isArray(fnAttr)) {
        for (const f of fnAttr) {
          const id = strOrNull(f?.["@_id"] ?? f);
          if (id) referencedIds.add(id);
        }
      } else if (fnAttr) {
        const id = strOrNull(fnAttr?.["@_id"] ?? fnAttr);
        if (id) referencedIds.add(id);
      }
      for (const v of Object.values(node)) collectFnIds(v);
    };
    collectFnIds(t);

    const footnotesText = Array.from(referencedIds)
      .map(id => footnoteMap.get(id))
      .filter((s): s is string => !!s)
      .join(" | ");

    const rule10b5_1 = footnotesText ? looksLike10b51(footnotesText) : false;

    if (!transactionDate || (direction === "other" && shares <= 0)) continue;

    // Normalize ordinary-share counts to ADS units when the issuer is an
    // ADR. Without this, foreign issuers like SaverOne (SVRE, 43,200
    // ordinary per ADS) show fake billion-dollar transactions because
    // `shares × USD-per-ADS-price` inflates by the ADR ratio.
    const adrRatio = detectAdrRatio(footnotesText);
    const normalizedShares = adrRatio > 1 && shares > 0 ? shares / adrRatio : shares;

    txs.push({
      txIndex: i,
      transactionDate,
      transactionCode: code,
      direction,
      shares: normalizedShares,
      pricePerShare: price,
      totalValue: price != null && normalizedShares > 0 ? normalizedShares * price : null,
      adrRatio,
      rule10b5_1,
      footnotes: footnotesText,
    });
  }

  if (txs.length === 0) return null;

  return {
    filingAccessionNo,
    filingDate,
    ticker,
    issuerCik,
    reportingOwnerCik,
    reportingOwnerName,
    reportingOwnerRelation: relationBits.join("|"),
    transactions: txs,
  };
}

// ─── End-to-end: fetch a single filing's Form 4 ─────────────────────────

export async function fetchAndParseForm4(entry: Form4FeedEntry): Promise<ParsedForm4 | null> {
  const xmlUrl = await locateForm4XmlUrl(entry.filingIndexUrl);
  if (!xmlUrl) return null;
  const xml = await edgarFetch(xmlUrl, { accept: "application/xml" });
  return parseForm4Xml(xml, entry.accessionNo);
}
