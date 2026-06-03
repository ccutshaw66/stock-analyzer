/**
 * useTickerNavigate — single source of truth for "user clicked a ticker."
 *
 * Rule (2026-05-27, Chris):
 *   Any ticker click anywhere on the site should set the global active
 *   ticker AND navigate to /profile, so the per-ticker research funnel
 *   (stages 3·Company → 4·Setup → 5·Decision) becomes the working context.
 *
 * Exception: if the current page IS per-ticker analysis (it reads the
 * active ticker from context and renders that ticker's research), the
 * click just swaps the ticker and we stay on the page.
 *
 * The "stay" set below is exactly those per-ticker funnel pages (the ones
 * that read the active ticker from context). Market-wide pages in the same
 * funnel groups (e.g. /earnings, /insiders) are deliberately NOT stay routes.
 *
 * Note: /htf/:symbol embeds the ticker in the URL — it does NOT read from
 * TickerContext — so it's deliberately NOT a stay route. Clicking a ticker
 * from that page sends you to /profile, the canonical research surface.
 */
import { useLocation } from "wouter";
import { useTicker } from "@/contexts/TickerContext";

const STAY_ROUTES: readonly string[] = [
  "/profile",
  "/trade",
  "/chart",
  "/mm-exposure",
  "/institutional",
  "/conviction",
  "/verdict",
];

export function isCompanyResearchRoute(path: string): boolean {
  return STAY_ROUTES.some((r) => path === r || path.startsWith(r + "/"));
}

export function useTickerNavigate() {
  const [location, navigate] = useLocation();
  const { setActiveTicker } = useTicker();

  return (ticker: string) => {
    if (!ticker) return;
    setActiveTicker(ticker);
    if (!isCompanyResearchRoute(location)) {
      navigate("/profile");
    }
  };
}
