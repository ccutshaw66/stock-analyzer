/**
 * Stock Otter — Help knowledge base.
 *
 * Every entry is either:
 *   - "how-to"        — step-by-step instruction for using a feature
 *   - "what-it-means" — definition of a term, score, signal, or threshold
 *
 * Statements here are verified against actual code (the file:line refs in
 * the prompts that built this document). When a feature changes, update the
 * relevant entry rather than letting it drift.
 *
 * Add entries to `HELP_ENTRIES` below. The Help page renders them
 * automatically; no other registration needed.
 */
import type { ReactNode } from "react";

export type HelpEntryType = "how-to" | "what-it-means";

export type HelpCategory =
  // How-to categories
  | "Getting Started"
  | "Analyzing a Ticker"
  | "Watchlist & Portfolio"
  | "Tracking Trades"
  | "Finding Setups"
  | "Reading Verdicts"
  | "Calculators"
  | "Auto-Traders"
  | "Dashboard"
  // What-it-means categories
  | "Verdicts & Scores"
  | "Strategies"
  | "Indicators"
  | "Patterns"
  | "Insider & Institutional"
  | "Options Terminology"
  | "Market Mechanics";

export interface HelpEntry {
  /** URL-hash slug. Kebab-case. Must be unique. */
  id: string;
  /** Document-type bucket. */
  type: HelpEntryType;
  /** Section the entry appears under. */
  category: HelpCategory;
  /** Headline shown in the index and at the top of the entry. */
  title: string;
  /** Extra search hints — synonyms, abbreviations, alternate phrasings. */
  tags: string[];
  /** Entry body. Plain JSX. */
  body: ReactNode;
}

// ─── Body builders (small typography helpers) ──────────────────────────────

function P({ children }: { children: ReactNode }) {
  return <p className="text-sm text-foreground leading-relaxed">{children}</p>;
}

function Steps({ children }: { children: ReactNode }) {
  return <ol className="list-decimal list-inside space-y-1 text-sm text-foreground leading-relaxed">{children}</ol>;
}

function Bullets({ children }: { children: ReactNode }) {
  return <ul className="list-disc list-inside space-y-1 text-sm text-foreground leading-relaxed">{children}</ul>;
}

function B({ children }: { children: ReactNode }) {
  return <strong className="text-foreground font-semibold">{children}</strong>;
}

function Code({ children }: { children: ReactNode }) {
  return <code className="text-xs px-1 py-0.5 rounded bg-muted font-mono text-foreground">{children}</code>;
}

function Note({ children }: { children: ReactNode }) {
  return (
    <div className="text-xs text-muted-foreground italic border-l-2 border-card-border pl-3 mt-2">
      {children}
    </div>
  );
}

function ScoreRow({ label, range, tone, note }: { label: string; range: string; tone: "bull" | "watch" | "bear" | "muted"; note?: string }) {
  const cls =
    tone === "bull" ? "text-bull-light"
    : tone === "watch" ? "text-watch-light"
    : tone === "bear" ? "text-bear-light"
    : "text-muted-foreground";
  return (
    <div className="flex items-baseline gap-3 text-sm">
      <span className={`font-semibold tabular-nums w-24 ${cls}`}>{range}</span>
      <span className="font-medium text-foreground">{label}</span>
      {note && <span className="text-xs text-muted-foreground">— {note}</span>}
    </div>
  );
}

// ─── Entries ────────────────────────────────────────────────────────────────

export const HELP_ENTRIES: HelpEntry[] = [

  // ════════════════════════════════════════════════════════════════════════
  //  GETTING STARTED
  // ════════════════════════════════════════════════════════════════════════

  {
    id: "getting-started-what-is-this",
    type: "how-to",
    category: "Getting Started",
    title: "What Stock Otter actually does",
    tags: ["intro", "overview", "purpose"],
    body: (
      <>
        <P>
          Stock Otter is a personal trading workbench. It pulls market data, runs a
          collection of trading strategies and analytical models, and surfaces the results in
          pages organized by what you're trying to do — analyze a ticker, find a setup, track
          a trade, or run an auto-trader.
        </P>
        <P>
          One ticker is "active" at any time (the box in the top bar). When you change it,
          most pages re-fetch for that ticker. Add/Watchlist and Add/Portfolio buttons add
          the active ticker to your saved lists.
        </P>
        <P>
          Data sources are FMP (Financial Modeling Prep) for fundamentals + earnings +
          insiders + analyst ratings, and Polygon for quotes + price bars + options. Yahoo
          and Polygon are both being migrated off; new features go on FMP.
        </P>
      </>
    ),
  },

  {
    id: "getting-started-search",
    type: "how-to",
    category: "Getting Started",
    title: "Search a ticker (and why the dropdown ranking matters)",
    tags: ["search", "analyze", "ticker", "tesla", "tsla"],
    body: (
      <>
        <P>
          Type a ticker (<Code>AAPL</Code>) or a company name (<Code>tesla</Code>) in the top-bar
          search. After ~300ms it queries FMP's <Code>/search-symbol</Code> and
          <Code>/search-name</Code> in parallel, dedupes by symbol, and re-ranks locally
          before showing 8 results.
        </P>
        <P>
          Ranking order (best match first):
        </P>
        <Bullets>
          <li>exact symbol match (e.g. <Code>TSLA</Code> → Tesla first)</li>
          <li>symbol starts with your query</li>
          <li>first word of company name matches</li>
          <li>any word of company name matches</li>
          <li>company name starts with query</li>
          <li>contains the query somewhere</li>
        </Bullets>
        <P>
          Click a result, or hit <B>Analyze</B> to use whatever you typed verbatim. The
          dropdown closes on submit; stale fetches that come back after submit can't
          re-open it.
        </P>
      </>
    ),
  },

  {
    id: "getting-started-tiers",
    type: "how-to",
    category: "Getting Started",
    title: "Free vs. Starter vs. Premium tiers",
    tags: ["subscription", "pricing", "tier", "starter", "premium"],
    body: (
      <>
        <P>
          Pages with a tier requirement are hidden from the sidebar nav for users below that
          tier. Current gates (see the page registry):
        </P>
        <Bullets>
          <li><B>MM Exposure</B> requires Starter or above.</li>
          <li>Most other pages are visible at all tiers; some features within a page (scan
            run limits, analysis call limits) are usage-capped per day.</li>
        </Bullets>
        <Note>Quotas are tracked per user per day server-side; you'll see a "limit reached"
        card if you've used the day's quota.</Note>
      </>
    ),
  },

  // ════════════════════════════════════════════════════════════════════════
  //  ANALYZING A TICKER
  // ════════════════════════════════════════════════════════════════════════

  {
    id: "analyze-flow",
    type: "how-to",
    category: "Analyzing a Ticker",
    title: "Analyze a ticker end-to-end",
    tags: ["analyze", "research", "verdict", "profile"],
    body: (
      <>
        <Steps>
          <li>Type the ticker in the top search, click <B>Analyze</B> (or pick from the dropdown).</li>
          <li><B>Profile</B> page shows the live quote + fundamentals + analyst snapshot.</li>
          <li><B>Trade Analysis</B> walks through each per-ticker signal with chart overlays.</li>
          <li><B>Trigger Check</B> rolls everything up into a one-word <B>GO</B>/<B>CAUTION</B>/<B>NO</B> verdict with plain-English reasons.</li>
          <li><B>Long-Term Outlook</B> is the multi-horizon investor-style verdict (different question — "should I own this for years," not "should I trade this now").</li>
        </Steps>
        <P>If you want to keep watching the ticker, hit <B>+ Watchlist</B>. If you've already taken a position, use <B>Trade Tracker</B> instead.</P>
      </>
    ),
  },

  {
    id: "analyze-verdict-tile",
    type: "how-to",
    category: "Analyzing a Ticker",
    title: "Reading the headline verdict tile",
    tags: ["verdict", "yes", "watch", "no", "score"],
    body: (
      <>
        <P>The big verdict tile at the top of the analysis pages reports a 0–100 score and a verdict label. The label is determined by these thresholds:</P>
        <div className="space-y-1">
          <ScoreRow range="85 – 100" label="STRONG CONVICTION" tone="bull" />
          <ScoreRow range="70 – 84" label="INVESTMENT GRADE" tone="bull" />
          <ScoreRow range="55 – 69" label="SPECULATIVE" tone="watch" />
          <ScoreRow range="0 – 54" label="HIGH RISK" tone="bear" />
        </div>
        <P>The 0–10 internal score is multiplied by 10 for display. Missing data in any category renormalizes the rest — a ticker with no analyst coverage isn't penalized, just scored on the categories with data.</P>
      </>
    ),
  },

  // ════════════════════════════════════════════════════════════════════════
  //  WATCHLIST & PORTFOLIO
  // ════════════════════════════════════════════════════════════════════════

  {
    id: "watchlist-vs-portfolio",
    type: "how-to",
    category: "Watchlist & Portfolio",
    title: "Watchlist vs. Portfolio — what each one is for",
    tags: ["watchlist", "portfolio", "favorites"],
    body: (
      <>
        <P><B>Watchlist</B> is for tickers you're observing pre-trade — researching, waiting for a setup, considering. Once you actually open a position, the ticker is dropped from the watchlist automatically (server-side filter on <Code>/api/favorites/watchlist</Code> excludes any ticker that has an open trade).</P>
        <P><B>Portfolio</B> is a tagging list — tickers you consider part of your long-term holdings. Independent of Trade Tracker.</P>
        <P>Both lists are per-user, persisted, and rank by their saved score/verdict.</P>
      </>
    ),
  },

  {
    id: "watchlist-add-remove",
    type: "how-to",
    category: "Watchlist & Portfolio",
    title: "Add or remove a ticker from your watchlist",
    tags: ["watchlist", "add", "remove", "star"],
    body: (
      <>
        <P>From any page where the active ticker is set (Profile, Trade Analysis, etc.) click <B>+ Watchlist</B>. The ticker, current score, and verdict snapshot are saved.</P>
        <P>To remove, open the Watchlist widget (Dashboard) or the Watchlist page and click the remove control on the row.</P>
        <Note>If a ticker disappears from the watchlist unexpectedly, check Trade Tracker — once you open a trade on it, the watchlist hides it.</Note>
      </>
    ),
  },

  // ════════════════════════════════════════════════════════════════════════
  //  TRACKING TRADES
  // ════════════════════════════════════════════════════════════════════════

  {
    id: "tracker-add-trade",
    type: "how-to",
    category: "Tracking Trades",
    title: "Log a new trade",
    tags: ["add trade", "tracker", "log", "open"],
    body: (
      <>
        <Steps>
          <li>Open <B>Current Positions</B> (Trade Tracker).</li>
          <li>Click <B>+ Add Trade</B>. The form adapts based on Stock vs. Option and the chosen trade type.</li>
          <li>Sign convention for <B>Open Price</B>: <B>positive = credit received</B> (you got paid, e.g. a credit spread); <B>negative = debit paid</B> (you spent money, e.g. buying shares or a debit spread).</li>
          <li>For stocks: buying 100 shares at $150 → enter <Code>-150</Code>. Short 100 at $150 → enter <Code>150</Code>.</li>
          <li>Strategy field tags the trade so the per-strategy lifecycle (HTF, BBTC+VER, AMC, Insider Trigger) walks it correctly.</li>
        </Steps>
      </>
    ),
  },

  {
    id: "tracker-close-trade",
    type: "how-to",
    category: "Tracking Trades",
    title: "Close a trade (full or partial)",
    tags: ["close", "exit", "expire"],
    body: (
      <>
        <Steps>
          <li>Click the checkmark on the row you're closing.</li>
          <li>Enter close date + close price using the same sign convention as open price.</li>
          <li>For credit spreads that expire OTM (worthless), close price = <Code>0</Code> — you keep the full credit.</li>
          <li>For partial closes, set the contract/share quantity you're closing; the position is split.</li>
        </Steps>
      </>
    ),
  },

  {
    id: "tracker-pilot-vs-add",
    type: "what-it-means",
    category: "Tracking Trades",
    title: "Pilot vs. Add",
    tags: ["pilot", "add", "average in", "scale"],
    body: (
      <>
        <P><B>Pilot</B> = the first entry into a position.</P>
        <P><B>Add</B> = a follow-on entry on the same ticker / strategy / strike combo. The Tracker groups Pilot and Add(s) together so cost basis and unrealized P/L stay correct when you scale in.</P>
      </>
    ),
  },

  {
    id: "tracker-behavior-tags",
    type: "what-it-means",
    category: "Tracking Trades",
    title: "Behavior tags",
    tags: ["behavior", "psychology", "discipline", "tags"],
    body: (
      <>
        <P>Tag each closed trade with how you felt managing it. The Performance Analytics page totals these so you can see your own patterns.</P>
        <Bullets>
          <li><B>All to Plan</B> — followed your stop/target rules.</li>
          <li><B>Fear/Panic</B> — closed early out of fear.</li>
          <li><B>Greed/FOMO</B> — chased an entry.</li>
          <li><B>Bias/Stubborn</B> — held past your stop.</li>
          <li><B>Feed the Pigeons</B> — took small gains instead of letting winners run.</li>
        </Bullets>
      </>
    ),
  },

  {
    id: "tracker-refresh-pnl",
    type: "how-to",
    category: "Tracking Trades",
    title: "Refresh P/L on open positions",
    tags: ["refresh", "p/l", "pnl", "prices"],
    body: (
      <>
        <P>Click <B>Refresh P/L</B> on the Current Positions page (or the refresh button on any price table) to pull fresh quotes. The Price column and the Open P/L summary card recalculate.</P>
        <Note>Quotes only update during US market hours (9:30–16:00 ET, Mon–Fri). Outside hours you'll see the last close.</Note>
      </>
    ),
  },

  // ════════════════════════════════════════════════════════════════════════
  //  FINDING SETUPS
  // ════════════════════════════════════════════════════════════════════════

  {
    id: "scanner-modes",
    type: "how-to",
    category: "Finding Setups",
    title: "Scanner modes (3-Strategy / AMC / Explosive)",
    tags: ["scanner", "v2", "explosive", "amc", "3strat", "screening"],
    body: (
      <>
        <P>The Scanner has three modes selectable via tabs:</P>
        <Bullets>
          <li><B>3-Strategy</B> — looks for tickers where BBTC, VER, and AMC all align on the same direction. Higher confluence ⇒ stronger card.</li>
          <li><B>AMC</B> — only the AMC strategy gates (MACD divergence + Bollinger + volume + ADX).</li>
          <li><B>Explosive (v2)</B> — wider universe (2,000+ tickers) scanned through the v2 gating system. Click a card to drill into Trade Analysis.</li>
        </Bullets>
        <P>Each result card carries a verdict pip (<Code>GO ↑</Code>, <Code>SET ↑</Code>, <Code>READY ↑</Code>, <Code>PULLBACK</Code>, etc.) — same vocabulary as the watchlist and Trade Analysis pages. Results are session-cached so reloading the page keeps them around.</P>
      </>
    ),
  },

  {
    id: "scanner-pip",
    type: "what-it-means",
    category: "Reading Verdicts",
    title: "Scanner pip verdicts (GO / SET / READY / PULLBACK)",
    tags: ["pip", "go", "set", "ready", "pullback", "scanner"],
    body: (
      <>
        <P>The small pill next to each ticker tells you where the setup is in its lifecycle:</P>
        <Bullets>
          <li><B>GO ↑</B> / <B>GO ↓</B> — all 3 gates cleared (strongest read).</li>
          <li><B>SET ↑</B> / <B>SET ↓</B> — 2 of 3 gates cleared.</li>
          <li><B>READY ↑</B> / <B>READY ↓</B> — 1 gate cleared.</li>
          <li><B>PULLBACK</B> — a prior setup is in a buyable pullback zone.</li>
          <li><B>GATES CLOSED</B> — the conditions that fired earlier have gone stale.</li>
          <li><B>NO SETUP</B> — nothing aligning right now.</li>
        </Bullets>
        <P>Up-arrow variants are bullish; down-arrow are bearish. Pip results are cached server-side for 15 minutes.</P>
      </>
    ),
  },

  {
    id: "htf-tabs",
    type: "how-to",
    category: "Finding Setups",
    title: "Use the HTF Setups page",
    tags: ["htf", "high tight flag", "setups", "scan"],
    body: (
      <>
        <P>Five tabs:</P>
        <Bullets>
          <li><B>Live</B> — flags that have already broken out. These are the actionable list.</li>
          <li><B>Watch</B> — patterns still forming (pole + flag valid, no breakout yet). Visibility surface, not a strict gate.</li>
          <li><B>Portfolio</B> — your open HTF trades pulled from Trade Tracker, with capacity / sector / risk summary.</li>
          <li><B>Backtest</B> — per-ticker walk-forward simulation using the Givens exits.</li>
          <li><B>Config</B> — account capital + per-trade / sector / open-risk caps used for position sizing.</li>
        </Bullets>
        <P>Min Score input on the Live/Watch tabs filters server-side. Click the <B>Add</B> (+) icon on a row to seed a new trade in the Tracker.</P>
      </>
    ),
  },

  {
    id: "dividends-page",
    type: "how-to",
    category: "Finding Setups",
    title: "Find income with the Dividend Finder",
    tags: ["dividends", "yield", "income", "scan"],
    body: (
      <>
        <P>Filters: Min Yield, Frequency (monthly/quarterly), Max Payout Ratio, Result Limit. Click <B>Scan</B> and the page returns tickers ranked by Score (0–100).</P>
        <P>The Score combines yield safety (payout ratio, 5Y avg yield), dividend rate, and frequency. Click a row to set it active; the hero card expands with payment schedule + yield breakdown.</P>
        <P>Below the scan results, the Weekly Strategy section segregates monthly vs. quarterly payers so you can build a portfolio that pays every week.</P>
      </>
    ),
  },

  {
    id: "sector-heatmap",
    type: "how-to",
    category: "Finding Setups",
    title: "Read the Sector Heatmap",
    tags: ["sectors", "heatmap", "rotation", "spdr"],
    body: (
      <>
        <P>Each sector tile shows its performance over the selected timeframe (1D/1W/1M/3M). Color interpolates green for positive, red for negative; performance is clamped to ±5% so anything past that is full-color.</P>
        <P>Click a tile to open the leader modal — top 10 tickers in that sector ranked by 1-month momentum + volume surge. Click a leader to jump to it in the Scanner.</P>
      </>
    ),
  },

  {
    id: "earnings-calendar",
    type: "how-to",
    category: "Finding Setups",
    title: "Use the Earnings Calendar",
    tags: ["earnings", "calendar", "report"],
    body: (
      <>
        <P>Lists upcoming earnings for your watchlist sorted by date. Each card shows: days-to-earnings countdown, EPS + revenue estimates, and the last four quarters of actual vs. estimate with a beat / miss / in-line tag.</P>
        <P>Useful for the rule "don't open a stop-loss trade within ~14 days of earnings" — gap risk blows through stops.</P>
      </>
    ),
  },

  // ════════════════════════════════════════════════════════════════════════
  //  READING VERDICTS
  // ════════════════════════════════════════════════════════════════════════

  {
    id: "trigger-check",
    type: "how-to",
    category: "Reading Verdicts",
    title: "Trigger Check — should I pull the trigger right now?",
    tags: ["trigger check", "conviction", "verdict", "go", "caution", "no"],
    body: (
      <>
        <P>The Trigger Check page answers a single question for the active ticker: should I take this trade <em>today</em>?</P>
        <P>Verdict is one of:</P>
        <Bullets>
          <li><B>GO</B> — passes outnumber warns and zero checks fail.</li>
          <li><B>CAUTION</B> — at least one check fails (regardless of weight), or warns ≥ passes.</li>
          <li><B>NO</B> — a single heavy-weight check (weight ≥ 3) fails, OR fails outnumber passes.</li>
          <li><B>NOT ENOUGH DATA</B> — none of the checks had data to evaluate.</li>
        </Bullets>
        <P>Below the verdict pill, every check is grouped by category and rendered as a row with a status icon (PASS / WATCH / RISK / NO DATA) and a plain-English reason.</P>
        <P>The 8 checks pulled into the verdict: Trend Stack, RSI Zone, HTF Setup, Insider Activity, Dealer Flow, Earnings Proximity, Fundamentals, Market Regime. "Skip" checks (no data) are hidden from the default view.</P>
      </>
    ),
  },

  {
    id: "long-term-outlook",
    type: "how-to",
    category: "Reading Verdicts",
    title: "Long-Term Outlook (the Verdict page)",
    tags: ["verdict", "long term", "buy and hold", "outlook"],
    body: (
      <>
        <P>Different question than Trigger Check: should I <em>own this for years</em>? The page shows a 0–100 composite score on an SVG ring gauge plus the contributing factor breakdown.</P>
        <P>The composite is weighted across Fundamental (30%), Institutional Flow (25%), Stress Resilience (15%), Insider (10%), and one additional factor. A stress-test table compares the ticker against SPY/Nasdaq/Gold/Silver across historical event windows so you can see how it actually held up in past drawdowns.</P>
      </>
    ),
  },

  {
    id: "track-record",
    type: "how-to",
    category: "Reading Verdicts",
    title: "Audit the system with Track Record",
    tags: ["track record", "audit", "performance", "forward"],
    body: (
      <>
        <P>Two tabs:</P>
        <Bullets>
          <li><B>Live Signals</B> — every signal Stockotter has logged, the forward 7/30/90-day return on each, win rate per signal-strength bracket, and Best/Worst calls.</li>
          <li><B>Backtest</B> — replay strategy gates against a chosen ticker/window.</li>
        </Bullets>
        <P>The Live tab compares against SPY as a baseline — alpha = avg signal return − avg SPY return over the same windows. Designed for transparency, not promotion.</P>
      </>
    ),
  },

  // ════════════════════════════════════════════════════════════════════════
  //  CALCULATORS
  // ════════════════════════════════════════════════════════════════════════

  {
    id: "options-calculator",
    type: "how-to",
    category: "Calculators",
    title: "Options Calculator — what each section does",
    tags: ["options", "calculator", "spreads", "risk"],
    body: (
      <>
        <P>Four panels stacked on the Options Calculator page:</P>
        <Bullets>
          <li><B>Risk Calculator</B> — how many contracts you can take without exceeding your risk-per-trade % of account. Output: max risk $ and max contracts.</li>
          <li><B>Vertical Spread Expectancy</B> — long-run profit/loss on a credit or debit spread given probability of expiring OTM. Positive = mathematical edge.</li>
          <li><B>Defined Risk/Reward</B> — exact dollar expectancy over 100 trades, factoring in commissions. Includes a Target Exits table (50%/65%/75% of max).</li>
          <li><B>Weighted Price</B> — averages multiple legs in and out so cost basis stays correct when scaling.</li>
        </Bullets>
        <P>Sign convention for prices: credit spreads = positive (money in), debit spreads = negative (money out).</P>
      </>
    ),
  },

  {
    id: "greeks-calculator",
    type: "how-to",
    category: "Calculators",
    title: "Greeks Calculator",
    tags: ["greeks", "delta", "gamma", "theta", "vega", "rho"],
    body: (
      <>
        <P>Enter strike, expiry, underlying price, IV, and rate. Returns delta, gamma, theta, vega, rho per leg plus position aggregates if you stack legs (e.g. a vertical or condor).</P>
      </>
    ),
  },

  {
    id: "kelly-criterion",
    type: "how-to",
    category: "Calculators",
    title: "Kelly Criterion (position sizing)",
    tags: ["kelly", "sizing", "bankroll", "fraction"],
    body: (
      <>
        <P>Enter your edge (win % above 50, or expected return), win/loss ratio, and bankroll. The calculator returns the Kelly fraction — the bet size that maximizes long-run growth.</P>
        <P>Most traders use <B>half-Kelly</B> to reduce drawdown variance; the page shows both for comparison.</P>
      </>
    ),
  },

  {
    id: "wheel-calculator",
    type: "how-to",
    category: "Calculators",
    title: "Wheel Strategy calculator",
    tags: ["wheel", "csp", "covered call", "assignment"],
    body: (
      <>
        <P>Inputs: stock price, put strike + premium, call strike + premium (post-assignment), DTE, contracts.</P>
        <P>Outputs: put-cycle return, call-cycle return, full-wheel return (annualized), cost basis if assigned, capital required, max loss, and a payoff chart overlaying CSP-only vs. full-wheel P/L.</P>
        <P>The <B>Setup Quality</B> score is a 0–100 sanity check across five heuristics (put below stock, call above cost basis, put yield &gt; 10% annualized, capital &lt; 25% of account, DTE 21–45). 80%+ is a clean setup.</P>
        <P><B>Don't wheel</B> on pre-earnings, biotech binaries, small-caps, meme stocks, or anything with a pending regulatory decision — the wheel's catastrophic risk is a gap-down on a stock you'd never want to own.</P>
      </>
    ),
  },

  // ════════════════════════════════════════════════════════════════════════
  //  AUTO-TRADERS
  // ════════════════════════════════════════════════════════════════════════

  {
    id: "kairos-overview",
    type: "how-to",
    category: "Auto-Traders",
    title: "KAIROS — paper-trading bot",
    tags: ["kairos", "auto", "bot", "paper", "htf", "bbtc"],
    body: (
      <>
        <P>KAIROS runs the HTF (High Tight Flag) breakout detector and the BBTC trend follower natively — same algorithms backtested in Stockotter, executed live as paper trades. Currently paper-only.</P>
        <P>Loop:</P>
        <Steps>
          <li><B>Watch</B>: hourly, pull the watchlist from Stockotter's top HTF setups.</li>
          <li><B>Scan</B>: every 30 min, pull OHLCV per ticker, run HTF + BBTC.</li>
          <li><B>Trigger</B>: open a paper position when either strategy fires; tag the entry <Code>HTF</Code> / <Code>BBTC</Code> / <Code>BOTH</Code>.</li>
          <li><B>Size</B>: fixed % of paper equity per trade (default 2%, configurable).</li>
          <li><B>Manage</B>: HTF uses flag-low × 0.98 stop + measure-rule target; BBTC uses ATR-based hard + trailing stops.</li>
          <li><B>Exit</B>: close on stop, target, or strategy-specific signal flip.</li>
        </Steps>
        <P>The /kairos page shows account equity, watchlist (auto-filtered to exclude tickers already in open positions), open positions, recent trades, and a Goal editor that hot-reloads <Code>goal.yaml</Code> on the bot's next tick.</P>
      </>
    ),
  },

  {
    id: "kairos-config",
    type: "how-to",
    category: "Auto-Traders",
    title: "Tune KAIROS bot config",
    tags: ["kairos", "config", "goal.yaml", "tune"],
    body: (
      <>
        <P>The Goal editor on /kairos lets you change starting equity, position-size %, min HTF score, Sharpe target, and refresh cadence. Inputs are in user-friendly units (percent as 2.0, not 0.02); the server converts to the bot's decimal format on save.</P>
        <P>Changes hot-reload — the bot picks them up on its next loop tick (≤ 30 min by default).</P>
      </>
    ),
  },

  {
    id: "hermes-overview",
    type: "how-to",
    category: "Auto-Traders",
    title: "HERMES — RSI-dip auto-trader",
    tags: ["hermes", "rsi", "auto", "bot", "paper"],
    body: (
      <>
        <P>HERMES is an experimental auto-trader for stocks and crypto. It watches an asset list every minute and looks for oversold dips using RSI. Paper mode only.</P>
        <Steps>
          <li>Every 60 seconds, fetch price + RSI for each asset.</li>
          <li>When RSI drops below the threshold (default 30 = oversold), open a long.</li>
          <li>Size scales inversely with volatility — calmer assets get bigger bets.</li>
          <li>Exit when price drops past the stop-loss (default −2%) OR rallies to 2× stop (+4%).</li>
        </Steps>
        <P>The dashboard shows account equity, per-asset RSI/volatility/position size, an equity curve, and a recent-trades table. State refreshes every ~15 seconds from the bot's heartbeat files via the internal Express proxy.</P>
        <Note>Don't add tickers with earnings within ~2 weeks — a gap-down through both the entry trigger and the stop in one candle can blow through the −2% rule and print larger losses.</Note>
      </>
    ),
  },

  {
    id: "wheel-page",
    type: "how-to",
    category: "Auto-Traders",
    title: "Wheel Strategy page",
    tags: ["wheel", "csp", "covered call"],
    body: (
      <>
        <P>Page surfaces the mechanics of the wheel: sell cash-secured put → if assigned, sell covered call → rinse. Inputs and outputs match the Wheel Calculator (see Calculators section). No bot — this is an analytical / planning page only.</P>
      </>
    ),
  },

  {
    id: "markov-page",
    type: "how-to",
    category: "Auto-Traders",
    title: "Markov Strategy page",
    tags: ["markov", "regime", "hmm"],
    body: (
      <>
        <P>Experimental Hidden Markov Model regime classifier with a backtester. Classifies market regimes (e.g. "low-vol uptrend" vs. "high-vol selloff"), sizes positions per regime, and replays the strategy over a chosen window. The full Python implementation is queued; the page renders the final UI shape with offline state until the service is live.</P>
        <Note>Regime classification lags 5–10 trading days. Use multi-year windows — single-year tests are too noisy for this model.</Note>
      </>
    ),
  },

  // ════════════════════════════════════════════════════════════════════════
  //  DASHBOARD
  // ════════════════════════════════════════════════════════════════════════

  {
    id: "dashboard-overview",
    type: "how-to",
    category: "Dashboard",
    title: "What's on the Dashboard",
    tags: ["dashboard", "widgets", "morning"],
    body: (
      <>
        <P>The dashboard is your morning workspace. Default stack, top to bottom:</P>
        <Bullets>
          <li><B>Morning Brief</B> — what changed overnight.</li>
          <li><B>Action Queue</B> + <B>Morning Checklist</B> — your today list.</li>
          <li><B>Position News</B> + <B>Position Insiders</B> — context on what you're already in.</li>
          <li><B>Insider B/S Ratio</B> + <B>Insider Clusters</B> — broader insider context.</li>
          <li><B>Ask Otter</B> (full width, bottom) — conversational queries.</li>
        </Bullets>
      </>
    ),
  },

  {
    id: "dashboard-customize",
    type: "how-to",
    category: "Dashboard",
    title: "Customize / reset dashboard layout",
    tags: ["dashboard", "customize", "reset", "layout"],
    body: (
      <>
        <P>Click <B>Customize</B> (top-right of the dashboard) to enable drag-to-rearrange, hide/show, and add widgets. Click again ("Done") to lock.</P>
        <P>When Customize is on, the <B>Reset to default</B> button appears next to it. Clicking it (with confirmation) drops your saved layout server-side; the next page load uses the canonical default. Use this whenever a new default layout ships and you want to adopt it.</P>
      </>
    ),
  },

  {
    id: "market-pulse-page",
    type: "how-to",
    category: "Dashboard",
    title: "Read Market Pulse",
    tags: ["market pulse", "macro", "regime", "vix"],
    body: (
      <>
        <P>One-line answer to "is the environment hostile, neutral, or favorable?" The headline tier is one of: <B>RISK-OFF</B>, <B>DEFENSIVE</B>, <B>NEUTRAL</B>, <B>RISK-ON</B>, <B>EUPHORIC</B>.</P>
        <P>Computed from VIX + percentile, breadth (% above 50d/200d MA), new 52-week highs vs. lows, junk-vs-IG credit ratio (HYG/LQD), SPY/TLT ratio, major-index returns, and gold/silver/ratio. Refetches every 60 seconds.</P>
      </>
    ),
  },

  // ════════════════════════════════════════════════════════════════════════
  //  VERDICTS & SCORES (glossary)
  // ════════════════════════════════════════════════════════════════════════

  {
    id: "score-main-100",
    type: "what-it-means",
    category: "Verdicts & Scores",
    title: "Main analyst score (0–100)",
    tags: ["score", "verdict", "100", "analyze"],
    body: (
      <>
        <P>Weighted average of 11 categories on a 0–10 scale, multiplied by 10 for display.</P>
        <Bullets>
          <li>Institutional Flow — 15%</li>
          <li>Business Quality, Balance Sheet, Performance — 10% each</li>
          <li>Insider Confidence, Analyst Consensus — 10% each</li>
          <li>Income Strength — 8%</li>
          <li>Valuation — 8%</li>
          <li>Income Quality, Thesis Durability — 7% each</li>
          <li>Liquidity — 5%</li>
        </Bullets>
        <P>Missing-data categories are dropped and remaining weights renormalize so under-covered tickers aren't penalized.</P>
      </>
    ),
  },

  {
    id: "score-verdict-labels",
    type: "what-it-means",
    category: "Verdicts & Scores",
    title: "Verdict label thresholds",
    tags: ["verdict", "label", "strong conviction", "investment grade", "speculative", "high risk"],
    body: (
      <>
        <div className="space-y-1">
          <ScoreRow range="85 – 100" label="STRONG CONVICTION" tone="bull" />
          <ScoreRow range="70 – 84" label="INVESTMENT GRADE" tone="bull" />
          <ScoreRow range="55 – 69" label="SPECULATIVE" tone="watch" />
          <ScoreRow range="0 – 54" label="HIGH RISK" tone="bear" />
        </div>
      </>
    ),
  },

  {
    id: "score-htf-quality",
    type: "what-it-means",
    category: "Verdicts & Scores",
    title: "HTF setup quality score (0–100)",
    tags: ["htf", "quality", "score", "pole", "flag"],
    body: (
      <>
        <P>Starts at 50, adjusted by:</P>
        <Bullets>
          <li><B>Pole gain</B>: +15 (≥100%), +10 (≥60%), +5 (≥30%)</li>
          <li><B>Flag duration</B>: +10 (≥10 days), +5 (≥5 days)</li>
          <li><B>Flag pullback</B> (lower is tighter): +10 (≤10%), +5 (≤15%)</li>
          <li><B>Breakout volume ratio</B>: +15 (≥2.0×), +10 (≥1.5×), +5 (≥1.3×)</li>
        </Bullets>
        <P>Clamped 0–100. Overhead resistance is detected and surfaced info-only — it does <em>not</em> change the score.</P>
      </>
    ),
  },

  {
    id: "score-insider-conviction",
    type: "what-it-means",
    category: "Verdicts & Scores",
    title: "Insider conviction score (0–100)",
    tags: ["insider", "conviction", "cluster", "sponsor"],
    body: (
      <>
        <P>Per-cluster (3+ insiders within a 14-day window). Starts at 50, adjusted by:</P>
        <Bullets>
          <li><B>Breadth</B> — more distinct insiders: +15 (≥7), +10 (≥5), +5 (≥4)</li>
          <li><B>Concentration</B> (top insider's share of total $): +15 if &lt;40%, +5 if &lt;55%, −5 if &gt;65%, −20 if &gt;80%, −30 if &gt;95%</li>
          <li><B>Dollar size</B>: +10 (≥$25M), +5 (≥$5M), −10 (&lt;$250K)</li>
        </Bullets>
        <P>The concentration penalty is what surfaces "MRP-style organic clusters" (many roughly-equal buyers) above "sponsor floods" (one huge buyer at IPO + a few token directors).</P>
      </>
    ),
  },

  {
    id: "score-trigger-check",
    type: "what-it-means",
    category: "Verdicts & Scores",
    title: "Trigger Check verdict logic",
    tags: ["trigger check", "go", "caution", "no", "conviction", "verdict"],
    body: (
      <>
        <P>Aggregates 8 checks; each returns pass/warn/fail/skip with a weight. Decision rules:</P>
        <Bullets>
          <li><B>INSUFFICIENT_DATA</B> — every check skipped (no data).</li>
          <li><B>NO</B> — any single check with weight ≥ 3 fails, OR fail count &gt; pass count.</li>
          <li><B>CAUTION</B> — at least one fail (regardless of weight), OR warn count ≥ pass count.</li>
          <li><B>GO</B> — passes outnumber warns and zero fails.</li>
        </Bullets>
        <P>The 8 checks: Trend Stack, RSI Zone, HTF Setup, Insider Activity, Dealer Flow, Earnings Proximity, Fundamentals, Market Regime.</P>
      </>
    ),
  },

  // ════════════════════════════════════════════════════════════════════════
  //  STRATEGIES (glossary)
  // ════════════════════════════════════════════════════════════════════════

  {
    id: "strategy-bbtc",
    type: "what-it-means",
    category: "Strategies",
    title: "BBTC — trend follower",
    tags: ["bbtc", "trend", "ema", "atr", "trail"],
    body: (
      <>
        <P>Long-only trend follower (pivoted 2026-05-08 to state-based, no profit target — stops run the gains).</P>
        <P><B>Entry</B> (all must hold):</P>
        <Bullets>
          <li>EMA9 &gt; EMA21 (short stack aligned)</li>
          <li>Close &gt; EMA50 (above intermediate trend)</li>
          <li>ADX ≥ 20 (trend has strength)</li>
          <li>RSI &lt; 65 (or &lt; 75 if turning up from a pullback)</li>
          <li>SMA200 regime OK (price above or SMA rising)</li>
        </Bullets>
        <P><B>Exit</B>:</P>
        <Bullets>
          <li><B>Hard stop</B> = entry − 2.5 × ATR</li>
          <li><B>Trail stop</B> = peak − 3.0 × ATR</li>
          <li><B>SELL signal</B> = EMA9 &lt; EMA21 AND close &lt; EMA50</li>
        </Bullets>
        <P>Strategy id in the registry: <Code>bbtc-ver</Code> (BBTC always runs paired with VER).</P>
      </>
    ),
  },

  {
    id: "strategy-ver",
    type: "what-it-means",
    category: "Strategies",
    title: "VER — volume exhaustion reversal",
    tags: ["ver", "reversal", "rsi divergence", "bollinger"],
    body: (
      <>
        <P>RSI-divergence reversal at Bollinger extremes. Long trades only (short side demoted to info-only 2026-05-08 — it lost across every backtested window).</P>
        <P><B>Long entry</B>:</P>
        <Bullets>
          <li>Higher-low RSI divergence (lookback 5–20 bars)</li>
          <li>Volume ≥ 2× the 20-bar average (exhaustion spike)</li>
          <li>Price touched lower Bollinger band AND closed back inside</li>
          <li>RSI &lt; 35 = <Code>BUY</Code> (tradeable); RSI 35–45 = <Code>WATCH_BUY</Code> (info-only)</li>
        </Bullets>
        <P><B>Stops</B>: long = entry × 0.93 OR entry − 2×ATR (whichever is tighter).</P>
      </>
    ),
  },

  {
    id: "strategy-amc",
    type: "what-it-means",
    category: "Strategies",
    title: "AMC — Adaptive Momentum Confluence",
    tags: ["amc", "momentum", "confluence", "macd", "vami"],
    body: (
      <>
        <P>Five-condition confluence score (0–5).</P>
        <P><B>Score conditions</B>:</P>
        <Bullets>
          <li>MACD histogram &gt; 0 and accelerating</li>
          <li>RSI between 45 and 65</li>
          <li>Close &gt; ShortEMA &gt; LongEMA (stack aligned)</li>
          <li>VAMI &gt; 0 and rising (volume-adjusted momentum)</li>
          <li>|ShortEMA − RefEMA| / close &gt; 0.5% (real trend separation, not noise)</li>
        </Bullets>
        <P><B>Entry</B>: momentum entry when score ≥ 4 + green close; reversion entry on RSI &lt; 30 + price near reference + VAMI rising + green close.</P>
        <P><B>Exit</B>: RSI &gt; 75, OR MACD histogram flips negative (was ≥ 0 prior bar).</P>
      </>
    ),
  },

  {
    id: "strategy-htf",
    type: "what-it-means",
    category: "Strategies",
    title: "HTF — High Tight Flag",
    tags: ["htf", "high tight flag", "pole", "flag", "givens"],
    body: (
      <>
        <P>Pole + flag + breakout pattern detector (Givens-loosened version).</P>
        <P><B>Entry conditions</B>:</P>
        <Bullets>
          <li><B>Pole</B>: 30%+ gain in 5–60 days.</li>
          <li><B>Flag</B>: 3–30 day consolidation, ≤ 25% pullback from pole peak.</li>
          <li><B>Breakout</B>: close &gt; flag high + 0.1% on volume ≥ 1.0× the 30-bar avg (vol gate dropped from 1.3× on 2026-05-20 — light-volume HTFs outperformed in the Bulkowski stats).</li>
        </Bullets>
        <P><B>Exit / management</B>:</P>
        <Bullets>
          <li>Hard stop = flag low × 0.98.</li>
          <li>Take 1/3 after 3 cumulative close-strength days (close &gt; entry × 1.05).</li>
          <li>Trail the remaining 2/3 below the 20-MA after partial exit.</li>
        </Bullets>
      </>
    ),
  },

  {
    id: "strategy-tft",
    type: "what-it-means",
    category: "Strategies",
    title: "TFT — Two-layer Trend Follower (40W / 60W / Catastrophic)",
    tags: ["tft", "trend follower", "40w", "60w", "catastrophic", "tactical"],
    body: (
      <>
        <P>Two-layer architecture:</P>
        <Bullets>
          <li><B>CORE</B> — 1.0 unit held on regime confirmation. Exits only on weekly SMA break or −15% catastrophic.</li>
          <li><B>TACTICAL</B> — 0.5-unit adds on BBTC/VER signals while CORE is bullish; 5× ATR trail on the add.</li>
        </Bullets>
        <P><B>Regime gating</B>: bullish = weekly close &gt; 40W SMA AND SMA rising 4 consecutive weeks. 2 weekly closes required to flip (whipsaw guard).</P>
        <P>Three variants in the registry:</P>
        <Bullets>
          <li><Code>tft-40w</Code> — core exits on weekly close below 40W SMA.</li>
          <li><Code>tft-60w</Code> — core exits on weekly close below 60W SMA (slower, fewer exits).</li>
          <li><Code>tft-cat</Code> — core only exits on −15% catastrophic stop ("moonshot" mode).</li>
        </Bullets>
      </>
    ),
  },

  {
    id: "strategy-bbtc-ver",
    type: "what-it-means",
    category: "Strategies",
    title: "BBTC+VER — combination",
    tags: ["bbtc-ver", "combo", "shared exit"],
    body: (
      <>
        <P>The registry treats BBTC and VER as one strategy id (<Code>bbtc-ver</Code>) because they share an exit framework. Either side can fire the entry; once open, the exits are:</P>
        <Bullets>
          <li><B>Hard stop</B> = entry × (1 − 8%)</li>
          <li><B>Trail stop</B> = highest close × (1 − 10%)</li>
          <li><B>Active stop</B> = max(hard, trail)</li>
        </Bullets>
      </>
    ),
  },

  {
    id: "strategy-insider-trigger",
    type: "what-it-means",
    category: "Strategies",
    title: "Insider Trigger",
    tags: ["insider", "trigger", "mrp", "form 4"],
    body: (
      <>
        <P>Entry on an organic insider conviction cluster (MRP-style multi-insider buy on the /insiders page, NOT IPO sponsor flood). Buy the day after the Form 4 files. The reason field captures filing date + insider name(s) for auditability.</P>
        <P>Exits are identical to BBTC+VER (8% hard / 10% trail). Registry id: <Code>insider-trigger</Code>.</P>
      </>
    ),
  },

  // ════════════════════════════════════════════════════════════════════════
  //  INDICATORS (glossary)
  // ════════════════════════════════════════════════════════════════════════

  {
    id: "indicator-rsi",
    type: "what-it-means",
    category: "Indicators",
    title: "RSI — Relative Strength Index",
    tags: ["rsi", "momentum", "overbought", "oversold"],
    body: (
      <>
        <P>Momentum oscillator between 0 and 100. Two common reads:</P>
        <Bullets>
          <li><B>Levels</B>: &gt; 70 overbought, &lt; 30 oversold.</li>
          <li><B>Divergence</B>: price makes a new high but RSI makes a lower high (bearish), or new low + higher RSI low (bullish) — VER strategy uses this.</li>
        </Bullets>
        <P>Default lookback is 14 bars throughout Stockotter.</P>
      </>
    ),
  },

  {
    id: "indicator-macd",
    type: "what-it-means",
    category: "Indicators",
    title: "MACD — Moving Average Convergence Divergence",
    tags: ["macd", "histogram", "momentum", "crossover"],
    body: (
      <>
        <P>Difference between a fast EMA and slow EMA, plus a signal-line EMA of that difference. The <B>histogram</B> = MACD − signal; AMC uses histogram acceleration as a confluence factor.</P>
      </>
    ),
  },

  {
    id: "indicator-ema",
    type: "what-it-means",
    category: "Indicators",
    title: "EMA — Exponential Moving Average",
    tags: ["ema", "moving average", "9", "21", "50", "200"],
    body: (
      <>
        <P>Moving average weighted toward recent bars (more reactive than SMA). Stockotter uses a consistent set everywhere:</P>
        <Bullets>
          <li><B>EMA 9</B> — green (fast)</li>
          <li><B>EMA 21</B> — orange</li>
          <li><B>EMA 50</B> — cyan</li>
          <li><B>SMA 200</B> — purple</li>
          <li><B>SMA 20</B> — amber (HTF trail line)</li>
        </Bullets>
      </>
    ),
  },

  {
    id: "indicator-atr",
    type: "what-it-means",
    category: "Indicators",
    title: "ATR — Average True Range",
    tags: ["atr", "volatility", "stop", "sizing"],
    body: (
      <>
        <P>Volatility measure — the average true range of the last N bars. Used for stop placement (e.g. <Code>entry − 2.5 × ATR</Code> for BBTC hard stops) so the stop scales with how jumpy the ticker is.</P>
      </>
    ),
  },

  {
    id: "indicator-adx",
    type: "what-it-means",
    category: "Indicators",
    title: "ADX — Average Directional Index",
    tags: ["adx", "trend strength", "directional"],
    body: (
      <>
        <P>Measures the strength of a trend (not its direction). 0–100 scale; BBTC requires ≥ 20 to qualify as a real trend rather than chop.</P>
      </>
    ),
  },

  {
    id: "indicator-bollinger",
    type: "what-it-means",
    category: "Indicators",
    title: "Bollinger Bands",
    tags: ["bollinger", "bands", "volatility", "squeeze"],
    body: (
      <>
        <P>A middle SMA (default 20) plus upper/lower bands at ±2 standard deviations. <B>Touching</B> a band ≠ "reversal" — it's a statistical extreme. VER requires a touch + close back inside as part of its entry. <B>Squeeze</B> = bands tighten (low volatility) — often precedes a breakout.</P>
      </>
    ),
  },

  {
    id: "indicator-vami",
    type: "what-it-means",
    category: "Indicators",
    title: "VAMI — Volume-Adjusted Momentum Index",
    tags: ["vami", "volume", "momentum"],
    body: (
      <>
        <P>Custom AMC input — momentum weighted by relative volume. Rising VAMI means momentum is being confirmed by volume, not happening on light tape.</P>
      </>
    ),
  },

  // ════════════════════════════════════════════════════════════════════════
  //  PATTERNS (glossary)
  // ════════════════════════════════════════════════════════════════════════

  {
    id: "pattern-htf-anatomy",
    type: "what-it-means",
    category: "Patterns",
    title: "HTF pattern anatomy (pole / flag / breakout)",
    tags: ["htf", "pole", "flag", "breakout", "anatomy"],
    body: (
      <>
        <P>Three pieces:</P>
        <Bullets>
          <li><B>Pole</B> — vertical run, 30%+ gain in 5–60 days. The "rocket".</li>
          <li><B>Flag</B> — sideways consolidation, 3–30 days, ≤ 25% pullback. Buyers digesting the gain.</li>
          <li><B>Breakout</B> — close above the flag high on real volume (≥ 1.0× the 30-bar avg). Triggers the entry.</li>
        </Bullets>
      </>
    ),
  },

  {
    id: "pattern-throwback",
    type: "what-it-means",
    category: "Patterns",
    title: "Throwback",
    tags: ["throwback", "retest", "breakout"],
    body: (
      <>
        <P>A breakout that pulls back to retest the breakout level before continuing. In HTF, throwbacks are normal — the system measures from the original breakout, not the throwback bottom.</P>
      </>
    ),
  },

  {
    id: "pattern-trail-stop",
    type: "what-it-means",
    category: "Patterns",
    title: "Trail stop / hard stop / active stop",
    tags: ["stop", "trail", "hard", "active"],
    body: (
      <>
        <P><B>Hard stop</B> — fixed-price exit set at entry (e.g. entry − 8% or entry − 2.5×ATR). Doesn't move.</P>
        <P><B>Trail stop</B> — exit that moves up with the trade (e.g. highest close − 10%). Locks in gains as the trade runs.</P>
        <P><B>Active stop</B> — whichever of the two is higher right now. The "real" stop you'd actually exit on.</P>
      </>
    ),
  },

  // ════════════════════════════════════════════════════════════════════════
  //  INSIDER & INSTITUTIONAL (glossary)
  // ════════════════════════════════════════════════════════════════════════

  {
    id: "insider-bs-ratio",
    type: "what-it-means",
    category: "Insider & Institutional",
    title: "Buy/Sell ratio (raw vs. discretionary)",
    tags: ["b/s", "buy sell ratio", "discretionary", "10b5-1"],
    body: (
      <>
        <P><B>Raw B/S</B> = total dollar value of insider buys ÷ total dollar value of insider sells over the window. &gt; 1.5 = strong buying, 0.66–1.5 = balanced, &lt; 0.66 = selling.</P>
        <P><B>Discretionary B/S</B> strips out 10b5-1 planned sales — pre-scheduled tax-advantaged selling that doesn't reflect insider conviction. When raw and discretionary disagree (raw 0.4 / disc. 1.2), trust the discretionary read — that's what insiders are actually choosing to do.</P>
      </>
    ),
  },

  {
    id: "insider-10b5-1",
    type: "what-it-means",
    category: "Insider & Institutional",
    title: "10b5-1 plans",
    tags: ["10b5-1", "planned", "rule 10b5"],
    body: (
      <>
        <P>SEC rule that lets insiders schedule trades in advance to avoid insider-trading liability. A sale flagged as 10b5-1 was pre-scheduled — not a same-day conviction call. Stockotter parses Form 4 footnotes via a separate hourly cron and tags planned sales separately.</P>
      </>
    ),
  },

  {
    id: "insider-form4",
    type: "what-it-means",
    category: "Insider & Institutional",
    title: "Form 4",
    tags: ["form 4", "sec", "edgar", "filing"],
    body: (
      <>
        <P>SEC filing for insider transactions (officers, directors, 10%+ shareholders). Filed within 2 business days of the transaction. Stockotter pulls Form 4 XML directly from EDGAR for the 10b5-1 flag, on top of the FMP aggregate feed.</P>
      </>
    ),
  },

  {
    id: "insider-cluster-flags",
    type: "what-it-means",
    category: "Insider & Institutional",
    title: "Cluster flags (broad-cluster / sponsor-pattern / etc.)",
    tags: ["cluster", "broad", "sponsor", "single-dominant", "top-heavy"],
    body: (
      <>
        <Bullets>
          <li><B>broad-cluster</B> — 5+ insiders, no single dominant buyer. Bullish signal.</li>
          <li><B>high-dollar</B> — total cluster dollar size meaningful (≥ $5M / ≥ $25M).</li>
          <li><B>sponsor-pattern</B> / <B>single-dominant</B> — one insider is ≥ 80–95% of cluster dollars. Often IPO sponsor or strategic investor, not organic conviction.</li>
          <li><B>top-heavy</B> — top insider is 65–80% of the cluster. Weaker signal than broad-cluster.</li>
          <li><B>low-dollar</B> — cluster total below the meaningful threshold (&lt; $250K).</li>
        </Bullets>
      </>
    ),
  },

  {
    id: "inst-13f",
    type: "what-it-means",
    category: "Insider & Institutional",
    title: "13F (institutional holdings)",
    tags: ["13f", "institutional", "holdings", "sec"],
    body: (
      <>
        <P>Quarterly SEC filing required of institutional managers with &gt; $100M AUM. Discloses long equity positions only (no shorts, no options short side). 45-day reporting lag means 13F data is always stale — read it as a slow-moving direction sign, not a real-time signal.</P>
      </>
    ),
  },

  {
    id: "inst-flow-score",
    type: "what-it-means",
    category: "Insider & Institutional",
    title: "Institutional Flow Score",
    tags: ["flow", "score", "institutional", "accumulation"],
    body: (
      <>
        <P>Directional measure: <Code>(Inflow − Outflow) / Total Flow × 100</Code>, plus an insider bonus.</P>
        <Bullets>
          <li><B>STRONG INFLOW</B> — heavy accumulation.</li>
          <li><B>ACCUMULATING</B> — net buying.</li>
          <li><B>DISTRIBUTING</B> — net selling.</li>
          <li><B>STRONG OUTFLOW</B> — heavy distribution.</li>
        </Bullets>
      </>
    ),
  },

  // ════════════════════════════════════════════════════════════════════════
  //  OPTIONS TERMINOLOGY (glossary)
  // ════════════════════════════════════════════════════════════════════════

  {
    id: "options-credit-vs-debit",
    type: "what-it-means",
    category: "Options Terminology",
    title: "Credit vs. debit spread",
    tags: ["credit", "debit", "spread", "premium"],
    body: (
      <>
        <P><B>Credit spread</B> — you sell the more expensive option and buy a cheaper one as protection; net premium is positive (you collect money). Profits if the spread expires worthless. PCS (put credit spread) and CCS (call credit spread) are the common ones.</P>
        <P><B>Debit spread</B> — you buy the more expensive option and sell a cheaper one to offset cost; net premium is negative (you pay money). Profits if the move happens. CDS (call debit spread) and PDS (put debit spread).</P>
        <P>In Trade Tracker, sign convention is: credit = positive open price, debit = negative.</P>
      </>
    ),
  },

  {
    id: "options-iv",
    type: "what-it-means",
    category: "Options Terminology",
    title: "IV — Implied Volatility",
    tags: ["iv", "implied volatility", "vega"],
    body: (
      <>
        <P>The market's expected volatility derived from option prices. High IV = expensive options (premium sellers happy, premium buyers paying up). IV rises into earnings and resets after.</P>
      </>
    ),
  },

  {
    id: "options-greeks",
    type: "what-it-means",
    category: "Options Terminology",
    title: "The Greeks (Delta, Gamma, Theta, Vega, Rho)",
    tags: ["greeks", "delta", "gamma", "theta", "vega", "rho"],
    body: (
      <>
        <Bullets>
          <li><B>Delta</B> — change in option price per $1 move in the underlying. Calls 0 → 1, puts 0 → −1. Also a rough probability of expiring ITM.</li>
          <li><B>Gamma</B> — change in delta per $1 move. Highest near the strike at expiry; what makes 0DTE math weird.</li>
          <li><B>Theta</B> — daily decay. Negative for long options (you lose value as time passes), positive for short.</li>
          <li><B>Vega</B> — change in option price per 1% change in IV. Long options benefit from IV expansion.</li>
          <li><B>Rho</B> — sensitivity to interest rate. Usually small enough to ignore on short-dated options.</li>
        </Bullets>
      </>
    ),
  },

  {
    id: "options-pop",
    type: "what-it-means",
    category: "Options Terminology",
    title: "POP — Probability of Profit",
    tags: ["pop", "probability", "profit", "otm"],
    body: (
      <>
        <P>Broker estimate of the chance a trade closes profitable. For credit spreads, this is roughly the probability the short strike expires OTM. Used in the Defined Risk/Reward calculator and the Vertical Spread Expectancy panel.</P>
      </>
    ),
  },

  {
    id: "options-dte",
    type: "what-it-means",
    category: "Options Terminology",
    title: "DTE — Days to Expiration",
    tags: ["dte", "expiration", "days"],
    body: (
      <>
        <P>Calendar days until the option expires. 21–45 DTE is the theta-decay sweet spot most strategies (wheel, premium-selling spreads) target.</P>
      </>
    ),
  },

  // ════════════════════════════════════════════════════════════════════════
  //  MARKET MECHANICS (glossary)
  // ════════════════════════════════════════════════════════════════════════

  {
    id: "mm-gex",
    type: "what-it-means",
    category: "Market Mechanics",
    title: "GEX — Gamma Exposure",
    tags: ["gex", "gamma exposure", "dealer", "mm"],
    body: (
      <>
        <P>Aggregate gamma position of options dealers. <B>Positive GEX</B> — dealers are long gamma; they hedge by selling rallies / buying dips, which damps volatility. <B>Negative GEX</B> — dealers are short gamma; they hedge by buying rallies / selling dips, which amplifies volatility (the "vanna/charm" trap).</P>
        <P>Stockotter's GEX is computed from open interest × gamma × per-strike premium impact.</P>
      </>
    ),
  },

  {
    id: "mm-walls",
    type: "what-it-means",
    category: "Market Mechanics",
    title: "Call wall / put wall",
    tags: ["call wall", "put wall", "magnet", "resistance"],
    body: (
      <>
        <P>Strikes with extreme open interest. Price often gravitates toward / stalls at these walls because dealer hedging dynamics around them create real flow. Call wall = upside cap (heavy call OI → dealers sell into it). Put wall = downside support.</P>
      </>
    ),
  },

  {
    id: "mm-max-pain",
    type: "what-it-means",
    category: "Market Mechanics",
    title: "Max pain",
    tags: ["max pain", "expiration", "pinning"],
    body: (
      <>
        <P>The strike at which the most option contracts expire worthless, weighted by open interest. Folklore says price often "pins" to max pain near big expirations; the empirical effect is real but small except in heavily-shorted single-day situations.</P>
      </>
    ),
  },

  {
    id: "mm-gamma-flip",
    type: "what-it-means",
    category: "Market Mechanics",
    title: "Gamma flip",
    tags: ["gamma flip", "negative gamma", "regime"],
    body: (
      <>
        <P>The price level where dealer gamma flips from positive to negative. Above the flip = vol-damping regime; below = vol-amplifying regime. Crossing the flip line is a regime change — Stockotter surfaces an alert when it happens.</P>
      </>
    ),
  },

  {
    id: "mm-unusual-options",
    type: "what-it-means",
    category: "Market Mechanics",
    title: "Unusual options activity (V/OI ratio)",
    tags: ["unusual options", "v/oi", "volume", "open interest"],
    body: (
      <>
        <P>When today's volume on a strike is &gt; 2× its open interest, something fresh is happening — new positioning, not existing positions trading hands. Stockotter's Unusual Options table on MM Exposure ranks by V/OI ratio.</P>
      </>
    ),
  },

  // ════════════════════════════════════════════════════════════════════════
  //  TABLE STANDARDS — meta entries
  // ════════════════════════════════════════════════════════════════════════

  {
    id: "tables-sort-filter-refresh",
    type: "how-to",
    category: "Getting Started",
    title: "Sort, filter, or refresh a table",
    tags: ["sort", "filter", "refresh", "table", "header"],
    body: (
      <>
        <P>Every standardized table on the site uses the same controls:</P>
        <Bullets>
          <li><B>Click a column header</B> to sort. Click cycles asc → desc → unsorted.</li>
          <li>Tables with a "Score" column show a <B>Min score</B> input above the table — type a number to hide rows below the threshold.</li>
          <li>Tables with live prices have a <B>Refresh</B> button in the header — click to pull fresh quotes.</li>
        </Bullets>
        <Note>Migration to the standard is in progress. If a table doesn't sort yet, that surface is on the pending list — file paths in the CHANGES.md log.</Note>
      </>
    ),
  },

];

export const HELP_CATEGORIES: HelpCategory[] = [
  // How-to
  "Getting Started",
  "Analyzing a Ticker",
  "Watchlist & Portfolio",
  "Tracking Trades",
  "Finding Setups",
  "Reading Verdicts",
  "Calculators",
  "Auto-Traders",
  "Dashboard",
  // What-it-means
  "Verdicts & Scores",
  "Strategies",
  "Indicators",
  "Patterns",
  "Insider & Institutional",
  "Options Terminology",
  "Market Mechanics",
];
