# Feature Changes: Dividend Finder & Position Duration Analysis

## Files Modified

### server/routes.ts
- Added `extractDividendData()` helper function (lines ~850-912) to extract and score dividend data from Yahoo Finance quoteSummary
- Added `GET /api/dividends/scan` route (line ~914) — scans multiple tickers with 400ms delays, returns sorted by score
- Added `GET /api/dividends/:ticker` route (line ~945) — single ticker dividend lookup
- Both routes call `await ensureReady()` and are placed BEFORE parameterized routes
- Modified `GET /api/trades/analytics` route to include `durationAnalysis` in response
  - Added `daysBetween` helper, trade duration categorization (day/short/swing/long)
  - Added `analyzeGroup` helper for win rate, P/L, avg days per category

### client/src/pages/dividends.tsx (NEW)
- Full dividend finder page with single ticker hero card and multi-ticker scanner
- Uses `useTicker()` context for active ticker integration
- HelpBlock explaining dividend concepts
- Color-coded table with score, yield, payout ratio
- Click any row to set active ticker

### client/src/pages/trade-analytics.tsx
- Added `DurationGroup` interface and `durationAnalysis` to `AnalyticsData` type
- Added `Clock` icon import
- Added Position Duration Analysis section BEFORE MFE/MAE section
  - 4 category cards (Day/Short/Swing/Long) with color-coded borders
  - Grouped BarChart comparing win rate and avg P/L across durations
  - HelpBlock explaining each duration category

### client/src/App.tsx
- Imported `Dividends` page
- Added `<Route path="/dividends" component={Dividends} />`

### client/src/components/AppLayout.tsx
- Imported `DollarSign` from lucide-react
- Added `{ path: "/dividends", label: "Dividend Finder", icon: DollarSign }` to Research nav group
