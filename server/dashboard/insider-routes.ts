/**
 * Insider trading routes for the dashboard — two widgets, two endpoints:
 *
 *   1. Position Insiders (`/api/dashboard/insiders/positions`) — recent insider
 *      transactions on tickers the user currently holds. Mirrors Position News
 *      rule: situational awareness on what you own, not a discovery scanner.
 *
 *   2. Insider Clusters (`/api/dashboard/insiders/clusters`) — market-wide
 *      tickers where 3+ insiders bought or sold in the last 14 days. Classic
 *      "smart money converging" signal. Discovery surface — names you may
 *      NOT yet hold.
 *
 * Data source: FMP `/insider-trading/search` per-ticker for #1, paginated
 * `/insider-trading/latest` for #2 (same source the scanner-v2 cluster
 * detector uses). Both cached aggressively — insider filings don't move
 * intraday.
 */
import type { Express, Request, Response } from "express";
import { requireAuth } from "../auth";
import { storage } from "../storage";
import type { Trade } from "@shared/schema";
import { fmpGet } from "../data/providers/fmp.client";
import { getInsiderActivitySnapshot } from "../snapshot/insiders";

// ─── Shared types ────────────────────────────────────────────────────────

export interface InsiderTxn {
  symbol: string;
  date: string;                 // YYYY-MM-DD
  insider: string;
  relation: string;
  direction: "buy" | "sell" | "other";
  shares: number;
  pricePer: number;
  value: number;                // shares × pricePer
  txType: string;               // raw FMP code
}

// ─── Position Insiders ───────────────────────────────────────────────────

export interface PositionInsidersResponse {
  items: InsiderTxn[];
  heldTickers: string[];
  generatedAt: string;
}

async function getPositionInsiderActivity(
  tickers: string[],
  lookbackDays: number,
  limit: number,
): Promise<InsiderTxn[]> {
  if (tickers.length === 0) return [];
  const cutoff = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;

  const perTicker = await Promise.all(
    tickers.map(async (t): Promise<InsiderTxn[]> => {
      try {
        const snap = await getInsiderActivitySnapshot(t);
        const rows = snap.value?.recent ?? [];
        const out: InsiderTxn[] = [];
        for (const r of rows) {
          if (!r.date) continue;
          const ts = new Date(r.date).getTime();
          if (isNaN(ts) || ts < cutoff) continue;
          const shares = Number(r.shares) || 0;
          const value = Number(r.value) || 0;
          const pricePer = shares > 0 ? value / shares : 0;
          out.push({
            symbol: t.toUpperCase(),
            date: r.date,
            insider: r.insider || "Unknown",
            relation: r.relation || "",
            direction: (r.direction === "buy" || r.direction === "sell") ? r.direction : "other",
            shares,
            pricePer,
            value,
            txType: r.typeCode || "",
          });
        }
        return out;
      } catch {
        return [];
      }
    }),
  );

  const merged = perTicker.flat();
  merged.sort((a, b) => b.date.localeCompare(a.date));
  return merged.slice(0, limit);
}

export function registerPositionInsidersRoute(app: Express): void {
  app.get(
    "/api/dashboard/insiders/positions",
    requireAuth,
    async (req: Request, res: Response) => {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: "unauthenticated" });
      try {
        const lookbackDays = Math.min(Math.max(Number(req.query.lookbackDays) || 30, 1), 180);
        const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
        const trades = (await storage.getAllTrades(userId)) as Trade[];
        const heldTickers = Array.from(
          new Set(trades.filter(t => !t.closeDate).map(t => String(t.symbol).toUpperCase())),
        );
        const items = await getPositionInsiderActivity(heldTickers, lookbackDays, limit);
        res.json({
          items,
          heldTickers,
          generatedAt: new Date().toISOString(),
        } satisfies PositionInsidersResponse);
      } catch (err: any) {
        console.error("[dashboard] insiders/positions failed:", err?.message || err);
        res.status(500).json({ error: "position_insiders_failed", message: String(err?.message || err) });
      }
    },
  );
}

// ─── Insider Clusters (market-wide discovery) ────────────────────────────

export interface InsiderCluster {
  symbol: string;
  direction: "buy" | "sell";
  insiderCount: number;         // unique insiders in the window
  totalShares: number;
  totalDollar: number;
  topInsiders: string[];        // up to 3 names for the row preview
  windowDays: number;
}

export interface InsiderClustersResponse {
  clusters: InsiderCluster[];
  scannedAt: string;
  windowDays: number;
}

const CLUSTER_WINDOW_DAYS = 14;
const CLUSTER_MIN_INSIDERS = 3;
const CLUSTER_PAGES = 18;
const CLUSTER_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface ClusterCacheEntry {
  scannedAt: number;
  clusters: InsiderCluster[];
}
let clusterCache: ClusterCacheEntry | null = null;
let clusterInFlight: Promise<InsiderCluster[]> | null = null;

async function scanInsiderClusters(): Promise<InsiderCluster[]> {
  const cutoff = Date.now() - CLUSTER_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  // symbol -> direction -> Map<insiderKey, {name, shares, value}>
  const bySymbol = new Map<string, {
    buys: Map<string, { name: string; shares: number; value: number }>;
    sells: Map<string, { name: string; shares: number; value: number }>;
  }>();

  for (let page = 0; page < CLUSTER_PAGES; page++) {
    const rows = await fmpGet<any[]>("/insider-trading/latest", { limit: 1000, page });
    if (!Array.isArray(rows) || rows.length === 0) break;

    let anyInWindow = false;
    for (const r of rows) {
      const dateStr = r?.filingDate || r?.transactionDate;
      if (!dateStr) continue;
      const t = new Date(dateStr).getTime();
      if (isNaN(t)) continue;
      if (t >= cutoff) anyInWindow = true;
      if (t < cutoff) continue;

      const txType = String(r?.transactionType || "");
      let dir: "buys" | "sells" | null = null;
      if (txType === "P-Purchase") dir = "buys";
      else if (txType === "S-Sale") dir = "sells";
      else continue;

      const sym = String(r?.symbol || "").toUpperCase();
      const insiderKey = String(r?.reportingCik || r?.reportingName || "");
      const insiderName = String(r?.reportingName || "Unknown");
      if (!sym || !insiderKey) continue;

      let entry = bySymbol.get(sym);
      if (!entry) {
        entry = { buys: new Map(), sells: new Map() };
        bySymbol.set(sym, entry);
      }
      const shares = Number(r?.securitiesTransacted) || 0;
      const price = Number(r?.price) || 0;
      const existing = entry[dir].get(insiderKey);
      if (existing) {
        existing.shares += shares;
        existing.value += shares * price;
      } else {
        entry[dir].set(insiderKey, { name: insiderName, shares, value: shares * price });
      }
    }

    if (!anyInWindow) break;
  }

  const out: InsiderCluster[] = [];
  bySymbol.forEach((entry, sym) => {
    for (const dir of ["buys", "sells"] as const) {
      const m = entry[dir];
      if (m.size < CLUSTER_MIN_INSIDERS) continue;
      let shares = 0;
      let value = 0;
      const names: Array<{ name: string; shares: number }> = [];
      m.forEach(v => {
        shares += v.shares;
        value += v.value;
        names.push({ name: v.name, shares: v.shares });
      });
      names.sort((a, b) => b.shares - a.shares);
      out.push({
        symbol: sym,
        direction: dir === "buys" ? "buy" : "sell",
        insiderCount: m.size,
        totalShares: shares,
        totalDollar: value,
        topInsiders: names.slice(0, 3).map(n => n.name),
        windowDays: CLUSTER_WINDOW_DAYS,
      });
    }
  });

  // Sort: buys first (rarer + more informative), then by insider count desc.
  out.sort((a, b) => {
    if (a.direction !== b.direction) return a.direction === "buy" ? -1 : 1;
    return b.insiderCount - a.insiderCount;
  });
  return out;
}

async function getInsiderClusters(): Promise<{ clusters: InsiderCluster[]; scannedAt: number }> {
  const now = Date.now();
  if (clusterCache && now - clusterCache.scannedAt < CLUSTER_CACHE_TTL_MS) {
    return { clusters: clusterCache.clusters, scannedAt: clusterCache.scannedAt };
  }
  if (clusterInFlight) {
    const clusters = await clusterInFlight;
    return { clusters, scannedAt: clusterCache?.scannedAt ?? Date.now() };
  }
  clusterInFlight = scanInsiderClusters()
    .then(clusters => {
      clusterCache = { scannedAt: Date.now(), clusters };
      return clusters;
    })
    .finally(() => {
      clusterInFlight = null;
    });
  const clusters = await clusterInFlight;
  return { clusters, scannedAt: clusterCache?.scannedAt ?? Date.now() };
}

export function registerInsiderClustersRoute(app: Express): void {
  app.get(
    "/api/dashboard/insiders/clusters",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
        const directionFilter = req.query.direction === "buy" || req.query.direction === "sell"
          ? req.query.direction
          : null;
        const { clusters, scannedAt } = await getInsiderClusters();
        const filtered = directionFilter
          ? clusters.filter(c => c.direction === directionFilter)
          : clusters;
        res.json({
          clusters: filtered.slice(0, limit),
          scannedAt: new Date(scannedAt).toISOString(),
          windowDays: CLUSTER_WINDOW_DAYS,
        } satisfies InsiderClustersResponse);
      } catch (err: any) {
        console.error("[dashboard] insiders/clusters failed:", err?.message || err);
        res.status(500).json({ error: "insider_clusters_failed", message: String(err?.message || err) });
      }
    },
  );
}
