import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  DollarSign, TrendingUp, Calendar, Percent, Award,
  Activity, AlertTriangle, Search, Loader2, Clock,
  CalendarDays, PiggyBank, Zap,
} from "lucide-react";
import { HelpBlock, Example, ScoreRange } from "@/components/HelpBlock";
import { useTicker } from "@/contexts/TickerContext";
import { apiRequest, queryClient } from "@/lib/queryClient";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DividendData {
  ticker: string;
  companyName: string;
  price: number;
  dividendYield: number;
  dividendRate: number;
  exDividendDate: string | null;
  distributionDate: string | null;
  payoutRatio: number;
  trailingYield: number;
  fiveYearAvgYield: number | null;
  lastDividendValue: number | null;
  lastDividendDate: string | null;
  frequency: string;
  annualDividend: number;
  dividendGrowth: number | null;
  score: number;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Dividends() {
  const { activeTicker, setActiveTicker } = useTicker();
  const [customTickers, setCustomTickers] = useState("");

  // Filter state
  const [minYield, setMinYield] = useState<string>("");
  const [frequency, setFrequency] = useState("All");
  const [maxPayout, setMaxPayout] = useState<string>("");

  // Fetch single ticker dividend data when active ticker is set
  const { data: tickerDividend, isLoading: isTickerLoading } = useQuery<DividendData>({
    queryKey: ["/api/dividends", activeTicker],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/dividends/${activeTicker}`);
      return res.json();
    },
    enabled: !!activeTicker,
  });

  // Scan results — persisted in state so they survive page navigation
  // We use queryClient.fetchQuery to do the actual fetch, then store in local state
  const [scanResults, setScanResults] = useState<DividendData[] | null>(() => {
    // Restore from query cache on mount if available
    return queryClient.getQueryData<DividendData[]>(["/api/dividends/scan"]) || null;
  });
  const [isScanLoading, setIsScanLoading] = useState(false);

  const doScan = async (tickers?: string) => {
    setIsScanLoading(true);
    try {
      let url = tickers
        ? `/api/dividends/scan?tickers=${tickers}`
        : "/api/dividends/scan";
      const parts: string[] = [];
      if (minYield && parseFloat(minYield) > 0) parts.push(`minYield=${minYield}`);
      if (frequency !== "All") parts.push(`frequency=${encodeURIComponent(frequency)}`);
      if (maxPayout && parseFloat(maxPayout) < 100) parts.push(`maxPayout=${maxPayout}`);
      if (parts.length > 0) url += url.includes("?") ? `&${parts.join("&")}` : `?${parts.join("&")}`;

      const res = await apiRequest("GET", url);
      const data = await res.json();
      setScanResults(data);
      // Also store in query cache so it persists across navigations
      queryClient.setQueryData(["/api/dividends/scan"], data);
    } catch (err: any) {
      console.error("Scan failed:", err);
    } finally {
      setIsScanLoading(false);
    }
  };

  const handleScanDefault = () => doScan();

  const handleScanCustom = () => {
    const cleaned = customTickers
      .split(",")
      .map(t => t.trim().toUpperCase())
      .filter(Boolean)
      .join(",");
    if (cleaned) doScan(cleaned);
  };

  const yieldColor = (y: number) =>
    y > 3 ? "text-green-400" : y >= 1 ? "text-yellow-400" : "text-red-400";

  const scoreColor = (s: number) =>
    s >= 60 ? "text-green-400" : s >= 35 ? "text-yellow-400" : "text-red-400";

  const scoreBgColor = (s: number) =>
    s >= 60 ? "border-green-500/40" : s >= 35 ? "border-yellow-500/40" : "border-red-500/40";

  const payoutColor = (p: number) =>
    p >= 20 && p <= 60 ? "text-green-400" : p > 60 && p <= 80 ? "text-yellow-400" : "text-red-400";

  // Calculate days until ex-div
  const daysUntilExDiv = useMemo(() => {
    if (!tickerDividend?.exDividendDate) return null;
    const exDate = new Date(tickerDividend.exDividendDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    exDate.setHours(0, 0, 0, 0);
    const diff = Math.ceil((exDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return diff;
  }, [tickerDividend?.exDividendDate]);

  return (
    <div className="p-3 sm:p-4 md:p-6 space-y-6 max-w-[1200px] mx-auto" data-testid="dividends-page">
      <h1 className="text-lg font-bold text-foreground">Dividend Finder</h1>
      <p className="text-xs text-muted-foreground -mt-4">
        Discover, compare, and rank dividend-paying stocks by yield, sustainability, and quality.
      </p>

      {/* Help Block */}
      <HelpBlock title="Understanding Dividends">
        <p><strong className="text-foreground">Dividend Yield:</strong> Annual dividend payment divided by the stock price. A 3% yield on a $100 stock means $3/year in dividends per share.</p>
        <p><strong className="text-foreground">Payout Ratio:</strong> What percentage of earnings the company pays out as dividends. Under 60% is generally sustainable — the company retains enough to reinvest and grow.</p>
        <p><strong className="text-foreground">Distribution Date:</strong> The date the dividend payment is deposited into your brokerage account. This is when you actually get paid.</p>
        <p><strong className="text-foreground">Ex-Dividend Date:</strong> The cutoff date — you must own shares BEFORE this date to receive the dividend. If you buy on or after this date, you won't get the next payment.</p>
        <p><strong className="text-foreground">Settlement:</strong> Typically T+1 (one business day) after purchase for the trade to settle. Plan your purchases accordingly relative to the ex-dividend date.</p>
        <p><strong className="text-foreground">Distribution Frequency:</strong> How often dividends are paid — Monthly, Quarterly, Semi-Annual, or Annual. Most US stocks pay quarterly.</p>
        <p><strong className="text-foreground">Dividend Quality Score (0-100):</strong> A composite ranking based on yield level, payout sustainability, yield growth vs 5-year average, payment consistency, and frequency.</p>
        <Example type="good">
          <strong className="text-green-400">O (Realty Income)</strong> pays monthly dividends and is known as "The Monthly Dividend Company." Great for income-focused investors.
        </Example>
        <Example type="good">
          <strong className="text-green-400">KO (Coca-Cola)</strong> has over 60 years of consecutive dividend growth — a "Dividend King." Yield + growth + consistency.
        </Example>
        <ScoreRange label="Strong" range="60-100" color="green" description="High yield, sustainable payout, consistent growth — top dividend pick" />
        <ScoreRange label="Moderate" range="35-59" color="yellow" description="Decent yield or payout — may lack growth or consistency" />
        <ScoreRange label="Weak" range="0-34" color="red" description="Low or no yield, high payout risk, or inconsistent payments" />
      </HelpBlock>

      {/* Active Ticker Hero Card */}
      {activeTicker && (
        <div className="bg-card border border-card-border rounded-lg p-4" data-testid="dividend-hero-card">
          <div className="flex items-center gap-2 mb-3">
            <DollarSign className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-bold text-foreground">
              {activeTicker} Dividend Details
            </h3>
          </div>

          {isTickerLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Fetching dividend data for {activeTicker}...</span>
              </div>
            </div>
          ) : tickerDividend ? (
            <div className="space-y-3">
              {/* Top row: name, price, score ring */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-foreground">{tickerDividend.companyName}</p>
                  <p className="text-xs text-muted-foreground font-mono">{tickerDividend.ticker} · ${tickerDividend.price.toFixed(2)}</p>
                </div>
                {/* Score Ring */}
                <div className={`flex items-center justify-center w-14 h-14 rounded-full border-2 ${scoreBgColor(tickerDividend.score)}`} data-testid="dividend-score-ring">
                  <div className="text-center">
                    <span className={`text-lg font-bold tabular-nums ${scoreColor(tickerDividend.score)}`}>{tickerDividend.score}</span>
                    <span className="block text-[8px] text-muted-foreground">/ 100</span>
                  </div>
                </div>
              </div>

              {/* Metrics Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-4 gap-3">
                <MiniCard
                  label="Yield"
                  value={`${tickerDividend.dividendYield.toFixed(2)}%`}
                  color={yieldColor(tickerDividend.dividendYield)}
                  icon={<Percent className="h-3 w-3" />}
                />
                <MiniCard
                  label="Div Rate"
                  value={`$${tickerDividend.dividendRate.toFixed(2)}`}
                  color="text-foreground"
                  icon={<DollarSign className="h-3 w-3" />}
                />
                <MiniCard
                  label="Payout Ratio"
                  value={`${tickerDividend.payoutRatio.toFixed(1)}%`}
                  color={payoutColor(tickerDividend.payoutRatio)}
                  icon={<Activity className="h-3 w-3" />}
                  subtitle={tickerDividend.payoutRatio >= 20 && tickerDividend.payoutRatio <= 60 ? "Sustainable" : tickerDividend.payoutRatio > 80 ? "High risk" : ""}
                />
                <MiniCard
                  label="Frequency"
                  value={tickerDividend.frequency}
                  color="text-primary"
                  icon={<Calendar className="h-3 w-3" />}
                />
              </div>

              {/* Date-specific row */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <MiniCard
                  label="Distribution Date"
                  value={tickerDividend.distributionDate || "N/A"}
                  color="text-foreground"
                  icon={<Calendar className="h-3 w-3" />}
                  subtitle="When you get paid"
                  data-testid="dividend-distribution-date"
                />
                <MiniCard
                  label="Ex-Dividend Date"
                  value={tickerDividend.exDividendDate || "N/A"}
                  color={daysUntilExDiv !== null && daysUntilExDiv >= 0 && daysUntilExDiv <= 7 ? "text-yellow-400" : "text-foreground"}
                  icon={<AlertTriangle className="h-3 w-3" />}
                  subtitle={daysUntilExDiv !== null ? (daysUntilExDiv > 0 ? `${daysUntilExDiv} day${daysUntilExDiv !== 1 ? "s" : ""} away` : daysUntilExDiv === 0 ? "Today!" : "Passed") : "Must own before this date"}
                  data-testid="dividend-ex-div-date"
                />
                <MiniCard
                  label="5Y Avg Yield"
                  value={tickerDividend.fiveYearAvgYield != null ? `${tickerDividend.fiveYearAvgYield.toFixed(2)}%` : "N/A"}
                  color={tickerDividend.fiveYearAvgYield != null && tickerDividend.dividendYield > tickerDividend.fiveYearAvgYield ? "text-green-400" : "text-muted-foreground"}
                  icon={<TrendingUp className="h-3 w-3" />}
                  subtitle={tickerDividend.fiveYearAvgYield != null && tickerDividend.dividendYield > tickerDividend.fiveYearAvgYield ? "Above avg" : ""}
                />
                <MiniCard
                  label="Last Dividend"
                  value={tickerDividend.lastDividendValue != null ? `$${tickerDividend.lastDividendValue.toFixed(4)}` : "N/A"}
                  color="text-foreground"
                  icon={<DollarSign className="h-3 w-3" />}
                  subtitle={tickerDividend.lastDividendDate || ""}
                />
              </div>

              {tickerDividend.dividendRate === 0 && (
                <div className="flex items-center gap-2 p-2 bg-red-500/10 border border-red-500/30 rounded-lg">
                  <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
                  <span className="text-xs text-red-400">{tickerDividend.ticker} does not currently pay a dividend.</span>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 p-2 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
              <AlertTriangle className="h-3.5 w-3.5 text-yellow-400" />
              <span className="text-xs text-yellow-400">No dividend data available for {activeTicker}.</span>
            </div>
          )}
        </div>
      )}

      {/* Dividend Scanner */}
      <div className="bg-card border border-card-border rounded-lg p-4" data-testid="dividend-scanner">
        <div className="flex items-center gap-2 mb-3">
          <Search className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold text-foreground">Dividend Scanner</h3>
        </div>

        {/* Filter Controls */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3" data-testid="dividend-filters">
          <div>
            <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Min Yield (%)</label>
            <input
              type="number"
              step={0.5}
              min={0}
              value={minYield}
              onChange={e => setMinYield(e.target.value)}
              placeholder="Min %"
              className="w-full h-8 px-2 text-xs bg-background border border-card-border rounded-md text-foreground tabular-nums placeholder:text-muted-foreground"
              data-testid="filter-min-yield"
            />
          </div>
          <div>
            <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Frequency</label>
            <select
              value={frequency}
              onChange={e => setFrequency(e.target.value)}
              className="w-full h-8 px-2 text-xs bg-background border border-card-border rounded-md text-foreground"
              data-testid="filter-frequency"
            >
              <option value="All">All</option>
              <option value="Monthly">Monthly</option>
              <option value="Quarterly">Quarterly</option>
              <option value="Semi-Annual">Semi-Annual</option>
              <option value="Annual">Annual</option>
            </select>
          </div>
          <div>
            <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Max Payout (%)</label>
            <input
              type="number"
              step={5}
              min={0}
              max={100}
              value={maxPayout}
              onChange={e => setMaxPayout(e.target.value)}
              placeholder="Max %"
              className="w-full h-8 px-2 text-xs bg-background border border-card-border rounded-md text-foreground tabular-nums placeholder:text-muted-foreground"
              data-testid="filter-max-payout"
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={handleScanDefault}
              disabled={isScanLoading}
              className="w-full h-8 px-4 text-xs font-semibold rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
              data-testid="button-scan-default"
            >
              {isScanLoading && !scanTickers ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
              {scanResults ? "New Scan" : "Scan"}
            </button>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="flex items-center gap-2 flex-1">
            <input
              type="text"
              value={customTickers}
              onChange={(e) => setCustomTickers(e.target.value.toUpperCase())}
              placeholder="HD, JNJ, KO, PG..."
              className="flex-1 h-8 px-3 text-xs bg-background border border-card-border rounded-md font-mono tracking-wider focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary/50 text-foreground placeholder:text-muted-foreground"
              data-testid="input-custom-tickers"
            />
            <button
              onClick={handleScanCustom}
              disabled={isScanLoading || !customTickers.trim()}
              className="h-8 px-3 text-xs font-semibold rounded-md bg-primary/20 text-primary hover:bg-primary/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 shrink-0"
              data-testid="button-scan-custom"
            >
              {isScanLoading && scanTickers ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
              Scan Custom
            </button>
          </div>
        </div>

        {isScanLoading && (
          <div className="flex items-center justify-center py-8">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Scanning dividend stocks... This may take a moment.</span>
            </div>
          </div>
        )}

        {scanResults && scanResults.length > 0 && !isScanLoading && (
          <div className="overflow-x-auto" data-testid="dividend-scan-results">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-card-border text-muted-foreground">
                  <th className="text-left py-2 px-2 font-semibold">#</th>
                  <th className="text-left py-2 px-2 font-semibold">Ticker</th>
                  <th className="text-left py-2 px-2 font-semibold hidden sm:table-cell">Company</th>
                  <th className="text-right py-2 px-2 font-semibold">Price</th>
                  <th className="text-right py-2 px-2 font-semibold">Yield</th>
                  <th className="text-right py-2 px-2 font-semibold hidden md:table-cell">Div Rate</th>
                  <th className="text-right py-2 px-2 font-semibold hidden md:table-cell">Payout</th>
                  <th className="text-center py-2 px-2 font-semibold hidden lg:table-cell">Freq</th>
                  <th className="text-center py-2 px-2 font-semibold hidden lg:table-cell">Ex-Div</th>
                  <th className="text-center py-2 px-2 font-semibold hidden lg:table-cell">Dist Date</th>
                  <th className="text-right py-2 px-2 font-semibold hidden lg:table-cell">5Y Avg</th>
                  <th className="text-right py-2 px-2 font-semibold">Score</th>
                </tr>
              </thead>
              <tbody>
                {scanResults.map((stock, index) => (
                  <tr
                    key={stock.ticker}
                    className="border-b border-card-border/30 hover:bg-muted/30 cursor-pointer transition-colors"
                    onClick={() => setActiveTicker(stock.ticker)}
                    data-testid={`dividend-row-${stock.ticker}`}
                  >
                    <td className="py-2 px-2 text-muted-foreground font-mono">{index + 1}</td>
                    <td className="py-2 px-2 font-bold font-mono text-foreground">{stock.ticker}</td>
                    <td className="py-2 px-2 text-muted-foreground truncate max-w-[140px] hidden sm:table-cell">{stock.companyName}</td>
                    <td className="py-2 px-2 text-right font-mono text-foreground">${stock.price.toFixed(2)}</td>
                    <td className={`py-2 px-2 text-right font-mono font-bold ${yieldColor(stock.dividendYield)}`}>
                      {stock.dividendYield.toFixed(2)}%
                    </td>
                    <td className="py-2 px-2 text-right font-mono text-foreground hidden md:table-cell">${stock.dividendRate.toFixed(2)}</td>
                    <td className={`py-2 px-2 text-right font-mono hidden md:table-cell ${payoutColor(stock.payoutRatio)}`}>
                      {stock.payoutRatio.toFixed(1)}%
                    </td>
                    <td className="py-2 px-2 text-center hidden lg:table-cell">
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                        {stock.frequency}
                      </span>
                    </td>
                    <td className="py-2 px-2 text-center font-mono text-muted-foreground hidden lg:table-cell">
                      {stock.exDividendDate || "—"}
                    </td>
                    <td className="py-2 px-2 text-center font-mono text-muted-foreground hidden lg:table-cell">
                      {stock.distributionDate || "—"}
                    </td>
                    <td className="py-2 px-2 text-right font-mono text-muted-foreground hidden lg:table-cell">
                      {stock.fiveYearAvgYield != null ? `${stock.fiveYearAvgYield.toFixed(2)}%` : "—"}
                    </td>
                    <td className={`py-2 px-2 text-right font-mono font-bold ${scoreColor(stock.score)}`}>
                      {stock.score}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {scanResults && scanResults.length === 0 && !isScanLoading && (
          <div className="flex flex-col items-center justify-center py-8 text-center bg-muted/20 border border-card-border/50 rounded-lg">
            <AlertTriangle className="h-6 w-6 text-muted-foreground/40 mb-2" />
            <p className="text-xs text-muted-foreground">No dividend data found for the scanned tickers.</p>
          </div>
        )}

        {!scanResults && !isScanLoading && (
          <div className="flex flex-col items-center justify-center py-8 text-center bg-muted/20 border border-card-border/50 rounded-lg">
            <Award className="h-6 w-6 text-muted-foreground/40 mb-2" />
            <p className="text-xs text-muted-foreground font-medium">Click "Scan" to get started</p>
            <p className="text-[10px] text-muted-foreground mt-1">
              Use filters above to narrow results, or enter custom tickers.
            </p>
          </div>
        )}
      </div>

      {/* Weekly Dividend Strategy (Bowtie Nation) */}
      <WeeklyStrategy setActiveTicker={setActiveTicker} />
    </div>
  );
}

// ─── Weekly Strategy Component ────────────────────────────────────────────

interface WeeklyItem {
  ticker: string;
  week: number;
  months: string;
  role: string;
  note: string;
  companyName: string;
  price: number;
  dividendYield: number;
  dividendRate: number;
  annualDividend: number;
  exDividendDate: string | null;
  distributionDate: string | null;
  frequency: string;
  payoutRatio: number;
  score: number;
}

interface WeeklyData {
  strategy: string;
  description: string;
  weeklyPlan: WeeklyItem[];
  stats: { totalStocks: number; quarterlyPayers: number; monthlyPayers: number; avgYield: number; avgScore: number };
}

function WeeklyStrategy({ setActiveTicker }: { setActiveTicker: (t: string) => void }) {
  const [showStrategy, setShowStrategy] = useState(false);

  const { data, isLoading } = useQuery<WeeklyData>({
    queryKey: ["/api/dividends/weekly-strategy"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/dividends/weekly-strategy");
      return res.json();
    },
    enabled: showStrategy,
  });

  const yieldColor = (y: number) =>
    y > 3 ? "text-green-400" : y >= 1 ? "text-yellow-400" : "text-red-400";
  const scoreColor = (s: number) =>
    s >= 60 ? "text-green-400" : s >= 35 ? "text-yellow-400" : "text-red-400";

  const quarterlyStocks = data?.weeklyPlan.filter(s => s.months !== "Monthly") || [];
  const monthlyStocks = data?.weeklyPlan.filter(s => s.months === "Monthly") || [];

  // Group quarterly by month schedule
  const q1 = quarterlyStocks.filter(s => s.months.startsWith("Jan"));
  const q2 = quarterlyStocks.filter(s => s.months.startsWith("Feb"));
  const q3 = quarterlyStocks.filter(s => s.months.startsWith("Mar"));

  return (
    <div className="bg-card border border-card-border rounded-lg p-4" data-testid="weekly-strategy">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold text-foreground">Weekly Dividend Strategy</h3>
          <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-primary/10 text-primary">Bowtie Nation</span>
        </div>
        <button
          onClick={() => setShowStrategy(!showStrategy)}
          className="h-7 px-3 text-xs font-semibold rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex items-center gap-1.5"
          data-testid="button-load-weekly"
        >
          {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
          {showStrategy ? "Refresh" : "Load Strategy"}
        </button>
      </div>

      {!showStrategy && (
        <p className="text-xs text-muted-foreground">
          12 quarterly payers staggered across weeks + 4 monthly payers = dividends hitting your account every single week. Click "Load Strategy" to see the full plan with live data.
        </p>
      )}

      {isLoading && (
        <div className="flex items-center justify-center py-6">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Loading 16 stocks with live dividend data...</span>
          </div>
        </div>
      )}

      {data && !isLoading && (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">{data.description}</p>

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div className="bg-muted/30 border border-card-border/50 rounded-lg p-2">
              <span className="text-[9px] font-semibold text-muted-foreground uppercase block">Stocks</span>
              <span className="text-sm font-bold text-foreground">{data.stats.totalStocks}</span>
              <span className="text-[9px] text-muted-foreground block">{data.stats.quarterlyPayers}Q + {data.stats.monthlyPayers}M</span>
            </div>
            <div className="bg-muted/30 border border-card-border/50 rounded-lg p-2">
              <span className="text-[9px] font-semibold text-muted-foreground uppercase block">Avg Yield</span>
              <span className={`text-sm font-bold ${yieldColor(data.stats.avgYield)}`}>{data.stats.avgYield}%</span>
            </div>
            <div className="bg-muted/30 border border-card-border/50 rounded-lg p-2">
              <span className="text-[9px] font-semibold text-muted-foreground uppercase block">Avg Score</span>
              <span className={`text-sm font-bold ${scoreColor(data.stats.avgScore)}`}>{data.stats.avgScore}</span>
            </div>
            <div className="bg-muted/30 border border-card-border/50 rounded-lg p-2">
              <span className="text-[9px] font-semibold text-muted-foreground uppercase block">Coverage</span>
              <span className="text-sm font-bold text-green-400">52 weeks</span>
              <span className="text-[9px] text-muted-foreground block">Every week paid</span>
            </div>
          </div>

          {/* Monthly Payers */}
          <div>
            <h4 className="text-xs font-bold text-primary mb-2 flex items-center gap-1.5">
              <PiggyBank className="h-3.5 w-3.5" /> Monthly Payers (double up every week)
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {monthlyStocks.map(s => (
                <div key={s.ticker} className="bg-primary/5 border border-primary/20 rounded-lg p-2 cursor-pointer hover:bg-primary/10 transition-colors" onClick={() => setActiveTicker(s.ticker)}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="font-mono font-bold text-xs text-foreground">{s.ticker}</span>
                    <span className={`text-[10px] font-bold ${yieldColor(s.dividendYield)}`}>{s.dividendYield.toFixed(1)}%</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground truncate">{s.companyName}</p>
                  <p className="text-[9px] text-muted-foreground mt-0.5">${s.price.toFixed(2)} · ${s.dividendRate.toFixed(2)}/sh</p>
                </div>
              ))}
            </div>
          </div>

          {/* Quarterly Calendar */}
          {[["Jan / Apr / Jul / Oct", q1, "#22c55e"], ["Feb / May / Aug / Nov", q2, "#6366f1"], ["Mar / Jun / Sep / Dec", q3, "#f97316"]] .map(([label, stocks, color]) => (
            <div key={label as string}>
              <h4 className="text-xs font-bold text-foreground mb-2 flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5" style={{ color: color as string }} /> {label as string}
              </h4>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-card-border text-muted-foreground">
                      <th className="text-left py-1.5 px-2 font-semibold">Week</th>
                      <th className="text-left py-1.5 px-2 font-semibold">Ticker</th>
                      <th className="text-left py-1.5 px-2 font-semibold hidden sm:table-cell">Company</th>
                      <th className="text-right py-1.5 px-2 font-semibold">Price</th>
                      <th className="text-right py-1.5 px-2 font-semibold">Yield</th>
                      <th className="text-right py-1.5 px-2 font-semibold hidden md:table-cell">Div Rate</th>
                      <th className="text-center py-1.5 px-2 font-semibold hidden md:table-cell">Ex-Div</th>
                      <th className="text-right py-1.5 px-2 font-semibold hidden lg:table-cell">Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(stocks as WeeklyItem[]).sort((a, b) => a.week - b.week).map(s => (
                      <tr key={s.ticker} className="border-b border-card-border/30 hover:bg-muted/30 cursor-pointer transition-colors" onClick={() => setActiveTicker(s.ticker)}>
                        <td className="py-1.5 px-2">
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ backgroundColor: `${color as string}15`, color: color as string }}>Wk {s.week}</span>
                        </td>
                        <td className="py-1.5 px-2 font-mono font-bold text-foreground">{s.ticker}</td>
                        <td className="py-1.5 px-2 text-muted-foreground truncate max-w-[120px] hidden sm:table-cell">{s.companyName}</td>
                        <td className="py-1.5 px-2 text-right font-mono text-foreground">${s.price.toFixed(2)}</td>
                        <td className={`py-1.5 px-2 text-right font-mono font-bold ${yieldColor(s.dividendYield)}`}>{s.dividendYield.toFixed(2)}%</td>
                        <td className="py-1.5 px-2 text-right font-mono text-foreground hidden md:table-cell">${s.dividendRate.toFixed(2)}</td>
                        <td className="py-1.5 px-2 text-center font-mono text-muted-foreground hidden md:table-cell">{s.exDividendDate || "—"}</td>
                        <td className={`py-1.5 px-2 text-right font-mono font-bold hidden lg:table-cell ${scoreColor(s.score)}`}>{s.score}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          <p className="text-[10px] text-muted-foreground italic px-1">
            Strategy note: Buy equal dollar amounts of each. The 4 monthly payers ensure you get double payments every week. Quarterly payers fill the weeks between monthly payouts. Reinvest dividends (DRIP) to compound over time.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Shared ───────────────────────────────────────────────────────────────────

function MiniCard({ label, value, color, icon, subtitle, ...rest }: {
  label: string; value: string; color: string; icon?: React.ReactNode; subtitle?: string;
  [key: string]: any;
}) {
  return (
    <div className="bg-muted/30 border border-card-border/50 rounded-lg p-2.5" {...rest}>
      <div className="flex items-center gap-1 mb-0.5">
        {icon && <span className={`${color} opacity-70`}>{icon}</span>}
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>
      <span className={`text-sm font-bold tabular-nums font-mono ${color}`}>{value}</span>
      {subtitle && <span className="block text-[10px] text-muted-foreground">{subtitle}</span>}
    </div>
  );
}
