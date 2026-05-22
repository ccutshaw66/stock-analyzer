import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Activity, Loader2 } from "lucide-react";

interface MorningBriefData {
  generatedAt: string;
  marketRegime: { tier: string | null; score: number | null; explainer: string | null };
  book: {
    openPositionCount: number;
    realizedPnLDollar: number;
    unrealizedPnLDollar: number;
    totalPnLDollar: number;
  };
  attention: { itemCount: number; criticalCount: number };
  freshSetups: { htfCount: number };
  perTradeRisk: {
    dollarsBudgeted: number;
    worstDrawdownDollar: number;
    worstSymbol: string | null;
    pctUsed: number;
  };
  strategyMix: Array<{ strategy: string; count: number }>;
}

// Plain-English labels for strategy ids. Mirrors STRATEGY_REGISTRY.shortName
// but kept local so the widget doesn't pull the whole registry just for a
// label lookup.
const STRATEGY_LABEL: Record<string, string> = {
  htf: "HTF",
  "wyckoff-spring": "Wyckoff Spring",
  "bbtc-ver": "BBTC+VER",
  "tft-40w": "TFT 40W",
  "tft-60w": "TFT 60W",
  "tft-cat": "TFT Cat",
  amc: "AMC",
  "markov-v2": "Markov",
  manual: "Manual",
  other: "Other",
};

function fmtMoney(n: number, signed = false): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : signed && n > 0 ? "+" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function regimeTone(tier: string | null): string {
  switch (tier) {
    case "RISK-ON": return "text-bull-light";
    case "RISK-OFF": return "text-bear-light";
    case "DEFENSIVE": return "text-orange-300";
    case "EUPHORIC": return "text-fuchsia-300";
    default: return "text-foreground";
  }
}

function pnlTone(n: number): string {
  if (n > 0) return "text-bull-light";
  if (n < 0) return "text-bear-light";
  return "text-muted-foreground";
}

function attentionTone(count: number, critical: number): string {
  if (critical > 0) return "text-bear-light";
  if (count > 0) return "text-watch-light";
  return "text-bull-light";
}

function riskTone(pct: number): string {
  if (pct >= 1) return "text-bear-light";
  if (pct >= 0.6) return "text-watch-light";
  return "text-bull-light";
}

/**
 * Single labeled stat with a hover tooltip explaining what it means.
 * Plain-English labels — no "Book" / "Loss budget" trader slang.
 *
 * Clickable when `href` is supplied — clicking navigates to the source
 * page so the user doesn't have to hunt. Per Chris's feedback: every
 * surface should be the click-target, not just a static read.
 */
function Stat({
  label, value, tone, tip, href, onNavigate,
}: {
  label: string;
  value: React.ReactNode;
  tone: string;
  tip: string;
  href?: string;
  onNavigate?: (href: string) => void;
}) {
  const inner = (
    <>
      <span className="text-micro uppercase tracking-wider text-muted-foreground font-semibold">{label}</span>
      <span className={`text-sm font-bold tabular-nums truncate ${tone}`}>{value}</span>
    </>
  );
  if (href && onNavigate) {
    return (
      <button
        type="button"
        onClick={() => onNavigate(href)}
        title={tip}
        className="flex flex-col min-w-0 text-left rounded px-2 -mx-2 py-0.5 hover:bg-muted/40 transition-colors"
        data-testid={`brief-stat-${label.toLowerCase().replace(/\s+/g, "-")}`}
      >
        {inner}
      </button>
    );
  }
  return (
    <div className="flex flex-col min-w-0" title={tip}>
      {inner}
    </div>
  );
}

export function MorningBriefWidget() {
  const [, navigate] = useLocation();
  const { data, isLoading, error } = useQuery<MorningBriefData>({
    queryKey: ["/api/dashboard/morning-brief"],
    queryFn: async () => (await apiRequest("GET", "/api/dashboard/morning-brief")).json(),
    refetchInterval: 5 * 60 * 1000,
    staleTime: 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Building today's brief…
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
        Brief unavailable — Market Pulse cache may be warming.
      </div>
    );
  }

  const { marketRegime, book, attention, freshSetups, perTradeRisk, strategyMix } = data;
  const tierLabel = marketRegime.tier ?? "Unknown";

  return (
    <div className="h-full flex flex-col gap-1 px-4 py-2 overflow-x-auto" data-testid="morning-brief">
      <div className="flex items-center gap-4">
        <div className="shrink-0 flex items-center gap-2 text-muted-foreground border-r border-card-border pr-4">
          <Activity className="h-4 w-4" />
          <span className="text-xs font-semibold uppercase tracking-wider">Brief</span>
        </div>

        <div className="flex items-center gap-6 flex-1 min-w-0">
        <Stat
          label="Market"
          tone={regimeTone(marketRegime.tier)}
          value={
            <>
              {tierLabel}
              {marketRegime.score != null && (
                <span className="text-muted-foreground font-normal ml-1">({marketRegime.score}/100)</span>
              )}
            </>
          }
          tip="Market Pulse regime tier. Click to open."
          href="/market-pulse"
          onNavigate={navigate}
        />

        <Stat
          label="Open positions"
          tone={pnlTone(book.totalPnLDollar)}
          value={
            book.openPositionCount > 0
              ? <>{book.openPositionCount} <span className="text-muted-foreground font-normal">·</span> {fmtMoney(book.totalPnLDollar, true)}</>
              : <span className="text-muted-foreground font-normal">None</span>
          }
          tip="Count + total P&L on open trades. Click to open Current Positions."
          href="/tracker"
          onNavigate={navigate}
        />

        <Stat
          label="Need attention"
          tone={attentionTone(attention.itemCount, attention.criticalCount)}
          value={
            attention.itemCount > 0
              ? <>{attention.itemCount}{attention.criticalCount > 0 && <span className="text-bear-light font-normal ml-1">({attention.criticalCount} urgent)</span>}</>
              : <span className="text-bull-light">All clear</span>
          }
          tip="Items in today's Action Queue. Click to scroll to it."
          href="#action-queue"
          onNavigate={(_h) => {
            const el = document.querySelector('[data-testid="action-queue"]');
            if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
          }}
        />

        <Stat
          label="New setups"
          tone={freshSetups.htfCount > 0 ? "text-foreground" : "text-muted-foreground"}
          value={
            freshSetups.htfCount > 0
              ? <>{freshSetups.htfCount} HTF</>
              : <span className="font-normal">None</span>
          }
          tip="Fresh HTF breakouts in the entry window. Click to open."
          href="/htf"
          onNavigate={navigate}
        />

        <Stat
          label="Worst position risk"
          tone={riskTone(perTradeRisk.pctUsed)}
          value={
            perTradeRisk.worstSymbol
              ? <>
                  {perTradeRisk.worstSymbol}{" "}
                  <span className="text-muted-foreground font-normal">·</span>{" "}
                  {fmtMoney(perTradeRisk.worstDrawdownDollar)}<span className="text-muted-foreground font-normal"> / {fmtMoney(perTradeRisk.dollarsBudgeted)}</span>
                  <span className="text-muted-foreground font-normal ml-1">({Math.round(perTradeRisk.pctUsed * 100)}%)</span>
                </>
              : <>
                  <span className="text-bull-light">No drawdown</span>
                  <span className="text-muted-foreground font-normal ml-1">· cap {fmtMoney(perTradeRisk.dollarsBudgeted)}/trade</span>
                </>
          }
          tip="Worst open position's drawdown vs per-trade risk cap. Click to open Current Positions."
          href="/tracker"
          onNavigate={navigate}
        />
        </div>
      </div>

      {strategyMix.length > 0 && (
        <div className="flex items-center gap-2 pl-[4.25rem] text-micro" data-testid="brief-strategy-mix">
          <span className="text-muted-foreground uppercase tracking-wider font-semibold">Strategies</span>
          <div className="flex items-center gap-2 flex-wrap">
            {strategyMix.map(s => (
              <button
                key={s.strategy}
                type="button"
                onClick={() => navigate("/tracker")}
                title={`${s.count} open ${STRATEGY_LABEL[s.strategy] ?? s.strategy} ${s.count === 1 ? "trade" : "trades"} — click to open Current Positions`}
                className="px-1.5 py-0.5 rounded bg-muted/40 hover:bg-muted/70 text-foreground tabular-nums transition-colors"
                data-testid={`brief-strategy-${s.strategy}`}
              >
                {STRATEGY_LABEL[s.strategy] ?? s.strategy}
                <span className="text-muted-foreground font-normal ml-1">{s.count}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
