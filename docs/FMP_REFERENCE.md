# FMP Endpoint + Field Reference

Living doc. Every FMP endpoint we hit is recorded here with the verbatim field names returned. Update when we discover new fields, when FMP renames things, or when a field-name guess fails in production.

**Last verified:** 2026-05-06.

**Base URL:** `https://financialmodelingprep.com/stable/...` (the stable API). Some legacy endpoints still use `/api/v3/...` or `/api/v4/...`. Our `fmpGet` client should be hitting the stable base.

---

## FULL ENDPOINT CATALOG (247 endpoints, stable API)

Sourced from the maintained `fmp-data` Python client docs (2026-05-06). All endpoints prefixed with `/stable/` unless noted. Use this list as the authoritative starter — pick the right endpoint here BEFORE writing code.

### Endpoints we ALREADY use
- `/stable/profile` — company profile (no `sharesOutstanding`; derive from `marketCap/price`)
- `/stable/quote` — real-time quote
- `/stable/ratios-ttm` — TTM financial ratios
- `/stable/key-metrics-ttm` — TTM key metrics
- `/stable/income-statement` — income statement (use `limit=2` for YoY diff)
- `/stable/balance-sheet-statement` — balance sheet
- `/stable/historical-price-eod` — EOD chart (alias `/historical-price-eod/full`)
- `/stable/insider-trading/search` — insider transactions
- `/stable/institutional-ownership/symbol-positions-summary` — institutional aggregate
- `/stable/institutional-ownership/extract-analytics/holder` — top holders

### Endpoints we SHOULD adopt (high-value, currently missing)
- **`/stable/shares-float`** — current share float + total shares outstanding. Direct source for `sharesOutstanding`, cleaner than `marketCap/price` derivation. **Use this for institutional ownership %.**
- **`/stable/historical/shares-float`** — historical float, useful for tracking dilution/buybacks
- **`/stable/insider-trading/statistics`** — aggregate insider stats per ticker (replaces our manual rollup of `/insider-trading/search`)
- **`/stable/acquisition-of-beneficial-ownership`** — Form 3/4/5 beneficial ownership (could give insider % directly)
- **`/stable/financial-scores`** — Altman Z-Score, Piotroski Score, financial health rollup
- **`/stable/grades-consensus`** — analyst grade consensus
- **`/stable/price-target-consensus`** — price target consensus
- **`/stable/earnings-calendar`** — for cache-invalidation triggers per the caching strategy
- **`/stable/dividends`** — historical dividends per ticker
- **`/stable/splits`** — historical splits

### Bulk endpoints (cache-warmup goldmine — 30 endpoints)
Designed for nightly cron warmup: hit ONE bulk endpoint, populate caches for thousands of tickers. Aligns directly with the aggressive-caching strategy.
- `/stable/profile-bulk` — every company profile in one call
- `/stable/key-metrics-ttm-bulk` — TTM key metrics in bulk
- `/stable/ratios-ttm-bulk` — TTM ratios in bulk
- `/stable/scores-bulk` — financial scores in bulk
- `/stable/eod-bulk` — EOD prices for all symbols
- `/stable/peers-bulk` — peer lists for every symbol
- `/stable/etf-holder-bulk` — ETF holdings in bulk
- `/stable/income-statement-bulk` — income statements in bulk
- `/stable/balance-sheet-statement-bulk` — balance sheets in bulk
- `/stable/cash-flow-statement-bulk` — cash flow statements in bulk
- `/stable/income-statement-growth-bulk`, `/stable/balance-sheet-statement-growth-bulk`, `/stable/cash-flow-statement-growth-bulk` — growth rates in bulk
- `/stable/dcf-bulk` — DCF valuations in bulk
- `/stable/earnings-surprises-bulk` — earnings surprises (per year)
- `/stable/price-target-summary-bulk` — price target summaries
- `/stable/upgrades-downgrades-consensus-bulk` — analyst consensus changes
- `/stable/rating-bulk` — stock ratings in bulk
- `/stable/batch-quote`, `/stable/batch-quote-short` — multi-symbol quotes (less broad than `-bulk` but lighter)
- `/stable/batch-aftermarket-quote`, `/stable/batch-aftermarket-trade`, `/stable/batch-exchange-quote`, `/stable/batch-etf-quotes`, `/stable/batch-mutualfund-quotes`, `/stable/batch-commodity-quotes`, `/stable/batch-crypto-quotes`, `/stable/batch-forex-quotes`, `/stable/batch-index-quotes`
- `/stable/market-capitalization-batch` — multi-symbol market cap

### Institutional section (25 endpoints — only 2 currently used)
- `/stable/institutional-ownership/symbol-positions-summary` — IN USE
- `/stable/institutional-ownership/extract-analytics/holder` — IN USE
- `/stable/institutional-ownership/extract` — bulk filings extract (alternative to per-quarter)
- `/stable/institutional-ownership/dates` — Form 13F filing dates (use to detect when current quarter aggregates are ready, fixes the in-progress-quarter bug correctly)
- `/stable/institutional-ownership/holder-industry-breakdown` — breakdown by industry
- `/stable/institutional-ownership/holder-performance-summary` — performance per holder
- `/stable/institutional-ownership/industry-summary` — industry rollup
- `/stable/institutional-ownership/latest` — latest filings (might bypass quarter selection issue)
- `/stable/13f-asset-allocation` — 13F asset allocation
- `/stable/acquisition-of-beneficial-ownership` — Form 3/4/5 beneficial ownership

### Insider section (12 endpoints — 1 currently used)
- `/stable/insider-trading/search` — IN USE
- `/stable/insider-trading/latest` — latest activity
- `/stable/insider-trading/reporting-name` — search by insider name
- `/stable/insider-trading/statistics` — aggregate stats per ticker
- `/stable/insider-trading-transaction-type` — list of transaction type codes

### ETF / Investment (14 endpoints — none currently used)
Useful if we want to expose "what ETFs hold this stock" or fund-flow signals.
- `/stable/etf/asset-exposure` — which ETFs hold this stock
- `/stable/etf/holder` — ETF holders
- `/stable/etf/holdings` — ETF holdings
- `/stable/etf/info` — ETF metadata
- `/stable/etf/sector-weightings`, `/stable/etf/country-weightings`
- `/stable/funds/disclosure-holders-latest`, `/stable/funds/disclosure-holders-search` — N-PORT-style fund disclosures (this is the "real fund holdings" data we wanted)
- `/stable/mutual-fund-holdings`

### Market Intelligence (47 endpoints — partial use)
- `/stable/earnings-calendar` — earnings calendar (drives cache invalidation)
- `/stable/dividends-calendar` — dividends calendar
- `/stable/grades`, `/stable/grades-consensus`, `/stable/grades-historical`, `/stable/grades-news`
- `/stable/price-target`, `/stable/price-target-consensus`, `/stable/price-target-summary`, `/stable/price-target-news`
- `/stable/news/stock`, `/stable/news/stock-latest`, `/stable/news/press-releases`, `/stable/news/press-releases-latest`
- `/stable/ratings-snapshot`, `/stable/ratings-historical`
- `/stable/social-sentiments/change`, `/stable/social-sentiments/trending`
- `/stable/historical/social-sentiment`
- `/stable/senate-trades`, `/stable/senate-trades-by-name`, `/stable/senate-latest`
- `/stable/house-trades`, `/stable/house-trades-by-name`, `/stable/house-latest`
- `/stable/esg-data`, `/stable/esg-disclosures`, `/stable/esg-ratings`, `/stable/esg-benchmark`
- `/stable/ipos-calendar`, `/stable/ipos-disclosure`, `/stable/ipos-prospectus`

### Technical Indicators (9 endpoints, all server-side computed)
- `/stable/technical-indicators/{adx,dema,ema,rsi,sma,standarddeviation,tema,williams,wma}` — FMP can compute these for us instead of running our own rolling-window math.

### SEC (12 endpoints)
- `/stable/sec-filings-8k`, `/stable/sec-filings-financials`
- `/stable/sec-filings-search/{cik,symbol,form-type}`
- `/stable/sec-company-search/{cik,name,symbol}`

### Index constituents
- `/stable/sp500-constituent`, `/stable/nasdaq-constituent`, `/stable/dowjones-constituent`
- `/stable/historical-sp500-constituent`, `/stable/historical-nasdaq-constituent`, `/stable/historical-dowjones-constituent`

---

**Field schema discovery:** the FMP docs site (`site.financialmodelingprep.com`) is Cloudflare-protected and blocks automated fetches. To learn the field schema for an endpoint we haven't hit, the practical path is to call it via our `/api/diag/fmp-inst/:ticker` (or a similar diag) on prod and inspect the raw response.

---

## Institutional Ownership

### `/institutional-ownership/symbol-positions-summary`

Aggregate institutional holdings stats for a ticker for a specific quarter.

**Required params:** `symbol`, `year`, `quarter`.

**Response:** array of one object (or empty if filings not yet aggregated for that quarter).

**Fields (verified via FMP docs / changelog 2026-05-06):**
- `symbol` — ticker
- `cik` — company CIK
- `date` — quarter-end date (e.g. "2025-12-31")
- `investorsHolding` — number of institutional investors currently holding
- `lastInvestorsHolding` — count from prior quarter
- `investorsHoldingChange` — delta
- `numberOf13Fshares` — **total shares held by 13F filers**. This is the share count we want for institutional ownership %.
- `lastNumberOf13Fshares`
- `numberOf13FsharesChange`
- `totalInvested` — total $ value held
- `lastTotalInvested`
- `totalInvestedChange`
- `ownershipPercent` — FMP's own institutional ownership %. **OBSERVED UNRELIABLE** (returned 4.8% for both MSFT and AMZN, which is impossible). Compute ourselves from `numberOf13Fshares / sharesOutstanding * 100` instead.
- `lastOwnershipPercent`
- `ownershipPercentChange`
- `putCallRatio`, `lastPutCallRatio`, `putCallRatioChange`
- (Recent additions) `averageHoldingPeriod`, `averageHoldingPeriodTop10`, `averageHoldingPeriodTop20`

**Quarter availability rule:** 13F filings are due 45 days after quarter end. Aggregate data is reliable ~60 days after quarter end. **Do not query a quarter whose end date is less than 60 days ago** — you'll get partial data with zeros.

### `/institutional-ownership/extract-analytics/holder`

Per-holder breakdown for a ticker for a specific quarter.

**Required params:** `symbol`, `year`, `quarter`, `page`, `limit` (we use up to 1000).

**Fields per holder row (from existing code reads — verify on next diag):**
- `investorName` (or alias `holder`, `name`)
- `cik` — filer CIK (use as primary key for QoQ matching, NOT name)
- `sharesNumber` (or alias `shares`, `position`)
- `marketValue` (or alias `value`)
- `weight` / `weightPercent` / `ownership` — % of holder's portfolio in this position (NOT % of company)
- `date` / `dateReported` — quarter end of the filing

---

## Insider Trading

### `/insider-trading/search`

Insider transactions for a symbol.

**Required params:** `symbol`, `page`, `limit`.

**Fields (verified):**
- `symbol`
- `filingDate`
- `transactionDate`
- `reportingCik` — insider's CIK
- `companyCik`
- `transactionType` — code like "P-Purchase", "S-Sale", "M-Exempt", etc.
- `securitiesTransacted` — shares in this transaction
- `price` — per-share price
- `securitiesOwned` — **insider's total shares held AFTER this transaction**. Use this for current insider %.
- `reportingName` — insider name
- `typeOfOwner` — relation (officer, director, 10% owner, etc.)
- `acquistionOrDisposition` — "A" or "D" (note FMP's typo — `acquistion` not `acquisition`)

**To compute insider %:** group rows by `reportingCik` (fall back to `reportingName`), take the row with the latest `filingDate`, sum `securitiesOwned` across insiders, divide by sharesOutstanding × 100.

---

## Profile / Quote

### `/profile`

Company profile.

**Fields (verified via 2026-05-06 diag of MSFT):**
- `symbol`, `companyName`, `cik`, `isin`, `cusip`
- `price` — last quote price
- `marketCap` — market capitalization
- `beta`, `lastDividend`, `range`, `change`, `changePercentage`, `volume`, `averageVolume`
- `currency`, `exchangeFullName`, `exchange`, `industry`, `sector`, `country`
- `website`, `description`, `ceo`, `image`
- `fullTimeEmployees`, `phone`, `address`, `city`, `state`, `zip`
- `ipoDate`
- `defaultImage`, `isEtf`, `isActivelyTrading`, `isAdr`, `isFund`

**No `sharesOutstanding` field.** Derive as `marketCap / price`.

### `/quote`

Real-time quote.

**Fields (verified):**
- `symbol`, `name`, `price`
- `changePercentage`, `change`, `volume`
- `dayLow`, `dayHigh`, `yearHigh`, `yearLow`
- `marketCap`
- `priceAvg50`, `priceAvg200`
- `exchange`, `open`, `previousClose`, `timestamp`

---

## Ratios / Key Metrics

### `/ratios-ttm`

Trailing-twelve-month ratios. **All field names use the `TTM` suffix** under the stable API (legacy v3 names without TTM are deprecated).

**Fields (verified 2026-05-06 for MSFT):**
- `grossProfitMarginTTM`, `ebitMarginTTM`, `ebitdaMarginTTM`, `operatingProfitMarginTTM`, `pretaxProfitMarginTTM`, `continuousOperationsProfitMarginTTM`, `netProfitMarginTTM`, `bottomLineProfitMarginTTM`
- `receivablesTurnoverTTM`, `payablesTurnoverTTM`, `inventoryTurnoverTTM`, `fixedAssetTurnoverTTM`, `assetTurnoverTTM`
- `currentRatioTTM`, `quickRatioTTM`, `solvencyRatioTTM`, `cashRatioTTM`
- `priceToEarningsRatioTTM`, `priceToEarningsGrowthRatioTTM`, `forwardPriceToEarningsGrowthRatioTTM`, `priceToBookRatioTTM`, `priceToSalesRatioTTM`, `priceToFreeCashFlowRatioTTM`, `priceToOperatingCashFlowRatioTTM`
- `debtToAssetsRatioTTM`, **`debtToEquityRatioTTM`**, `debtToCapitalRatioTTM`, `longTermDebtToCapitalRatioTTM`, `financialLeverageRatioTTM`
- `workingCapitalTurnoverRatioTTM`, `operatingCashFlowRatioTTM`, `operatingCashFlowSalesRatioTTM`
- `freeCashFlowOperatingCashFlowRatioTTM`, `debtServiceCoverageRatioTTM`, `interestCoverageRatioTTM`
- `dividendPayoutRatioTTM`, `dividendYieldTTM`, `dividendPerShareTTM`
- `revenuePerShareTTM`, `netIncomePerShareTTM`, `interestDebtPerShareTTM`, `cashPerShareTTM`, `bookValuePerShareTTM`, `tangibleBookValuePerShareTTM`, `shareholdersEquityPerShareTTM`, `operatingCashFlowPerShareTTM`, `capexPerShareTTM`, `freeCashFlowPerShareTTM`
- `enterpriseValueTTM`, `effectiveTaxRateTTM`, `enterpriseValueMultipleTTM`
- (No `revenueGrowth` / `earningsGrowth` here — must compute from `/income-statement` YoY diff.)

### `/key-metrics-ttm`

**Fields:** `marketCap`, `enterpriseValueTTM`, `evToSalesTTM`, `evToOperatingCashFlowTTM`, `evToFreeCashFlowTTM`, `evToEBITDATTM`, `netDebtToEBITDATTM`, `currentRatioTTM`, `incomeQualityTTM`, `grahamNumberTTM`, **`returnOnEquityTTM`**, `returnOnAssetsTTM`, `returnOnInvestedCapitalTTM`, `returnOnCapitalEmployedTTM`, `earningsYieldTTM`, `freeCashFlowYieldTTM`, `capexToOperatingCashFlowTTM`, `capexToDepreciationTTM`, `capexToRevenueTTM`, `salesGeneralAndAdministrativeToRevenueTTM`, `researchAndDevelopementToRevenueTTM` (note FMP typo — "Developement"), `stockBasedCompensationToRevenueTTM`, `intangiblesToTotalAssetsTTM`, `averageReceivablesTTM`, `averagePayablesTTM`, `averageInventoryTTM`, `daysOfSalesOutstandingTTM`, `daysOfPayablesOutstandingTTM`, `daysOfInventoryOutstandingTTM`, `operatingCycleTTM`, `cashConversionCycleTTM`, `freeCashFlowToEquityTTM`, `freeCashFlowToFirmTTM`, `tangibleAssetValueTTM`, `netCurrentAssetValueTTM`, `workingCapitalTTM`, `investedCapitalTTM`.

### `/income-statement`

For YoY revenue/earnings growth: pull `limit=2` (current + prior period) and diff `revenue` and `netIncome`.

---

## Historical Prices

### `/historical-price-eod/full`

End-of-day historical bars.

**Required params:** `symbol`, optional `from`, `to` (`YYYY-MM-DD`).

**Caps:** ~5000 rows per call (~20y of trading days). For 25-year history split into chunks (`2000-01-01..2009-12-31` and `2010-01-01..today`).

**Response shape:** array OR `{ historical: [...] }` (FMP has been inconsistent). Treat both.

Per row: `date`, `open`, `high`, `low`, `close`, `volume`, `adjClose`, `change`, `changePercent`.

Used by: stress-test long-range chart, scanner indicators, snapshot pipeline.

---

## Diag

`/api/diag/fmp/:ticker` — dumps ratiosTtm + keyMetricsTtm + profile + quote + balanceSheetLatest.

`/api/diag/fmp-inst/:ticker` — dumps positions-summary + holders sample (+ insider sample after pending diag enhancement).

---

## Common pitfalls observed in production

1. **Stable-API field rename to `*TTM` suffixes** (Aug 2025). Any code reading legacy v3 names like `debtEquityRatio` / `payoutRatio` returns null. Always read `*TTM` first.
2. **`numberOf13Fshares` returns 0 when querying a quarter whose 13F filings aren't yet aggregated.** Quarter selection MUST require quarter-end-date >= 60 days ago. The naive "60 days ago is in quarter X → use X" picks the IN-PROGRESS quarter and gets zeros.
3. **`ownershipPercent` field is unreliable.** Returned 4.8% for both MSFT and AMZN as observed 2026-05-06. Compute ownership % yourself from `numberOf13Fshares / sharesOutstanding`.
4. **`/profile` does NOT return `sharesOutstanding`.** Derive as `marketCap / price`.
5. **`acquistionOrDisposition`** — FMP's spelling, not `acquisition`. Don't fix the typo or the field disappears.
6. **Multi-CIK filers** — UBS/HSBC/etc. file under multiple CIKs. Match QoQ deltas by CIK first, name as fallback. Summing-by-name produces wildly negative ratios for the smaller subsidiary rows.
