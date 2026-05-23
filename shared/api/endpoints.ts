/**
 * API endpoints — canonical paths used by the frontend.
 *
 * Per the universal-structure rule (2026-05-15): every `apiRequest(...)`
 * call in client code uses a named constant from this file, never a raw
 * string. Server routes register against the same paths.
 *
 * Why one module:
 *   - Renaming an endpoint = one edit. Without this, you grep across the
 *     codebase and hope you got every call site.
 *   - Typos are caught at compile time. "/api/anaylze" never ships.
 *   - The list itself is the documentation — every endpoint the site
 *     actually uses is enumerated below.
 *
 * Naming convention: SCREAMING_SNAKE_CASE noun representing the resource,
 * optionally suffixed with the sub-resource. `_ID` suffix means the path
 * takes a path-parameter (ticker, id, etc.) — use the helper functions
 * to build the final string.
 *
 * For path-parameter endpoints, prefer the builder helpers below rather
 * than template-literal concatenation in callers.
 */

// ─── Auth ───────────────────────────────────────────────────────────────

export const API_AUTH_LOGIN           = "/api/auth/login";
export const API_AUTH_LOGOUT          = "/api/auth/logout";
export const API_AUTH_REGISTER        = "/api/auth/register";
export const API_AUTH_ME              = "/api/auth/me";
export const API_AUTH_PROFILE         = "/api/auth/profile";
export const API_AUTH_CHANGE_PASSWORD = "/api/auth/change-password";
export const API_AUTH_FORGOT_PASSWORD = "/api/auth/forgot-password";
export const API_AUTH_RESET_PASSWORD  = "/api/auth/reset-password";
export const API_AUTH_COMPLETE_TOUR   = "/api/auth/complete-tour";

// ─── Account / subscription ─────────────────────────────────────────────

export const API_ACCOUNT_SETTINGS     = "/api/account/settings";
export const API_SUBSCRIPTION_STATUS  = "/api/subscription/status";

// ─── Dashboard / favorites ──────────────────────────────────────────────

export const API_DASHBOARD_LAYOUT     = "/api/dashboard/layout";
export const API_FAVORITES            = "/api/favorites";
export const API_FAVORITES_WATCHLIST  = "/api/favorites/watchlist";
export const API_FAVORITES_PORTFOLIO  = "/api/favorites/portfolio";

// ─── Per-ticker analysis ────────────────────────────────────────────────

export const API_ANALYZE              = "/api/analyze";        // GET /api/analyze/:ticker
export const API_TRADE_ANALYSIS       = "/api/trade-analysis"; // GET /api/trade-analysis/:ticker
export const API_VERDICT              = "/api/verdict";        // GET /api/verdict/:ticker
export const API_CONVICTION           = "/api/conviction";     // GET /api/conviction/:ticker
export const API_MM_EXPOSURE          = "/api/mm-exposure";    // GET /api/mm-exposure/:ticker
export const API_INSTITUTIONAL        = "/api/institutional";  // GET /api/institutional/:ticker
export const API_CHART                = "/api/chart";          // GET /api/chart/:ticker

// ─── Scanners (v1 + v2) ─────────────────────────────────────────────────

export const API_SCANNER              = "/api/scanner";
export const API_SCANNER_V2           = "/api/scanner/v2";
export const API_SCANNER_3STRAT       = "/api/scanner/3strat";
export const API_SCANNER_AMC          = "/api/scanner/amc";
export const API_SCANNER_V2_INDICATORS = "/api/scanner-v2/indicators";
export const API_SCANNER_V2_PULSE     = "/api/scanner-v2/pulse";
export const API_SCANNER_V2_QUICK     = "/api/scanner-v2/quick";
export const API_INSTITUTIONAL_SCAN   = "/api/institutional-scan";

// ─── Market & sector ────────────────────────────────────────────────────

export const API_MARKET_PULSE         = "/api/market-pulse";
export const API_SECTORS              = "/api/sectors";
export const API_EARNINGS_CALENDAR    = "/api/earnings-calendar";

// ─── Dividends ──────────────────────────────────────────────────────────

export const API_DIVIDENDS            = "/api/dividends";
export const API_DIVIDENDS_SCAN       = "/api/dividends/scan";
export const API_DIVIDENDS_WEEKLY_STRATEGY = "/api/dividends/weekly-strategy";
export const API_DIVIDEND_PORTFOLIO   = "/api/dividend-portfolio";

// ─── Trades / analytics ─────────────────────────────────────────────────

export const API_TRADES               = "/api/trades";
export const API_TRADES_SUMMARY       = "/api/trades/summary";
export const API_TRADES_ANALYTICS     = "/api/trades/analytics";
export const API_TRADES_MFE_MAE       = "/api/trades/mfe-mae";
export const API_TRADES_REFRESH_PRICES = "/api/trades/refresh-prices";

// ─── Track record / backtest ────────────────────────────────────────────

export const API_TRACK_RECORD         = "/api/track-record";
export const API_TRACK_RECORD_BACKTEST = "/api/track-record/backtest";

// ─── Alerts ─────────────────────────────────────────────────────────────

export const API_ALERTS               = "/api/alerts";
export const API_ALERT_RULES          = "/api/alert-rules";
export const API_ALERTS_EVALUATE_NOW  = "/api/alerts/evaluate-now";

// ─── Admin ──────────────────────────────────────────────────────────────

export const API_ADMIN_STATS          = "/api/admin/stats";
export const API_ADMIN_USERS          = "/api/admin/users";

// ─── Diag (kept here too so they're tracked) ────────────────────────────

export const API_DIAG_CONVICTION_BACKTEST = "/api/diag/conviction/backtest";

// ─── Builders for path-parameter endpoints ──────────────────────────────

/** Build `/api/analyze/<ticker>`. */
export const analyzePath = (ticker: string) => `${API_ANALYZE}/${ticker}`;
/** Build `/api/trade-analysis/<ticker>`. */
export const tradeAnalysisPath = (ticker: string) => `${API_TRADE_ANALYSIS}/${ticker}`;
/** Build `/api/verdict/<ticker>`. */
export const verdictPath = (ticker: string) => `${API_VERDICT}/${ticker}`;
/** Build `/api/conviction/<ticker>`. */
export const convictionPath = (ticker: string) => `${API_CONVICTION}/${ticker}`;
/** Build `/api/mm-exposure/<ticker>`. */
export const mmExposurePath = (ticker: string) => `${API_MM_EXPOSURE}/${ticker}`;
/** Build `/api/institutional/<ticker>`. */
export const institutionalPath = (ticker: string) => `${API_INSTITUTIONAL}/${ticker}`;
/** Build `/api/chart/<ticker>`. */
export const chartPath = (ticker: string) => `${API_CHART}/${ticker}`;
/** Build `/api/dividends/<ticker>`. */
export const dividendsPath = (ticker: string) => `${API_DIVIDENDS}/${ticker}`;
/** Build `/api/trades/<id>`. */
export const tradePath = (id: string | number) => `${API_TRADES}/${id}`;
