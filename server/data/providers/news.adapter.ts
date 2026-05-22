/**
 * News adapter — wraps FMP `/stable/news/stock-latest` + `/stable/news/press-releases-latest`
 * for the dashboard's Position News widget.
 *
 * Per Chris's rule: news is for situational awareness on tickers the user
 * already holds, NOT a trade-the-news scanner. The adapter is keyed by
 * symbol and is intentionally NOT exposed as a discovery / search surface.
 *
 * Cache: 30 min TTL via fmpGet's built-in cache (news doesn't move that
 * fast at the daily-trading cadence Stockotter targets, and headlines are
 * deduped per-fetch).
 */
import { fmpGet } from "./fmp.client";

export interface NewsItem {
  symbol: string;
  publishedAt: string;             // ISO 8601
  title: string;
  url: string;
  publisher: string | null;
  site: string | null;             // FMP's source domain (e.g. "reuters.com")
  text: string | null;             // short excerpt; may be null
  imageUrl: string | null;
  kind: "news" | "press-release";  // FMP source endpoint
}

interface FmpNewsRow {
  symbol?: string;
  publishedDate?: string;          // FMP returns ISO-ish e.g. "2026-05-21 14:32:18"
  title?: string;
  url?: string;
  publisher?: string;
  site?: string;
  text?: string;
  image?: string;
}

function toIso(d: string | undefined): string {
  if (!d) return new Date(0).toISOString();
  // FMP returns "YYYY-MM-DD HH:MM:SS" — coerce to ISO. Treat as UTC if no zone.
  const cleaned = d.includes("T") ? d : d.replace(" ", "T") + "Z";
  const parsed = new Date(cleaned);
  return isNaN(parsed.getTime()) ? new Date(0).toISOString() : parsed.toISOString();
}

function mapRow(row: FmpNewsRow, fallbackSymbol: string, kind: NewsItem["kind"]): NewsItem | null {
  if (!row?.title || !row.url) return null;
  return {
    symbol: (row.symbol || fallbackSymbol).toUpperCase(),
    publishedAt: toIso(row.publishedDate),
    title: row.title.trim(),
    url: row.url,
    publisher: row.publisher?.trim() || null,
    site: row.site?.trim() || null,
    text: row.text?.trim() || null,
    imageUrl: row.image || null,
    kind,
  };
}

/**
 * Latest news for ONE symbol — pulls from both the stock-news and press-release
 * endpoints in parallel and merges by publishedAt desc.
 */
export async function getNewsForSymbol(symbol: string, limit = 20): Promise<NewsItem[]> {
  const T = symbol.toUpperCase();
  const [stockRows, pressRows] = await Promise.all([
    fmpGet<FmpNewsRow[]>("/news/stock-latest", { symbols: T, limit }).catch(() => [] as FmpNewsRow[]),
    fmpGet<FmpNewsRow[]>("/news/press-releases-latest", { symbols: T, limit }).catch(() => [] as FmpNewsRow[]),
  ]);

  const stock = (Array.isArray(stockRows) ? stockRows : []).map(r => mapRow(r, T, "news"));
  const press = (Array.isArray(pressRows) ? pressRows : []).map(r => mapRow(r, T, "press-release"));

  const all = [...stock, ...press].filter((x): x is NewsItem => x !== null);
  // Dedupe by URL (FMP occasionally double-publishes between feeds)
  const seen = new Set<string>();
  const deduped = all.filter(n => {
    if (seen.has(n.url)) return false;
    seen.add(n.url);
    return true;
  });
  deduped.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  return deduped.slice(0, limit);
}

/**
 * Position News aggregator — fan-out over the user's held tickers in parallel,
 * filter to items from the last `lookbackHours`, and return a merged
 * reverse-chronological list. Caller decides the global limit; default 30 is
 * enough to render the widget without bombing the network on 20-position
 * portfolios.
 */
export async function getNewsForPositions(
  tickers: string[],
  options: { lookbackHours?: number; perSymbolLimit?: number; globalLimit?: number } = {},
): Promise<NewsItem[]> {
  if (tickers.length === 0) return [];
  const lookbackHours = options.lookbackHours ?? 24;
  const perSymbolLimit = options.perSymbolLimit ?? 5;
  const globalLimit = options.globalLimit ?? 30;

  const cutoff = Date.now() - lookbackHours * 60 * 60 * 1000;

  const perTicker = await Promise.all(
    tickers.map(t => getNewsForSymbol(t, perSymbolLimit).catch(() => [] as NewsItem[])),
  );

  const merged = perTicker
    .flat()
    .filter(n => new Date(n.publishedAt).getTime() >= cutoff);

  // Cross-ticker dedupe (e.g. one Reuters story tagged with MSFT + GOOGL)
  const seen = new Set<string>();
  const deduped = merged.filter(n => {
    if (seen.has(n.url)) return false;
    seen.add(n.url);
    return true;
  });
  deduped.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  return deduped.slice(0, globalLimit);
}
