/**
 * Full view for the Dividend Calculator compartment.
 *
 * Two ticker+share input pairs, side-by-side panels rendered with the
 * exact same MiniStat grid the position-expand view on /dividend-portfolio
 * uses (Yield / Div Rate / Payout Ratio / Frequency on row 1, etc.) so
 * the comparison reads like the active portfolio. Comparison row at the
 * bottom highlights which ticker leads on Yield, Per Distribution, and
 * Yearly Total — with the dollar delta and a "leads by" label so the
 * meaning is unambiguous.
 *
 * Display ticker is sourced from the user's submitted input (not from
 * `data.symbol`) so the panel header + comparison labels are robust to
 * whatever shape the underlying provider returns.
 */
import { useState, useMemo } from "react";
import {
  Calculator, DollarSign, PiggyBank, Calendar, Loader2, AlertTriangle,
  Percent, Clock, Activity, BarChart3, TrendingUp, TrendingDown, Minus,
} from "lucide-react";
import { useDividendLookup } from "./useDividendCalculator";
import {
  computeNumbers, yieldColor, scoreColor, payoutColor,
  type DividendData, type ComputedNumbers,
} from "./dividendCalcLogic";

export function DividendCalculatorFullView() {
  const [tickerInputA, setTickerInputA] = useState("");
  const [sharesA, setSharesA] = useState<number>(100);
  const [submittedA, setSubmittedA] = useState<string | null>(null);

  const [tickerInputB, setTickerInputB] = useState("");
  const [sharesB, setSharesB] = useState<number>(100);
  const [submittedB, setSubmittedB] = useState<string | null>(null);

  const queryA = useDividendLookup(submittedA);
  const queryB = useDividendLookup(submittedB);

  const numbersA = useMemo(() => computeNumbers(queryA.data, sharesA), [queryA.data, sharesA]);
  const numbersB = useMemo(() => computeNumbers(queryB.data, sharesB), [queryB.data, sharesB]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const a = tickerInputA.trim().toUpperCase();
    const b = tickerInputB.trim().toUpperCase();
    if (a) setSubmittedA(a);
    if (b) setSubmittedB(b);
  };

  return (
    <div className="bg-card border border-card-border rounded-lg p-4 space-y-4" data-testid="dividend-calculator">
      <div className="flex items-center gap-2">
        <Calculator className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-bold text-foreground">Dividend Calculator & Comparison</h3>
        <span className="text-2xs text-muted-foreground">— look up one ticker or compare two side-by-side</span>
      </div>

      <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-3 items-end">
        <TickerSharesInput
          label="Ticker A"
          idPrefix="div-calc-a"
          ticker={tickerInputA}
          onTickerChange={setTickerInputA}
          shares={sharesA}
          onSharesChange={setSharesA}
        />
        <span className="hidden md:block text-2xs font-bold text-muted-foreground uppercase tracking-wider pb-2.5 text-center">vs</span>
        <TickerSharesInput
          label="Ticker B (optional)"
          idPrefix="div-calc-b"
          ticker={tickerInputB}
          onTickerChange={setTickerInputB}
          shares={sharesB}
          onSharesChange={setSharesB}
        />
        <div className="md:col-span-3 flex justify-center pt-1">
          <button
            type="submit"
            disabled={!tickerInputA.trim() && !tickerInputB.trim()}
            className="h-9 px-6 text-xs font-semibold rounded-md bg-primary/20 text-primary hover:bg-primary/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            data-testid="div-calc-submit"
          >
            Calculate
          </button>
        </div>
      </form>

      {(submittedA || submittedB) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3" data-testid="div-calc-panels">
          <TickerPanel slot="A" submitted={submittedA} query={queryA} shares={sharesA} numbers={numbersA} />
          <TickerPanel slot="B" submitted={submittedB} query={queryB} shares={sharesB} numbers={numbersB} />
        </div>
      )}

      {numbersA && numbersB && queryA.data && queryB.data && submittedA && submittedB && (
        <ComparisonRow
          a={{ symbol: submittedA, data: queryA.data, numbers: numbersA }}
          b={{ symbol: submittedB, data: queryB.data, numbers: numbersB }}
        />
      )}

      {!submittedA && !submittedB && (
        <p className="text-2xs text-muted-foreground">
          Enter a ticker and share count, then optionally a second ticker to compare them side-by-side. The per-distribution and annual totals are calculated at each company's current dividend rate.
        </p>
      )}
    </div>
  );
}

// ─── Inputs ───────────────────────────────────────────────────────────────────

function TickerSharesInput({ label, idPrefix, ticker, onTickerChange, shares, onSharesChange }: {
  label: string;
  idPrefix: string;
  ticker: string;
  onTickerChange: (v: string) => void;
  shares: number;
  onSharesChange: (n: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor={`${idPrefix}-ticker`} className="text-micro font-semibold text-muted-foreground uppercase tracking-wider">
          {label}
        </label>
        <input
          id={`${idPrefix}-ticker`}
          type="text"
          value={ticker}
          onChange={e => onTickerChange(e.target.value)}
          placeholder="e.g. KO"
          maxLength={10}
          className="h-9 w-28 px-2 text-xs font-mono uppercase bg-background border border-card-border rounded-md text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          data-testid={`${idPrefix}-ticker-input`}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${idPrefix}-shares`} className="text-micro font-semibold text-muted-foreground uppercase tracking-wider">
          Shares
        </label>
        <input
          id={`${idPrefix}-shares`}
          type="number"
          min={1}
          step={1}
          value={shares}
          onChange={e => onSharesChange(Math.max(0, Number(e.target.value) || 0))}
          className="h-9 w-28 px-2 text-xs font-mono bg-background border border-card-border rounded-md text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          data-testid={`${idPrefix}-shares-input`}
        />
      </div>
    </div>
  );
}

// ─── One ticker's full panel ──────────────────────────────────────────────────

type LookupQuery = ReturnType<typeof useDividendLookup>;

function TickerPanel({ slot, submitted, query, shares, numbers }: {
  slot: "A" | "B";
  submitted: string | null;
  query: LookupQuery;
  shares: number;
  numbers: ComputedNumbers | null;
}) {
  if (!submitted) {
    return (
      <div className="bg-muted/10 border border-dashed border-card-border/50 rounded-lg p-6 flex items-center justify-center text-2xs text-muted-foreground">
        Ticker {slot} — enter a second ticker above to compare
      </div>
    );
  }

  if (query.isLoading) {
    return (
      <div className="bg-card border border-card-border rounded-lg p-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Looking up {submitted}...
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="bg-card border border-card-border rounded-lg p-4 flex items-start gap-2 text-xs text-bear-light">
        <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <span>Couldn't find dividend data for <span className="font-mono font-bold">{submitted}</span>. {query.error instanceof Error ? query.error.message : ""}</span>
      </div>
    );
  }

  const data = query.data;
  if (!data) return null;

  // Greedy-bastards branch
  if (data.dividendRate <= 0) {
    return (
      <div className="bg-card border border-card-border rounded-lg p-4 space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-2xs">
          <span className="font-mono font-bold text-foreground text-xs">{submitted}</span>
          {data.companyName && <span className="text-muted-foreground">— {data.companyName}</span>}
        </div>
        <div className="flex items-start gap-2 text-xs text-watch-light">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            Sorry — <span className="font-mono font-bold">{submitted}</span>'s greedy bastards don't like to share. No dividends here.
          </span>
        </div>
      </div>
    );
  }

  if (!numbers) return null;

  return (
    <div className="bg-card border border-card-border rounded-lg p-3 space-y-3" data-testid={`div-calc-panel-${slot}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono font-bold text-foreground text-xs">{submitted}</span>
        {data.companyName && <span className="text-2xs text-muted-foreground truncate max-w-[200px]">— {data.companyName}</span>}
        <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-mini font-semibold">{data.frequency}</span>
        <span className="text-2xs text-muted-foreground">· {shares.toLocaleString()} shares</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <MiniStat label="Yield" value={`${data.dividendYield.toFixed(2)}%`} color={yieldColor(data.dividendYield)} icon={<Percent className="h-3 w-3" />} />
        <MiniStat label="Div Rate / Share" value={`$${data.dividendRate.toFixed(2)}`} color="text-foreground" icon={<DollarSign className="h-3 w-3" />} />
        <MiniStat
          label="Payout Ratio"
          value={data.payoutRatio != null ? `${data.payoutRatio.toFixed(1)}%` : "N/A"}
          color={data.payoutRatio != null ? payoutColor(data.payoutRatio) : "text-muted-foreground"}
          icon={<Activity className="h-3 w-3" />}
        />
        <MiniStat label="Frequency" value={data.frequency} color="text-primary" icon={<Clock className="h-3 w-3" />} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <MiniStat label="Payouts / Year" value={String(numbers.perYear)} color="text-foreground" icon={<Calendar className="h-3 w-3" />} />
        <MiniStat label="Ex-Dividend" value={data.exDividendDate || "N/A"} color="text-foreground" icon={<AlertTriangle className="h-3 w-3" />} />
        <MiniStat label="Distribution" value={data.distributionDate || "N/A"} color="text-foreground" icon={<Calendar className="h-3 w-3" />} subtitle="When you get paid" />
        <MiniStat
          label="5Y Avg Yield"
          value={data.fiveYearAvgYield != null ? `${data.fiveYearAvgYield.toFixed(2)}%` : "N/A"}
          color={data.fiveYearAvgYield != null && data.dividendYield > data.fiveYearAvgYield ? "text-bull-light" : "text-muted-foreground"}
          icon={<BarChart3 className="h-3 w-3" />}
          subtitle={data.fiveYearAvgYield != null && data.dividendYield > data.fiveYearAvgYield ? "Above avg" : undefined}
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <MiniStat
          label="Last Dividend"
          value={data.lastDividendValue != null ? `$${data.lastDividendValue.toFixed(4)}` : "N/A"}
          color="text-foreground"
          icon={<DollarSign className="h-3 w-3" />}
          subtitle={data.lastDividendDate || undefined}
        />
        <MiniStat
          label="Quality Score"
          value={data.score != null ? `${data.score}` : "N/A"}
          color={data.score != null ? scoreColor(data.score) : "text-muted-foreground"}
          icon={<Activity className="h-3 w-3" />}
        />
        <MiniStat
          label="Per Distribution"
          value={`$${numbers.perDistribution.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          color="text-foreground"
          icon={<PiggyBank className="h-3 w-3" />}
          subtitle={`${shares.toLocaleString()} × $${numbers.perSharePerDistribution.toFixed(4)}`}
        />
        <MiniStat
          label="Yearly Total"
          value={`$${numbers.yearly.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          color="text-bull-light"
          icon={<PiggyBank className="h-3 w-3" />}
          subtitle={`${numbers.perYear} payments / yr`}
        />
      </div>
    </div>
  );
}

// ─── Comparison row ───────────────────────────────────────────────────────────

function ComparisonRow({ a, b }: {
  a: { symbol: string; data: DividendData; numbers: ComputedNumbers };
  b: { symbol: string; data: DividendData; numbers: ComputedNumbers };
}) {
  const perDistDelta = a.numbers.perDistribution - b.numbers.perDistribution;
  const yearlyDelta = a.numbers.yearly - b.numbers.yearly;
  const yieldDelta = a.data.dividendYield - b.data.dividendYield;

  return (
    <div className="bg-muted/20 border border-card-border/60 rounded-lg p-3 space-y-2" data-testid="div-calc-comparison">
      <div className="flex items-center gap-2">
        <BarChart3 className="h-3.5 w-3.5 text-primary" />
        <h4 className="text-2xs font-bold text-foreground uppercase tracking-wider">
          <span className="font-mono">{a.symbol}</span> vs <span className="font-mono">{b.symbol}</span>
        </h4>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <DeltaRow label="Yield" aSym={a.symbol} bSym={b.symbol} delta={yieldDelta} format={v => `${v.toFixed(2)}%`} />
        <DeltaRow label="Per Distribution" aSym={a.symbol} bSym={b.symbol} delta={perDistDelta} format={v => `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} />
        <DeltaRow label="Yearly Total" aSym={a.symbol} bSym={b.symbol} delta={yearlyDelta} format={v => `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} />
      </div>
    </div>
  );
}

function DeltaRow({ label, aSym, bSym, delta, format }: {
  label: string;
  aSym: string;
  bSym: string;
  delta: number;
  format: (v: number) => string;
}) {
  const isAWin = delta > 0;
  const isBWin = delta < 0;
  const isEven = delta === 0;
  const winner = isAWin ? aSym : isBWin ? bSym : null;
  const Icon = isEven ? Minus : isAWin ? TrendingUp : TrendingDown;
  const color = isEven ? "text-muted-foreground" : "text-bull-light";

  return (
    <div className="bg-card border border-card-border/50 rounded-lg p-2">
      <div className="flex items-center gap-1 mb-0.5">
        <Icon className={`h-3 w-3 ${color}`} />
        <span className="text-mini font-semibold text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>
      {isEven ? (
        <span className="text-xs font-bold text-foreground">Even — same amount</span>
      ) : (
        <span className="text-xs font-bold text-foreground">
          <span className={`${color} font-mono`}>{winner}</span> leads by <span className="font-mono">{format(Math.abs(delta))}</span>
        </span>
      )}
    </div>
  );
}

// ─── MiniStat (page-style mini card; mirrors the position-detail grid) ───────

function MiniStat({ label, value, color, icon, subtitle }: {
  label: string; value: string; color: string; icon?: React.ReactNode; subtitle?: string;
}) {
  return (
    <div className="bg-muted/30 border border-card-border/50 rounded-lg p-2">
      <div className="flex items-center gap-1 mb-0.5">
        {icon && <span className={`${color} opacity-70`}>{icon}</span>}
        <span className="text-mini font-semibold text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>
      <span className={`text-xs font-bold tabular-nums font-mono ${color}`}>{value}</span>
      {subtitle && <span className="block text-mini text-muted-foreground">{subtitle}</span>}
    </div>
  );
}
