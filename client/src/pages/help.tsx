import { useState } from "react";
import { BookOpen, ChevronDown, ChevronUp, ClipboardList, Calculator, BarChart3, Activity, Radar, HelpCircle, RefreshCw } from "lucide-react";

function Section({ title, icon: Icon, children }: { title: string; icon: any; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-card border border-card-border rounded-lg overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-3 p-4 text-left hover:bg-muted/30 transition-colors">
        <Icon className="h-4 w-4 text-primary shrink-0" />
        <span className="text-sm font-bold text-foreground flex-1">{title}</span>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>
      {open && <div className="px-4 pb-4 text-xs text-muted-foreground leading-relaxed space-y-3 border-t border-card-border">{children}</div>}
    </div>
  );
}

function Q({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <div className="pt-3">
      <p className="font-semibold text-foreground mb-1">{q}</p>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

export default function Help() {
  return (
    <div className="p-3 sm:p-4 md:p-6 space-y-4 max-w-[900px] mx-auto" data-testid="help-page">
      <div className="flex items-center gap-2 mb-2">
        <BookOpen className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-bold text-foreground">Help & Instructions</h1>
      </div>
      <p className="text-xs text-muted-foreground -mt-2">Click each section to expand. Everything you need to know about each feature.</p>

      {/* ─── Getting Started ──────────────────────────────────────────── */}
      <Section title="Getting Started" icon={HelpCircle}>
        <Q q="What is this app?">
          <p>Stock Analyzer is an all-in-one trading companion. It combines stock analysis, strategy scanning, trade tracking, and options calculators into a single unified app. Your ticker carries across all pages — search once, use everywhere.</p>
        </Q>
        <Q q="How do I analyze a stock?">
          <p>Type a ticker symbol (like AAPL, MSFT, TSLA) in the search bar at the top and click Analyze. The app will pull real-time data from Yahoo Finance and score the stock across 10 categories on a 0-10 scale.</p>
          <p>The verdict badge in the header shows: <span className="text-green-400 font-semibold">YES</span> (strong buy, 7+), <span className="text-yellow-400 font-semibold">WATCH</span> (hold/monitor, 4-7), or <span className="text-red-400 font-semibold">NO</span> (avoid, below 4).</p>
        </Q>
        <Q q="Where is my data stored?">
          <p>All data (watchlist, portfolio, trades, settings) is stored in a SQLite database on the server. It persists across sessions. There's no user login — everyone using the same deployment shares the same data.</p>
        </Q>
      </Section>

      {/* ─── Analyzer Page ────────────────────────────────────────────── */}
      <Section title="Analyzer Page" icon={BarChart3}>
        <Q q="What do the 10 scoring categories mean?">
          <p>Each stock is scored across: Valuation (P/E, P/B), Growth (revenue/earnings growth), Profitability (margins, ROE), Financial Health (debt, current ratio), Dividend quality, Momentum (price performance), Analyst consensus, Earnings quality, Sector outlook, and Risk assessment.</p>
          <p>Each category is weighted and combined into a 0-10 final score.</p>
        </Q>
        <Q q="What does the Snapshot section show?">
          <p>Quick-look metrics with color coding: <span className="text-green-400 font-semibold">Green</span> = good, <span className="text-red-400 font-semibold">Red</span> = concerning, <span className="text-yellow-400 font-semibold">Yellow</span> = neutral. This gives you an instant feel for the stock's health.</p>
        </Q>
        <Q q="How do I add to Watchlist or Portfolio?">
          <p>After analyzing a stock, use the "+ Watchlist" or "+ Portfolio" buttons at the bottom of the sidebar. Watchlist = stocks you're watching. Portfolio = stocks you own. Both show live rankings by score.</p>
        </Q>
      </Section>

      {/* ─── Trade Analysis ───────────────────────────────────────────── */}
      <Section title="Trade Analysis Page" icon={Activity}>
        <Q q="What are the three strategy cards?">
          <p><strong className="text-foreground">BBTC EMA Pyramid:</strong> Uses EMA 9/21/50 crossovers with ATR-based stops. Best for trend-following entries on momentum stocks.</p>
          <p><strong className="text-foreground">VER (Volume Exhaustion Reversal):</strong> Catches trend reversals using three-way confirmation — RSI divergence (momentum weakening), volume exhaustion spikes (2x+ average), and Bollinger Band extremes (price at statistical limits). Best for catching overbought/oversold snaps.</p>
          <p><strong className="text-foreground">AMC (Adaptive Momentum Confluence):</strong> Custom strategy combining MACD histogram divergence, Bollinger squeeze breakouts, volume confirmation, and ADX trend strength. This was backtested over 528 trades with a 1.27 profit factor.</p>
        </Q>
        <Q q="What do the signals mean?">
          <p><span className="text-green-400 font-semibold">BUY</span> = active buy signal. <span className="text-red-400 font-semibold">SELL</span> = active sell signal. <span className="text-yellow-400 font-semibold">NEUTRAL</span> = no clear signal. Each card shows entry/exit levels, stop loss, and take profit targets.</p>
        </Q>
      </Section>

      {/* ─── Scanner ─────────────────────────────────────────────────── */}
      <Section title="Scanner Page" icon={Radar}>
        <Q q="How does the scanner work?">
          <p>Click "Scan Now" to search the market for stocks that match strategy criteria. It scans Yahoo Finance's stock screener and applies technical analysis to each result.</p>
          <p><strong className="text-foreground">3-Strategy Scanner:</strong> Finds stocks where BBTC, VER, and AMC all agree on a signal. Higher confluence = stronger setup.</p>
          <p><strong className="text-foreground">AMC Scanner:</strong> Specifically looks for stocks matching the AMC strategy criteria (MACD divergence + Bollinger + volume + ADX).</p>
        </Q>
        <Q q="Why do I only see 10 results?">
          <p>Results are limited to 10 at a time to keep scans fast and avoid rate limiting from Yahoo Finance. The top results by score are shown.</p>
        </Q>
      </Section>

      {/* ─── Trade Tracker ────────────────────────────────────────────── */}
      <Section title="Trade Tracker" icon={ClipboardList}>
        <Q q="How do I add a trade?">
          <p>Click "+ Add Trade" on the tracker page. Choose Stock or Option, then select the trade type. The form dynamically adjusts — spreads show strike fields and spread width, single options show one strike, stocks hide option fields.</p>
        </Q>
        <Q q="What's the difference between Pilot and Add?">
          <p><strong className="text-foreground">Pilot</strong> = your initial entry into a position. <strong className="text-foreground">Add</strong> = adding to an existing position (averaging in, adding a spread on top, etc.). This helps you track how adding to positions affects your overall P/L.</p>
        </Q>
        <Q q="How does the Open Price work?">
          <p><strong className="text-foreground">Positive number = credit received.</strong> When you sell a put credit spread for $1.50, enter 1.50. You received money.</p>
          <p><strong className="text-foreground">Negative number = debit paid.</strong> When you buy a call debit spread for $2.00, enter -2.00. You paid money.</p>
          <p>For stocks: buying 100 shares at $150 → enter -150. Short selling 100 shares at $150 → enter 150.</p>
        </Q>
        <Q q="How do I close a trade?">
          <p>Click the checkmark icon on an open trade. Enter the close date and close price. Same sign convention: positive = you received money closing, negative = you paid to close.</p>
          <p><strong className="text-foreground">If it expired worthless:</strong> Close price = 0. For credit spreads that expire OTM, this means you kept the full credit (profit).</p>
        </Q>
        <Q q="What are Behavior Tags?">
          <p>Track your trading psychology: <span className="text-green-400 font-semibold">All to Plan</span> = followed your rules. <span className="text-red-400 font-semibold">Fear/Panic</span> = closed too early out of fear. <span className="text-red-400 font-semibold">Greed/FOMO</span> = chased a trade. <span className="text-yellow-400 font-semibold">Bias/Stubborn</span> = held too long. <span className="text-yellow-400 font-semibold">Feed the Pigeons</span> = took small gains instead of letting winners run.</p>
          <p>The Behavior Analysis section shows your tag counts so you can identify patterns in your trading mistakes.</p>
        </Q>
        <Q q="How does Refresh P/L work?">
          <p>Click "Refresh P/L" to fetch the latest stock prices from Yahoo Finance for all your open trades. This updates the Price column and recalculates your unrealized P/L. The Open P/L card in the summary shows your total unrealized gains/losses.</p>
        </Q>
        <Q q="What do the summary cards mean?">
          <p><strong className="text-foreground">Account Value</strong> = Starting balance + all closed trade profits/losses + deposits/withdrawals.</p>
          <p><strong className="text-foreground">Total P/L</strong> = Sum of all closed trade profits and losses.</p>
          <p><strong className="text-foreground">Open P/L</strong> = Estimated unrealized P/L on open trades based on last refreshed prices.</p>
          <p><strong className="text-foreground">Win Rate</strong> = Percentage of closed trades that were profitable. Target: above 55%.</p>
          <p><strong className="text-foreground">Allocated</strong> = What percentage of your account is currently at risk in open trades. Your Settings panel lets you set a max limit (default 30%).</p>
        </Q>
        <Q q="Where do I set my account value and commissions?">
          <p>Click the "Settings" button on the tracker page. Set your starting account value, commission per stock trade, commission per option contract (default $0.65), max allocation per trade, and total allocated limit.</p>
        </Q>
      </Section>

      {/* ─── Options Calculator ───────────────────────────────────────── */}
      <Section title="Options Calculator" icon={Calculator}>
        <Q q="What is the Risk Calculator?">
          <p>Answers the question: <strong className="text-foreground">"How many contracts can I trade without exceeding my risk limit?"</strong></p>
          <p>Pick your trade type, enter the price and spread width, and it calculates your max risk in dollars and as a percentage of your account. The Max Contracts field tells you the most you can trade at your chosen risk percentage.</p>
          <p>Example: PCS (Put Credit Spread), $5 wide, $1.50 credit, $10k account, 5% max risk → Risk per contract = $350, Max contracts = 1.</p>
        </Q>
        <Q q="What is the Vertical Spread Expectancy?">
          <p>Answers: <strong className="text-foreground">"If I repeat this trade many times, will I make or lose money?"</strong></p>
          <p>For <strong className="text-foreground">Short Verticals (credit spreads)</strong>: Enter the credit received and the Probability of expiring OTM (from your broker's chain). Higher Prob OTM = more likely to win but smaller credit.</p>
          <p>For <strong className="text-foreground">Long Verticals (debit spreads)</strong>: Enter your max profit potential and Prob OTM. Here, Prob OTM works AGAINST you — it means the trade doesn't work out. Use a lower Prob OTM value (40-50%) for trades you expect to win.</p>
          <p>A positive Net Expectancy (green) means the trade has a statistical edge. Negative (red) means you'd lose money over time.</p>
        </Q>
        <Q q="What is the Defined Risk/Reward Calculator?">
          <p>A more detailed version that factors in commissions and calculates the <strong className="text-foreground">exact dollar expectancy over 100 trades</strong>.</p>
          <p>Enter your commission, POP (probability of profit from your broker), strike width, and open price (positive for credit, negative for debit). It shows max profit, max loss, and whether you have a mathematical edge.</p>
          <p>The Target Exits table shows what dollar amount to close at for 50%, 65%, or 75% of max profit/loss — this is where most traders set their take-profit and stop-loss levels.</p>
        </Q>
        <Q q="What is the Weighted Price Calculator?">
          <p>Answers: <strong className="text-foreground">"What's my average price when I scale in or out of a position?"</strong></p>
          <p>If you buy 2 contracts at $3.00 then 3 more at $2.50, your weighted average entry is $2.70 — not just the simple average. This calculator handles multiple legs in and out, computes your overall allocation, profit, and ROI.</p>
        </Q>
        <Q q="Why does the calculator show losses?">
          <p>The default values are set up as realistic examples. If you see red numbers, check these common causes:</p>
          <p>1. <strong className="text-foreground">Low POP</strong> — A POP below 50% means you're MORE likely to lose than win. Raise it to 60-70% for credit spreads.</p>
          <p>2. <strong className="text-foreground">Wrong sign on price</strong> — Credit spreads should be positive (you receive money). Debit spreads should be negative (you pay).</p>
          <p>3. <strong className="text-foreground">Expectancy is statistical</strong> — Even a positive-expectancy trade will have losing trades. The expectancy calculator shows the expected NET result over many trades, not a single trade outcome.</p>
        </Q>
      </Section>

      {/* ─── Wheel Strategy ───────────────────────────────────────────── */}
      <Section title="Wheel Strategy" icon={RefreshCw}>
        <Q q="What is The Wheel?">
          <p>The Wheel is a continuous income strategy that cycles between <strong className="text-foreground">selling cash-secured puts (CSPs)</strong> and <strong className="text-foreground">selling covered calls (CCs)</strong> on a stock you'd be happy to own.</p>
          <p>You keep rolling premium until the market assigns you — then you own the stock, and keep rolling premium on the other side until the market calls it away. Rinse, repeat.</p>
        </Q>
        <Q q="How do I use the Wheel calculator?">
          <p>Open <strong className="text-foreground">Calculators → Wheel Strategy</strong> from the sidebar. Enter:</p>
          <p>1. <strong className="text-foreground">Stock price</strong> — current price of the underlying.</p>
          <p>2. <strong className="text-foreground">Put strike / premium</strong> — the CSP you plan to sell. Strike should be below stock price; premium from your broker's option chain.</p>
          <p>3. <strong className="text-foreground">Call strike / premium</strong> — the covered call you'd sell <em>after</em> being assigned. Strike should be above your assignment cost basis.</p>
          <p>4. <strong className="text-foreground">DTE</strong> — days to expiration. 21–45 is the theta-decay sweet spot.</p>
          <p>5. <strong className="text-foreground">Contracts</strong> — each contract = 100 shares and requires strike × 100 in cash.</p>
          <p>The calculator shows put-cycle return, call-cycle return, full-wheel return (annualized), cost basis if assigned, capital required, max loss, and a payoff chart overlaying the CSP-only vs. full-wheel P/L.</p>
        </Q>
        <Q q="What does 'Setup Quality' score mean?">
          <p>A quick sanity check across five heuristics: put strike below stock price, call strike above cost basis, put yield &gt; 10% annualized, capital at risk under 25% of account, and DTE in the 21–45 sweet spot. 80%+ is a clean setup; below 60% means rethink.</p>
        </Q>
        <Q q="When does The Wheel blow up?">
          <p>The wheel's biggest risk is a <strong className="text-red-400">catastrophic gap down</strong>. If you CSP a stock at $100 and it crashes to $50 on earnings, you're assigned at $100, holding a huge unrealized loss, and any call you sell above $100 (to avoid locking in the loss) will barely collect premium.</p>
          <p>Only wheel tickers you'd genuinely be willing to own for years. Avoid: pre-earnings, biotech binary events, small-caps, meme stocks, and anything with a pending regulatory decision.</p>
        </Q>
        <Q q="How do I pick strikes?">
          <p>For the CSP, common targets: 16-delta (≈84% prob OTM — conservative) or 30-delta (≈70% OTM — more premium, more assignments).</p>
          <p>For the CC after assignment, target a strike <strong className="text-foreground">above your cost basis</strong> so you lock in a gain if called away. 30-delta is a typical choice.</p>
          <p>Use the <strong className="text-foreground">Greeks Calculator</strong> for delta and <strong className="text-foreground">Payoff Diagram</strong> to visualize before committing.</p>
        </Q>
      </Section>

      {/* ─── Trade Types Reference ────────────────────────────────────── */}
      <Section title="Trade Types Quick Reference" icon={BookOpen}>
        <div className="pt-3">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground border-b border-card-border">
                <th className="text-left pb-2 font-semibold">Code</th>
                <th className="text-left pb-2 font-semibold">Name</th>
                <th className="text-center pb-2 font-semibold">Legs</th>
                <th className="text-left pb-2 font-semibold">When to Use</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border/30">
              <tr><td className="py-1.5 font-mono font-bold text-foreground">LONG</td><td>Long Stock</td><td className="text-center">—</td><td>Bullish — buy shares, profit when price goes up</td></tr>
              <tr><td className="py-1.5 font-mono font-bold text-foreground">SHORT</td><td>Short Stock</td><td className="text-center">—</td><td>Bearish — sell borrowed shares, profit when price drops</td></tr>
              <tr><td className="py-1.5 font-mono font-bold text-foreground">C</td><td>Call</td><td className="text-center">1</td><td>Bullish — buy call option, profit when stock rises above strike</td></tr>
              <tr><td className="py-1.5 font-mono font-bold text-foreground">P</td><td>Put</td><td className="text-center">1</td><td>Bearish — buy put option, profit when stock drops below strike</td></tr>
              <tr><td className="py-1.5 font-mono font-bold text-foreground">SC</td><td>Short Call</td><td className="text-center">1</td><td>Bearish/neutral — sell call, keep premium if stock stays below</td></tr>
              <tr><td className="py-1.5 font-mono font-bold text-foreground">SP</td><td>Short Put</td><td className="text-center">1</td><td>Bullish/neutral — sell put, keep premium if stock stays above</td></tr>
              <tr><td className="py-1.5 font-mono font-bold text-foreground">PCS</td><td>Put Credit Spread</td><td className="text-center">2</td><td>Bullish — sell higher put, buy lower put. Collect credit. Most popular defined-risk trade</td></tr>
              <tr><td className="py-1.5 font-mono font-bold text-foreground">CCS</td><td>Call Credit Spread</td><td className="text-center">2</td><td>Bearish — sell lower call, buy higher call. Collect credit</td></tr>
              <tr><td className="py-1.5 font-mono font-bold text-foreground">CDS</td><td>Call Debit Spread</td><td className="text-center">2</td><td>Bullish — buy lower call, sell higher call. Pay debit, profit if stock rises</td></tr>
              <tr><td className="py-1.5 font-mono font-bold text-foreground">PDS</td><td>Put Debit Spread</td><td className="text-center">2</td><td>Bearish — buy higher put, sell lower put. Pay debit, profit if stock drops</td></tr>
              <tr><td className="py-1.5 font-mono font-bold text-foreground">CBFLY</td><td>Call Butterfly</td><td className="text-center">3</td><td>Neutral — profit if stock stays near middle strike at expiration</td></tr>
              <tr><td className="py-1.5 font-mono font-bold text-foreground">PBFLY</td><td>Put Butterfly</td><td className="text-center">3</td><td>Neutral — put version of butterfly</td></tr>
              <tr><td className="py-1.5 font-mono font-bold text-foreground">CUBFLY</td><td>Call Unbal. Fly</td><td className="text-center">3</td><td>Directional butterfly — skewed strikes for directional bet</td></tr>
            </tbody>
          </table>
        </div>
      </Section>

      {/* ─── Troubleshooting ──────────────────────────────────────────── */}
      <Section title="Troubleshooting" icon={HelpCircle}>
        <Q q="App shows 'No data' or blank charts">
          <p>Yahoo Finance sometimes rate-limits requests. Wait 30 seconds and try again. If using Railway, make sure the deployment is active and not sleeping.</p>
        </Q>
        <Q q="Scanner shows no results">
          <p>The scanner uses Yahoo Finance's screener which can be slow. Click "Scan Now" and wait — it may take 15-30 seconds. If still empty, try adjusting the filter criteria (sector, price range, market cap).</p>
        </Q>
        <Q q="Railway shows 404 or 'train not arrived'">
          <p>This means the Railway deployment is down. Go to your Railway dashboard and check if the service is running. You may need to trigger a new deployment by pushing to GitHub.</p>
        </Q>
        <Q q="Prices not updating">
          <p>Click "Refresh P/L" on the Trade Tracker page. Prices come from Yahoo Finance and need a manual refresh. Market data is only available during trading hours (9:30 AM - 4:00 PM ET, Mon-Fri).</p>
        </Q>
      </Section>
    </div>
  );
}
