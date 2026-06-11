/**
 * Unified scanner HTTP route. Serves the pre-ranked, FULL-MARKET per-tier cache
 * sliced by the user's REQUIRED filters (market-cap tier + price band) plus
 * optional sector/strategy/score/topN. It never runs a heavy scan on the
 * request path — a cold/stale cache or ?refresh=1 kicks a full background
 * re-scan and returns the current cache immediately with `warming: true`.
 */
import type { Express } from "express";
import { checkScanRateLimit } from "../../middleware/tier";
import {
  getMarketCapTier, getPriceBand, MIN_GREEN, DEFAULT_TOP_N, type ScanFilters,
} from "@shared/scanner/types";
import { listScannableStrategies, getStrategyManifest } from "@shared/strategies/registry";
import { rankHits, SCANNABLE_ENGINE_IDS } from "./engine";
import { readUnifiedScan, readUnifiedScanFresh, unifiedScanAgeHours } from "../../unified-scan-cache";
import { tierCacheKey, startWarmInBackground, isWarmInFlight } from "./warmup";
import { getUserTier } from "../../stripe";
import { optionalAuth } from "../../auth";

function defaultStrategyIds(): string[] {
  const onByDefault = listScannableStrategies()
    .filter(m => m.liveScan?.defaultOn)
    .map(m => m.id);
  return SCANNABLE_ENGINE_IDS.filter(id => onByDefault.includes(id));
}

export function mountRoutes(app: Express): void {
  // NOT gated by checkFeatureAccess('scansPerDay'): serving the pre-computed
  // cache is essentially free (no live FMP work), so a plain Scan must not burn
  // a daily scan credit — that's what was blocking the page after repeated
  // tries. Auth is still enforced by the global `/api` requireAuth. Only an
  // explicit ?refresh=1 (which kicks real work) is rate-limited.
  app.get("/api/unified-scanner", optionalAuth, async (req, res) => {
    const wantsRefresh = req.query.refresh === "1" || req.query.refresh === "true";
    if (wantsRefresh && checkScanRateLimit(req, res)) return;
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
      let strategyIds = (requestedStrategies.length ? requestedStrategies : defaultStrategyIds())
        .filter(id => SCANNABLE_ENGINE_IDS.includes(id));
      // ownerOnly detectors (failed OOS validation, kept for owner experimentation)
      // are reachable ONLY by the owner — never by a public URL-hack of strategyIds.
      const userId = (req as any).user?.id;
      const isOwner = userId ? (await getUserTier(userId)) === "owner" : false;
      if (!isOwner) strategyIds = strategyIds.filter(id => !getStrategyManifest(id).liveScan?.ownerOnly);
      const minScore = Math.max(MIN_GREEN, Number(q.minScore) || MIN_GREEN);
      const topN = Math.min(Math.max(Number(q.topN) || DEFAULT_TOP_N, 1), 200);
      const refresh = q.refresh === "1" || q.refresh === "true";

      const filters: ScanFilters = {
        marketCapTier: tier.id, priceBandId: band.id, sector, strategyIds, minScore, topN,
      };

      const inBand = (p: number) => p >= band.min && (band.max == null || p <= band.max);
      const inSector = (s: string) => sector === "all" || s === sector;

      // Serve from the tier's full-market cache. Read raw (serve even if stale)
      // and use freshness only to decide whether to trigger a background re-scan.
      const cacheKey = tierCacheKey(tier.id);
      const raw = readUnifiedScan(cacheKey);
      const isFresh = readUnifiedScanFresh(cacheKey) !== null;

      let warming = false;
      if (!isFresh || refresh) {
        // Kick a FULL market re-scan in the background (the whole liquid universe,
        // not a subset) — never block the request on it.
        startWarmInBackground();
        warming = isWarmInFlight();
      }

      const base = raw?.payload ?? [];
      const hits = base.filter(h =>
        h.marketCap >= tier.min && (tier.max == null || h.marketCap < tier.max) &&
        inBand(h.price) && inSector(h.sector) && strategyIds.includes(h.strategyId));
      const ranked = rankHits(hits, minScore, topN);

      res.json({
        filters,
        source: raw ? "cache" : "warming",
        warming,
        ageHours: unifiedScanAgeHours(cacheKey),
        generatedAt: new Date().toISOString(),
        count: ranked.length,
        hits: ranked,
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "unified-scanner failed" });
    }
  });
}
