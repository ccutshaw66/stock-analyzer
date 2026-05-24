# FMP API Docs — Raw Source (2026-05-06)

Source: pasted from `https://site.financialmodelingprep.com/developer/docs` on 2026-05-06.

This file is the canonical raw FMP docs as of that date. Use `FMP_REFERENCE.md` (in this same dir) for the curated, project-specific cheat sheet — this file is the underlying source.

> **API key:** stored in `.env` as `FMP_API_KEY`. Never paste keys into source files. (The original paste contained a key — assume rotated.)

---

## Authorization

All API requests must be authorized using an API key. Two methods:

- **Header:** `apikey: <YOUR_KEY>`
- **Query:** `?apikey=<YOUR_KEY>` (use `&apikey=` if other params already present)

---

## Common patterns

- **Base URL:** `https://financialmodelingprep.com/stable/`
- **Pagination:** most list endpoints take `page=0&limit=N` query params
- **Bulk endpoints return CSV**, not JSON. Single-symbol endpoints return JSON.
- **Quarter params:** `year=YYYY&quarter=Q` (Q = 1..4) for institutional-ownership endpoints
- **Period params for statements:** `period=Q1|Q2|Q3|Q4|FY`

---

## Verified response schemas (from raw docs)

### Profile (`/stable/profile?symbol=AAPL`)

```
{
  symbol, price, marketCap, beta, lastDividend, range,
  change, changePercentage, volume, averageVolume,
  companyName, currency, cik, isin, cusip,
  exchangeFullName, exchange, industry,
  website, description, ceo, sector, country,
  fullTimeEmployees, phone, address, city, state, zip,
  image, ipoDate, defaultImage,
  isEtf, isActivelyTrading, isAdr, isFund
}
```

NO `sharesOutstanding` field. Must derive from `marketCap / price`.

### Quote (`/stable/quote?symbol=AAPL`)

```
{
  symbol, name, price, changePercentage, change, volume,
  dayLow, dayHigh, yearHigh, yearLow,
  marketCap, priceAvg50, priceAvg200,
  exchange, open, previousClose, timestamp
}
```

### Shares Float (`/stable/shares-float?symbol=AAPL`)

"Total number of publicly traded shares for any company" — direct source for share count, not yet schema-verified but **likely contains `outstandingShares` and `floatShares`**.

### Profile Bulk (`/stable/profile-bulk?part=0`)

CSV. Per-row schema same as `/stable/profile`. `part` index — call multiple `part=0..N` for the full list.

### Key Metrics TTM Bulk (`/stable/key-metrics-ttm-bulk`)

CSV. Per-row schema includes:
```
symbol, marketCap, enterpriseValueTTM, evToSalesTTM, evToOperatingCashFlowTTM,
evToFreeCashFlowTTM, evToEBITDATTM, netDebtToEBITDATTM, currentRatioTTM,
incomeQualityTTM, grahamNumberTTM, grahamNetNetTTM, taxBurdenTTM,
interestBurdenTTM, workingCapitalTTM, investedCapitalTTM,
returnOnAssetsTTM, operatingReturnOnAssetsTTM, returnOnTangibleAssetsTTM,
returnOnEquityTTM, returnOnInvestedCapitalTTM, returnOnCapitalEmployedTTM,
earningsYieldTTM, freeCashFlowYieldTTM,
capexToOperatingCashFlowTTM, capexToDepreciationTTM, capexToRevenueTTM,
salesGeneralAndAdministrativeToRevenueTTM, researchAndDevelopementToRevenueTTM,
stockBasedCompensationToRevenueTTM, intangiblesToTotalAssetsTTM,
averageReceivablesTTM, averagePayablesTTM, averageInventoryTTM,
daysOfSalesOutstandingTTM, daysOfPayablesOutstandingTTM, daysOfInventoryOutstandingTTM,
operatingCycleTTM, cashConversionCycleTTM,
freeCashFlowToEquityTTM, freeCashFlowToFirmTTM, tangibleAssetValueTTM,
netCurrentAssetValueTTM
```

(Note FMP's typo: `researchAndDevelopement` not `Development`.)

### Ratios TTM Bulk (`/stable/ratios-ttm-bulk`)

CSV. Field names use `*TTM` suffix: `grossProfitMarginTTM`, `ebitMarginTTM`, `ebitdaMarginTTM`, `operatingProfitMarginTTM`, `pretaxProfitMarginTTM`, `continuousOperationsProfitMarginTTM`, `netProfitMarginTTM`, `bottomLineProfitMarginTTM`, `receivablesTurnoverTTM`, `payablesTurnoverTTM`, `inventoryTurnoverTTM`, `fixedAssetTurnoverTTM`, `assetTurnoverTTM`, `currentRatioTTM`, `quickRatioTTM`, `solvencyRatioTTM`, `cashRatioTTM`, `priceToEarningsRatioTTM`, `priceToEarningsGrowthRatioTTM`, `forwardPriceToEarningsGrowthRatioTTM`, `priceToBookRatioTTM`, `priceToSalesRatioTTM`, `priceToFreeCashFlowRatioTTM`, `priceToOperatingCashFlowRatioTTM`, **`debtToEquityRatioTTM`**, `debtToAssetsRatioTTM`, `debtToCapitalRatioTTM`, `longTermDebtToCapitalRatioTTM`, `financialLeverageRatioTTM`, `workingCapitalTurnoverRatioTTM`, `operatingCashFlowRatioTTM`, `operatingCashFlowSalesRatioTTM`, `freeCashFlowOperatingCashFlowRatioTTM`, `debtServiceCoverageRatioTTM`, `interestCoverageRatioTTM`, `shortTermOperatingCashFlowCoverageRatioTTM`, `operatingCashFlowCoverageRatioTTM`, `capitalExpenditureCoverageRatioTTM`, `dividendPaidAndCapexCoverageRatioTTM`, `dividendPayoutRatioTTM`, `dividendYieldTTM`, `enterpriseValueTTM`, `revenuePerShareTTM`, `netIncomePerShareTTM`, `interestDebtPerShareTTM`, `cashPerShareTTM`, `bookValuePerShareTTM`, `tangibleBookValuePerShareTTM`, `shareholdersEquityPerShareTTM`, `operatingCashFlowPerShareTTM`, `capexPerShareTTM`, `freeCashFlowPerShareTTM`, `netIncomePerEBTTTM`, `ebtPerEbitTTM`, `priceToFairValueTTM`, `debtToMarketCapTTM`, `effectiveTaxRateTTM`, `enterpriseValueMultipleTTM`, `dividendPerShareTTM`.

### Income Statement Bulk (`/stable/income-statement-bulk?year=YYYY&period=Q1|FY`)

CSV. Per-row:
```
date, symbol, reportedCurrency, cik, filingDate, acceptedDate, fiscalYear, period,
revenue, costOfRevenue, grossProfit,
researchAndDevelopmentExpenses, generalAndAdministrativeExpenses,
sellingAndMarketingExpenses, sellingGeneralAndAdministrativeExpenses,
otherExpenses, operatingExpenses, costAndExpenses,
netInterestIncome, interestIncome, interestExpense,
depreciationAndAmortization, ebitda, ebit,
nonOperatingIncomeExcludingInterest, operatingIncome,
totalOtherIncomeExpensesNet, incomeBeforeTax, incomeTaxExpense,
netIncomeFromContinuingOperations, netIncomeFromDiscontinuedOperations,
otherAdjustmentsToNetIncome, netIncome, netIncomeDeductions, bottomLineNetIncome,
eps, epsDiluted, weightedAverageShsOut, weightedAverageShsOutDil
```

### Balance Sheet Statement Bulk (`/stable/balance-sheet-statement-bulk`)

CSV. Per-row contains all standard balance-sheet line items plus `commonStock`, `retainedEarnings`, `additionalPaidInCapital`, `accumulatedOtherComprehensiveIncomeLoss`, `totalStockholdersEquity`, `totalEquity`, `minorityInterest`, `totalLiabilitiesAndTotalEquity`, `totalInvestments`, `totalDebt`, `netDebt`. (NO `sharesOutstanding` here either — it's only on `/income-statement` as `weightedAverageShsOut`.)

### Cash Flow Statement Bulk (`/stable/cash-flow-statement-bulk`)

CSV. Standard cash flow fields including `operatingCashFlow`, `capitalExpenditure`, `freeCashFlow`, `netDividendsPaid`, `commonDividendsPaid`, `commonStockRepurchased`, `commonStockIssuance`.

### EOD Bulk (`/stable/eod-bulk?date=YYYY-MM-DD`)

CSV per-row: `symbol, date, open, low, high, close, adjClose, volume`.

### Financial Scores Bulk (`/stable/scores-bulk`)

CSV per-row: `symbol, reportedCurrency, altmanZScore, piotroskiScore, workingCapital, totalAssets, retainedEarnings, ebit, marketCap, totalLiabilities, revenue`.

### ETF Holder Bulk (`/stable/etf-holder-bulk?part=N`)

CSV per-row: `symbol, name, sharesNumber, asset, weightPercentage, cusip, isin, marketValue, lastUpdated`.

### Stock Rating Bulk (`/stable/rating-bulk`)

CSV per-row: `symbol, date, rating, discountedCashFlowScore, returnOnEquityScore, returnOnAssetsScore, debtToEquityScore, priceToEarningsScore, priceToBookScore`.

### Upgrades/Downgrades Consensus Bulk (`/stable/upgrades-downgrades-consensus-bulk`)

CSV per-row: `symbol, strongBuy, buy, hold, sell, strongSell, consensus`.

### Earnings Surprises Bulk (`/stable/earnings-surprises-bulk?year=YYYY`)

CSV per-row: `symbol, date, epsActual, epsEstimated, lastUpdated`.

### Stock Peers Bulk (`/stable/peers-bulk`)

CSV per-row: `symbol, peers`.

### DCF Bulk (`/stable/dcf-bulk`)

CSV per-row: `symbol, date, dcf, "Stock Price"`.

### Price Target Summary Bulk (`/stable/price-target-summary-bulk`)

CSV per-row: `symbol, lastMonthCount, lastMonthAvgPriceTarget, lastQuarterCount, lastQuarterAvgPriceTarget, lastYearCount, lastYearAvgPriceTarget, allTimeCount, allTimeAvgPriceTarget, publishers`.

---

## Endpoint paths (URL-only catalog from raw docs)

### Company Search
- `/stable/search-symbol?query=AAPL`
- `/stable/search-name?query=AA`
- `/stable/search-cik?cik=320193`
- `/stable/search-cusip?cusip=037833100`
- `/stable/search-isin?isin=US0378331005`
- `/stable/company-screener` (with filter params)
- `/stable/search-exchange-variants?symbol=AAPL`

### Stock Directory
- `/stable/stock-list`
- `/stable/financial-statement-symbol-list`
- `/stable/cik-list?page=0&limit=1000`
- `/stable/symbol-change`
- `/stable/etf-list`
- `/stable/actively-trading-list`
- `/stable/earnings-transcript-list`
- `/stable/available-exchanges`
- `/stable/available-sectors`
- `/stable/available-industries`
- `/stable/available-countries`

### Company Information
- `/stable/profile?symbol=AAPL`
- `/stable/profile-cik?cik=320193`
- `/stable/company-notes?symbol=AAPL`
- `/stable/stock-peers?symbol=AAPL`
- `/stable/delisted-companies?page=0&limit=100`
- `/stable/employee-count?symbol=AAPL`
- `/stable/historical-employee-count?symbol=AAPL`
- `/stable/market-capitalization?symbol=AAPL`
- `/stable/market-capitalization-batch?symbols=AAPL,MSFT,GOOG`
- `/stable/historical-market-capitalization?symbol=AAPL`
- **`/stable/shares-float?symbol=AAPL`** — total publicly traded shares + share count
- `/stable/shares-float-all?page=0&limit=1000`
- `/stable/mergers-acquisitions-latest?page=0&limit=100`
- `/stable/mergers-acquisitions-search?name=Apple`
- `/stable/key-executives?symbol=AAPL`
- `/stable/governance-executive-compensation?symbol=AAPL`
- `/stable/executive-compensation-benchmark`

### Quotes
- `/stable/quote?symbol=AAPL`
- `/stable/quote-short?symbol=AAPL`
- `/stable/aftermarket-trade?symbol=AAPL`
- `/stable/aftermarket-quote?symbol=AAPL`
- `/stable/stock-price-change?symbol=AAPL`
- `/stable/batch-quote?symbols=AAPL,MSFT`
- `/stable/batch-quote-short?symbols=AAPL,MSFT`
- `/stable/batch-aftermarket-trade?symbols=AAPL`
- `/stable/batch-aftermarket-quote?symbols=AAPL`
- `/stable/batch-exchange-quote?exchange=NASDAQ`
- `/stable/batch-mutualfund-quotes`
- `/stable/batch-etf-quotes`
- `/stable/batch-commodity-quotes`
- `/stable/batch-crypto-quotes`
- `/stable/batch-forex-quotes`
- `/stable/batch-index-quotes`

### Statements
- `/stable/income-statement?symbol=AAPL` (params: `period`, `limit`)
- `/stable/balance-sheet-statement?symbol=AAPL`
- `/stable/cash-flow-statement?symbol=AAPL`
- `/stable/latest-financial-statements?page=0&limit=250`
- `/stable/income-statement-ttm?symbol=AAPL`
- `/stable/balance-sheet-statement-ttm?symbol=AAPL`
- `/stable/cash-flow-statement-ttm?symbol=AAPL`
- `/stable/key-metrics?symbol=AAPL`
- `/stable/ratios?symbol=AAPL`
- `/stable/key-metrics-ttm?symbol=AAPL`
- `/stable/ratios-ttm?symbol=AAPL`
- `/stable/financial-scores?symbol=AAPL`
- `/stable/owner-earnings?symbol=AAPL`
- `/stable/enterprise-values?symbol=AAPL`
- `/stable/income-statement-growth?symbol=AAPL`
- `/stable/balance-sheet-statement-growth?symbol=AAPL`
- `/stable/cash-flow-statement-growth?symbol=AAPL`
- `/stable/financial-growth?symbol=AAPL`
- `/stable/financial-reports-dates?symbol=AAPL`
- `/stable/financial-reports-json?symbol=AAPL&year=2022&period=FY`
- `/stable/financial-reports-xlsx?symbol=AAPL&year=2022&period=FY`
- `/stable/revenue-product-segmentation?symbol=AAPL`
- `/stable/revenue-geographic-segmentation?symbol=AAPL`
- `/stable/income-statement-as-reported?symbol=AAPL`
- `/stable/balance-sheet-statement-as-reported?symbol=AAPL`
- `/stable/cash-flow-statement-as-reported?symbol=AAPL`
- `/stable/financial-statement-full-as-reported?symbol=AAPL`

### Charts
- `/stable/historical-price-eod/light?symbol=AAPL`
- `/stable/historical-price-eod/full?symbol=AAPL`
- `/stable/historical-price-eod/non-split-adjusted?symbol=AAPL`
- `/stable/historical-price-eod/dividend-adjusted?symbol=AAPL`
- `/stable/historical-chart/{1min|5min|15min|30min|1hour|4hour}?symbol=AAPL`

### Economics
- `/stable/treasury-rates`
- `/stable/economic-indicators?name=GDP`
- `/stable/economic-calendar`
- `/stable/market-risk-premium`

### Earnings, Dividends, Splits
- `/stable/dividends?symbol=AAPL`
- `/stable/dividends-calendar`
- `/stable/earnings?symbol=AAPL`
- `/stable/earnings-calendar`
- `/stable/ipos-calendar`
- `/stable/ipos-disclosure`
- `/stable/ipos-prospectus`
- `/stable/splits?symbol=AAPL`
- `/stable/splits-calendar`

### Earnings Transcripts
- `/stable/earning-call-transcript-latest`
- `/stable/earning-call-transcript?symbol=AAPL&year=2020&quarter=3`
- `/stable/earning-call-transcript-dates?symbol=AAPL`
- `/stable/earnings-transcript-list`

### News
- `/stable/fmp-articles?page=0&limit=20`
- `/stable/news/general-latest?page=0&limit=20`
- `/stable/news/press-releases-latest?page=0&limit=20`
- `/stable/news/stock-latest?page=0&limit=20`
- `/stable/news/crypto-latest?page=0&limit=20`
- `/stable/news/forex-latest?page=0&limit=20`
- `/stable/news/press-releases?symbols=AAPL`
- `/stable/news/stock?symbols=AAPL`
- `/stable/news/crypto?symbols=BTCUSD`
- `/stable/news/forex?symbols=EURUSD`

### Form 13F (Institutional Ownership)
- `/stable/institutional-ownership/latest?page=0&limit=100`
- `/stable/institutional-ownership/extract?cik=0001388838&year=2023&quarter=3`
- `/stable/institutional-ownership/dates?cik=0001067983`
- **`/stable/institutional-ownership/extract-analytics/holder?symbol=AAPL&year=2023&quarter=3&page=0&limit=10`**
- `/stable/institutional-ownership/holder-performance-summary?cik=0001067983&page=0`
- `/stable/institutional-ownership/holder-industry-breakdown?cik=0001067983&year=2023&quarter=3`
- **`/stable/institutional-ownership/symbol-positions-summary?symbol=AAPL&year=2023&quarter=3`**
- `/stable/institutional-ownership/industry-summary?year=2023&quarter=3`

### Analyst
- `/stable/analyst-estimates?symbol=AAPL&period=annual&page=0&limit=10`
- `/stable/ratings-snapshot?symbol=AAPL`
- `/stable/ratings-historical?symbol=AAPL`
- `/stable/price-target-summary?symbol=AAPL`
- `/stable/price-target-consensus?symbol=AAPL`
- `/stable/grades?symbol=AAPL`
- `/stable/grades-historical?symbol=AAPL`
- `/stable/grades-consensus?symbol=AAPL`

### Market Performance
- `/stable/sector-performance-snapshot?date=YYYY-MM-DD`
- `/stable/industry-performance-snapshot?date=YYYY-MM-DD`
- `/stable/historical-sector-performance?sector=Energy`
- `/stable/historical-industry-performance?industry=Biotechnology`
- `/stable/sector-pe-snapshot?date=YYYY-MM-DD`
- `/stable/industry-pe-snapshot?date=YYYY-MM-DD`
- `/stable/historical-sector-pe?sector=Energy`
- `/stable/historical-industry-pe?industry=Biotechnology`
- `/stable/biggest-gainers`
- `/stable/biggest-losers`
- `/stable/most-actives`

### Technical Indicators
- `/stable/technical-indicators/{sma|ema|wma|dema|tema|rsi|standarddeviation|williams|adx}?symbol=AAPL&periodLength=10&timeframe=1day`

### ETF & Mutual Funds
- `/stable/etf/holdings?symbol=SPY`
- `/stable/etf/info?symbol=SPY`
- `/stable/etf/country-weightings?symbol=SPY`
- `/stable/etf/asset-exposure?symbol=AAPL`
- `/stable/etf/sector-weightings?symbol=SPY`
- `/stable/funds/disclosure-holders-latest?symbol=AAPL`
- `/stable/funds/disclosure?symbol=VWO&year=2023&quarter=4`
- `/stable/funds/disclosure-holders-search?name=...`
- `/stable/funds/disclosure-dates?symbol=VWO`

### SEC Filings
- `/stable/sec-filings-8k?from=YYYY-MM-DD&to=YYYY-MM-DD&page=0&limit=100`
- `/stable/sec-filings-financials?from=YYYY-MM-DD&to=YYYY-MM-DD&page=0&limit=100`
- `/stable/sec-filings-search/form-type?formType=8-K&from=...&to=...`
- `/stable/sec-filings-search/symbol?symbol=AAPL&from=...&to=...`
- `/stable/sec-filings-search/cik?cik=0000320193&from=...&to=...`
- `/stable/sec-filings-company-search/name?company=Berkshire`
- `/stable/sec-filings-company-search/symbol?symbol=AAPL`
- `/stable/sec-filings-company-search/cik?cik=0000320193`
- `/stable/sec-profile?symbol=AAPL`
- `/stable/standard-industrial-classification-list`
- `/stable/industry-classification-search`
- `/stable/all-industry-classification`

### Insider Trades
- `/stable/insider-trading/latest?page=0&limit=100`
- **`/stable/insider-trading/search?page=0&limit=100`** (also takes `symbol`)
- `/stable/insider-trading/reporting-name?name=Zuckerberg`
- `/stable/insider-trading-transaction-type`
- `/stable/insider-trading/statistics?symbol=AAPL`
- `/stable/acquisition-of-beneficial-ownership?symbol=AAPL`

### Indexes
- `/stable/index-list`
- `/stable/quote?symbol=^VIX`
- `/stable/quote-short?symbol=^VIX`
- `/stable/batch-index-quotes`
- `/stable/historical-price-eod/light?symbol=^VIX`
- `/stable/historical-price-eod/full?symbol=^VIX`
- `/stable/historical-chart/{interval}?symbol=^VIX`
- `/stable/sp500-constituent`, `/stable/nasdaq-constituent`, `/stable/dowjones-constituent`
- `/stable/historical-sp500-constituent`, `/stable/historical-nasdaq-constituent`, `/stable/historical-dowjones-constituent`

### Market Hours
- `/stable/exchange-market-hours?exchange=NASDAQ`
- `/stable/holidays-by-exchange?exchange=NASDAQ`
- `/stable/all-exchange-market-hours`

### Commodities, Forex, Crypto
- `/stable/commodities-list`, `/stable/cryptocurrency-list`, `/stable/forex-list`
- `/stable/quote?symbol=GCUSD`, `/stable/quote?symbol=EURUSD`, `/stable/quote?symbol=BTCUSD` (cross-asset)
- `/stable/historical-price-eod/full?symbol=GCUSD` (works for commodities/forex/crypto symbols)
- `/stable/historical-chart/{interval}?symbol=...`

### DCF
- `/stable/discounted-cash-flow?symbol=AAPL`
- `/stable/levered-discounted-cash-flow?symbol=AAPL`
- `/stable/custom-discounted-cash-flow?symbol=AAPL`
- `/stable/custom-levered-discounted-cash-flow?symbol=AAPL`

### Senate / House Trading
- `/stable/senate-latest?page=0&limit=100`
- `/stable/house-latest?page=0&limit=100`
- `/stable/senate-trades?symbol=AAPL`
- `/stable/senate-trades-by-name?name=Jerry`
- `/stable/house-trades?symbol=AAPL`
- `/stable/house-trades-by-name?name=James`

### ESG
- `/stable/esg-disclosures?symbol=AAPL`
- `/stable/esg-ratings?symbol=AAPL`
- `/stable/esg-benchmark`

### Commitment of Traders
- `/stable/commitment-of-traders-report`
- `/stable/commitment-of-traders-analysis`
- `/stable/commitment-of-traders-list`

### Fundraisers (Crowdfunding / Equity Offerings)
- `/stable/crowdfunding-offerings-latest?page=0&limit=100`
- `/stable/crowdfunding-offerings-search?name=...`
- `/stable/crowdfunding-offerings?cik=...`
- `/stable/fundraising-latest?page=0&limit=10`
- `/stable/fundraising-search?name=...`
- `/stable/fundraising?cik=...`

### Bulk
- `/stable/profile-bulk?part=0`
- `/stable/rating-bulk`
- `/stable/dcf-bulk`
- `/stable/scores-bulk`
- `/stable/price-target-summary-bulk`
- `/stable/etf-holder-bulk?part=N`
- `/stable/upgrades-downgrades-consensus-bulk`
- `/stable/key-metrics-ttm-bulk`
- `/stable/ratios-ttm-bulk`
- `/stable/peers-bulk`
- `/stable/earnings-surprises-bulk?year=YYYY`
- `/stable/income-statement-bulk?year=YYYY&period=Q1|FY`
- `/stable/income-statement-growth-bulk?year=YYYY&period=...`
- `/stable/balance-sheet-statement-bulk?year=YYYY&period=...`
- `/stable/balance-sheet-statement-growth-bulk?year=YYYY&period=...`
- `/stable/cash-flow-statement-bulk?year=YYYY&period=...`
- `/stable/cash-flow-statement-growth-bulk?year=YYYY&period=...`
- `/stable/eod-bulk?date=YYYY-MM-DD`
