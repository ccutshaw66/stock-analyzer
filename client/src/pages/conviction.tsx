/**
 * Conviction / Trigger Check page.
 *
 * Replaces the original 4-axis radar Compass with a pre-trade verdict:
 * "Should I pull the trigger on this trade?" Top of the page = single-word
 * verdict (`GO` / `CAUTION` / `NO`) + one-line biggest reason. Below =
 * grouped checklist of plain-English green/yellow/red items pulling from
 * every relevant signal across Company Research + Investment Opportunities.
 *
 * Brief: see project memory `brief_trigger_check.md`.
 */

import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useTicker } from "@/contexts/TickerContext";
import { PageTemplate } from "@/components/PageTemplate";
import { HelpBlock } from "@/components/HelpBlock";
import {
  Compass, Loader2, CheckCircle2, AlertTriangle, XCircle, MinusCircle,
} from "lucide-react";

// ─── Types (mirror server/conviction/checks/types.ts) ─────────────────────

type CheckStatus = "pass" | "warn" | "fail" | "skip";
type Verdict = "GO" | "CAUTION" | "NO" | "INSUFFICIENT_DATA";

interface CheckResult {
  id: string;
  category: string;
  label: string;
  status: CheckStatus;
  reason: string;
  weight?: number;
}

interface TriggerCheckResponse {
  ticker: string;
  verdict: Verdict;
  reason: string;
  summary: { pass: number; warn: number; fail: number; skip: number };
  checks: CheckResult[];
  generatedAt: string;
}

// ─── Verdict styling ──────────────────────────────────────────────────────

const VERDICT_COPY: Record<Verdict, { label: string; tone: string; sub: string }> = {
  GO: {
    label: "GO",
    tone: "bg-bull/15 text-bull-light border-bull/40",
    sub: "Setup is clean. Conditions support pulling the trigger.",
  },
  CAUTION: {
    label: "CAUTION",
    tone: "bg-watch/15 text-watch-light border-watch/40",
    sub: "Mixed signals. Take this one only if you have a strong reason.",
  },
  NO: {
    label: "NO",
    tone: "bg-bear/15 text-bear-light border-bear/40",
    sub: "At least one big reason argues against this entry. Sit out.",
  },
  INSUFFICIENT_DATA: {
    label: "NOT ENOUGH DATA",
    tone: "bg-muted text-muted-foreground border-card-border",
    sub: "Not enough data on this ticker to make a call.",
  },
};

function StatusGlyph({ status }: { status: CheckStatus }) {
  if (status === "pass")
    return <CheckCircle2 className="h-4 w-4 text-bull-light shrink-0" />;
  if (status === "warn")
    return <AlertTriangle className="h-4 w-4 text-watch-light shrink-0" />;
  if (status === "fail")
    return <XCircle className="h-4 w-4 text-bear-light shrink-0" />;
  return <MinusCircle className="h-4 w-4 text-muted-foreground shrink-0" />;
}

function statusLabel(s: CheckStatus): string {
  if (s === "pass") return "PASS";
  if (s === "warn") return "WATCH";
  if (s === "fail") return "RISK";
  return "NO DATA";
}

function statusLabelClass(s: CheckStatus): string {
  if (s === "pass") return "text-bull-light";
  if (s === "warn") return "text-watch-light";
  if (s === "fail") return "text-bear-light";
  return "text-muted-foreground";
}

function rowBorderClass(s: CheckStatus): string {
  if (s === "pass") return "border-l-2 border-l-bull/40";
  if (s === "warn") return "border-l-2 border-l-watch/40";
  if (s === "fail") return "border-l-2 border-l-bear/40";
  return "border-l-2 border-l-muted";
}

// ─── Checklist ─────────────────────────────────────────────────────────────

function ChecklistSection({ title, rows }: { title: string; rows: CheckResult[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="bg-card border border-card-border rounded-xl p-4 space-y-2">
      <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
        {title}
      </h3>
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div
            key={r.id}
            className={`flex items-start gap-3 py-2 px-3 rounded-md bg-muted/20 ${rowBorderClass(r.status)}`}
            data-testid={`check-${r.id}`}
          >
            <StatusGlyph status={r.status} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-foreground">{r.label}</span>
                <span className={`text-2xs font-bold tracking-wider ${statusLabelClass(r.status)}`}>
                  {statusLabel(r.status)}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                {r.reason}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function groupByCategory(checks: CheckResult[]): Map<string, CheckResult[]> {
  const groups = new Map<string, CheckResult[]>();
  for (const c of checks) {
    if (c.status === "skip") continue; // hide quiet skips from the default view
    const arr = groups.get(c.category) ?? [];
    arr.push(c);
    groups.set(c.category, arr);
  }
  return groups;
}

// ─── Verdict pill ─────────────────────────────────────────────────────────

function VerdictPill({ data }: { data: TriggerCheckResponse }) {
  const meta = VERDICT_COPY[data.verdict];
  return (
    <div className={`rounded-xl border-2 p-6 ${meta.tone}`} data-testid="verdict-pill">
      <div className="text-xs uppercase tracking-wider opacity-80">
        Trigger check — {data.ticker}
      </div>
      <div className="text-5xl sm:text-6xl font-bold mt-2 tracking-tight" data-testid="verdict-word">
        {meta.label}
      </div>
      <div className="text-sm mt-3 opacity-95 leading-relaxed">{data.reason}</div>
      <div className="text-xs mt-3 opacity-70">{meta.sub}</div>
      <div className="flex items-center gap-4 mt-4 text-xs">
        <span className="text-bull-light font-semibold">
          ✓ {data.summary.pass} pass
        </span>
        <span className="text-watch-light font-semibold">
          ! {data.summary.warn} watch
        </span>
        <span className="text-bear-light font-semibold">
          ✕ {data.summary.fail} risk
        </span>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────

export default function ConvictionPage() {
  const { activeTicker } = useTicker();

  const { data, isLoading, error } = useQuery<TriggerCheckResponse>({
    queryKey: ["/api/conviction", activeTicker],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/conviction/${activeTicker}`);
      return res.json();
    },
    enabled: !!activeTicker,
    staleTime: 5 * 60 * 1000,
  });

  const subtitle = !activeTicker
    ? "Final check before you pull the trigger — one verdict, plain-English reasons."
    : isLoading
      ? `Running the checklist for ${activeTicker}…`
      : data
        ? `${data.ticker} — pre-trade verdict + checklist.`
        : `${activeTicker} — pre-trade verdict.`;

  const groups = data ? groupByCategory(data.checks) : new Map<string, CheckResult[]>();

  return (
    <PageTemplate
      className="max-w-4xl mx-auto px-3 sm:px-4 py-4 sm:py-6 space-y-5"
      icon={Compass}
      title="Trigger Check"
      subtitle={subtitle}
      howItWorksTitle="How the Trigger Check works"
      howItWorks={
        <>
          <p>
            The Trigger Check is the <strong className="text-foreground">last stop before you buy</strong>. It pulls together everything Stockotter knows about a ticker — the trend, the setup, who else is buying, what catalysts are coming, the broader market — and answers one question in plain English: should you pull the trigger?
          </p>
          <p>
            <strong className="text-foreground">GO</strong> means the setup is clean and the conditions line up for an entry. <strong className="text-foreground">CAUTION</strong> means signals are mixed — there's a reason to think twice. <strong className="text-foreground">NO</strong> means at least one big reason argues against this trade today (earnings too close, downtrend, defensive tape, etc.).
          </p>
          <p>
            Every row in the checklist is independent — it reads its own data and gives you a single plain-English sentence. If a row says nothing, the data wasn't available for that ticker; it's not counted in the verdict.
          </p>
          <p className="text-2xs italic text-muted-foreground">
            Search a ticker above to run the check. The result caches for 5 minutes; append <code>?refresh=1</code> to force a fresh build.
          </p>
        </>
      }
    >
      {!activeTicker ? (
        <div className="text-center py-16 text-muted-foreground" data-testid="empty-no-ticker">
          <Compass className="h-16 w-16 mx-auto mb-4 opacity-20" />
          <p className="text-lg font-medium text-foreground">Search a ticker to run the trigger check</p>
          <p className="text-sm mt-2 opacity-70 max-w-md mx-auto">
            One verdict, then a plain-English checklist of what's lining up and what isn't.
          </p>
        </div>
      ) : isLoading ? (
        <div className="flex flex-col items-center gap-3 py-24" data-testid="loading">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Running the checklist for {activeTicker}…</p>
        </div>
      ) : error || !data ? (
        <div
          className="bg-card border border-bear/30 rounded-xl p-6 text-center"
          data-testid="error"
        >
          <p className="text-bear-light font-semibold">Couldn't build the trigger check</p>
          <p className="text-xs text-muted-foreground mt-2">
            {(error as any)?.message || "Try refreshing."}
          </p>
        </div>
      ) : (
        <>
          <VerdictPill data={data} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Array.from(groups.entries()).map(([cat, rows]) => (
              <ChecklistSection key={cat} title={cat} rows={rows} />
            ))}
          </div>
          <HelpBlock title="Reading the verdict">
            <p>
              <strong className="text-foreground">Biggest reason</strong> at the top is the single most-important item driving the verdict — the heaviest fail if the answer is NO/CAUTION, or the heaviest pass if the answer is GO. The checklist below shows everything else so you can verify or override the call.
            </p>
            <p>
              <strong className="text-foreground">Rows with no data</strong> (e.g. illiquid options, freshly-IPO'd ticker, missing earnings date) don't appear — they're not counted against the verdict. The verdict only weighs checks that actually ran.
            </p>
          </HelpBlock>
        </>
      )}
    </PageTemplate>
  );
}
