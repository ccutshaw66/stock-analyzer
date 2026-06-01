/**
 * Unified scanner HTTP route. Reads the nightly pre-ranked market cache and
 * slices it by the user's REQUIRED filters (market-cap tier + price band) plus
 * optional sector/strategy/score/topN. On a cold cache or ?refresh=1 it runs a
 * narrowed on-demand scan (bounded by the same filters, so it's tractable).
 */
import type { Express } from "express";
import { checkFeatureAccess, checkScanRateLimit } from "../../middleware/tier";
import {
  getMarketCapTier, getPriceBand, MIN_GREEN, DEFAULT_TOP_N, type ScanFilters,
} from "@shared/scanner/types";
import { listScannableStrategies } from "@shared/strategies/registry";
import { rankHits, SCANNABLE_ENGINE_IDS, type UniverseRow } from "./engine";
import { readUnifiedScanFresh, unifiedScanAgeHours } from "../../unified-scan-cache";
import { scanSymbols, UNIFIED_SCAN_MARKET_KEY } from "./warmup";
import { fmpScreener } from "../../data/providers/fmp.adapter";

function defaultStrategyIds(): string[] {
  const onByDefault = listScannableStrategies()
    .filter(m => m.liveScan?.defaultOn)
    .map(m => m.id);
  return SCANNABLE_ENGINE_IDS.filter(id => onByDefault.includes(id));
}

export function mountRoutes(app: Express): void {
  app.get("/api/unified-scanner", checkFeatureAccess("scansPerDay"), async (req, res) => {
    if (checkScanRateLimit(req, res)) return;
    try {
      const q = req.query;

      // ─── Required filters ───────────────────────────────────────────
      const tier = getMarketCapTier(String(q.marketCapTier || ""));
      if (!tier) {
        return res.status(400).json({ error: "marketCapTier is required (micro|small|mid|large|mega)." });
      }
      const band = getPriceBand(tier.id, String(q.priceBandId || ""));
      if (!band) {
        return res.status(400).json({ error: `priceBandId is required and must belong to the ${tier.id} tier.` });
      }

      // ─── Optional filters ───────────────────────────────────────────
      const sector = q.sector && String(q.sector).toLowerCase() !== "all" ? String(q.sector) : "all";
      const requestedStrategies = String(q.strategyIds || "").split(",").map(s => s.trim()).filter(Boolean);
      const strategyIds = (requestedStrategies.length ? requestedStrategies : defaultStrategyIds())
        .filter(id => SCANNABLE_ENGINE_IDS.includes(id));
      const minScore = Math.max(MIN_GREEN, Number(q.minScore) || MIN_GREEN);
      const topN = Math.min(Math.max(Number(q.topN) || DEFAULT_TOP_N, 1), 200);
      const refresh = q.refresh === "1" || q.refresh === "true";

      const filters: ScanFilters = {
        marketCapTier: tier.id, priceBandId: band.id, sector, strategyIds, minScore, topN,
      };

      const inTier = (mc: number) => mc >= tier.min && (tier.max == null || mc < tier.max);
      const inBand = (p: number) => p >= band.min && (band.max == null || p <= band.max);
      const inSector = (s: string) => sector === "all" || s === sector;

      let hits;
      let source: "cache" | "live";
      let ageHours: number | null = null;

      const cached = refresh ? null : readUnifiedScanFresh(UNIFIED_SCAN_MARKET_KEY);
      if (cached) {
        source = "cache";
        ageHours = unifiedScanAgeHours(UNIFIED_SCAN_MARKET_KEY);
        hits = cached.filter(h =>
          inTier(h.marketCap) && inBand(h.price) && inSector(h.sector) && strategyIds.includes(h.strategyId));
      } else {
        // Cold cache or explicit refresh → narrowed on-demand scan bounded by filters.
        source = "live";
        const universe = await fmpScreener({
          minMarketCap: tier.min,
          maxMarketCap: tier.max ?? undefined,
          minPrice: band.min,
          maxPrice: band.max ?? undefined,
          sector: sector === "all" ? undefined : sector,
          minVolume: 300_000,
          count: 150, // bounded so the on-demand/cold-cache scan stays fast
          noShuffle: true,
        }).catch(() => []);
        const rows = new Map<string, UniverseRow>();
        for (const r of universe) {
          rows.set(r.symbol, { symbol: r.symbol, companyName: r.companyName, marketCap: r.marketCap, sector: r.sector, price: r.price });
        }
        const all = await scanSymbols(Array.from(rows.keys()), rows);
        hits = all.filter(h => strategyIds.includes(h.strategyId));
      }

      const ranked = rankHits(hits, minScore, topN);
      res.json({
        filters,
        source,
        ageHours,
        generatedAt: new Date().toISOString(),
        count: ranked.length,
        hits: ranked,
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "unified-scanner failed" });
    }
  });
}
