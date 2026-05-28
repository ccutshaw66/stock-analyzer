/**
 * /help — comprehensive searchable knowledge base.
 *
 * Two document types live side-by-side:
 *   - How-To: step-by-step instructions for using a feature.
 *   - What it means: definitions of terms, scores, signals.
 *
 * Layout: search bar + type-filter pills at the top, category index in a
 * sticky left rail, full entries on the right. Anchors via URL hash so
 * entries are deep-linkable (e.g. /help#strategy-htf).
 *
 * Content lives in `client/src/data/help-content.tsx`. To add an entry,
 * append to HELP_ENTRIES there — the page renders it automatically.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Search, X, Hash, Compass, FlaskConical } from "lucide-react";
import { PageTemplate } from "@/components/PageTemplate";
import {
  HELP_ENTRIES,
  HELP_CATEGORIES,
  type HelpEntry,
  type HelpEntryType,
  type HelpCategory,
} from "@/data/help-content";

type TypeFilter = "all" | HelpEntryType;

const TYPE_LABEL: Record<TypeFilter, string> = {
  all: "All",
  "how-to": "How To",
  "what-it-means": "What It Means",
};

// Categories that belong to each type bucket — used to drive the sticky
// rail's section grouping. Matches the comment-block order in
// `help-content.tsx`.
const HOW_TO_CATEGORIES: HelpCategory[] = [
  "Getting Started",
  "Analyzing a Ticker",
  "Watchlist & Portfolio",
  "Tracking Trades",
  "Finding Setups",
  "Reading Verdicts",
  "Calculators",
  "Auto-Traders",
  "Dashboard",
];

const GLOSSARY_CATEGORIES: HelpCategory[] = [
  "Verdicts & Scores",
  "Strategies",
  "Indicators",
  "Patterns",
  "Insider & Institutional",
  "Options Terminology",
  "Market Mechanics",
];

function matchesQuery(entry: HelpEntry, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  if (entry.title.toLowerCase().includes(needle)) return true;
  if (entry.category.toLowerCase().includes(needle)) return true;
  if (entry.tags.some((t) => t.toLowerCase().includes(needle))) return true;
  // Body-text search: stringify the JSX best-effort.
  const bodyText = JSON.stringify(entry.body).toLowerCase();
  return bodyText.includes(needle);
}

function categoryIcon(category: HelpCategory) {
  if (GLOSSARY_CATEGORIES.includes(category)) return Compass;
  return FlaskConical;
}

export default function HelpPage() {
  const [query, setQuery] = useState("");
  const [type, setType] = useState<TypeFilter>("all");
  const searchRef = useRef<HTMLInputElement>(null);

  // Filtered entry list.
  const visible = useMemo(() => {
    return HELP_ENTRIES.filter((e) => {
      if (type !== "all" && e.type !== type) return false;
      return matchesQuery(e, query);
    });
  }, [query, type]);

  // Group filtered entries by category, preserving HELP_CATEGORIES order.
  const grouped = useMemo(() => {
    const byCategory = new Map<HelpCategory, HelpEntry[]>();
    for (const e of visible) {
      const arr = byCategory.get(e.category) ?? [];
      arr.push(e);
      byCategory.set(e.category, arr);
    }
    return HELP_CATEGORIES
      .filter((c) => byCategory.has(c))
      .map((c) => ({ category: c, entries: byCategory.get(c)! }));
  }, [visible]);

  // Scroll to hash on load + when filter changes if the hash is still visible.
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (!hash) return;
    const el = document.getElementById(hash);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [grouped]);

  // Cmd/Ctrl-K → focus search.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const totalCount = HELP_ENTRIES.length;
  const visibleCount = visible.length;

  return (
    <PageTemplate
      icon={BookOpen}
      title="Help"
      subtitle="Searchable knowledge base — how to use each feature, and what every term / score means. Statements verified against the actual code."
      disclaimer={false}
    >
      {/* ─── Search + filter strip (sticky under header) ─────────────────── */}
      <div className="sticky top-14 z-10 -mx-3 sm:-mx-4 px-3 sm:px-4 py-3 bg-background/95 backdrop-blur border-b border-card-border">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search how-tos, terms, scores… (Ctrl-K)"
              className="w-full h-9 pl-9 pr-9 text-sm bg-card border border-card-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary/50"
              data-testid="help-search"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-1">
            {(Object.keys(TYPE_LABEL) as TypeFilter[]).map((t) => (
              <button
                key={t}
                onClick={() => setType(t)}
                className={`h-9 px-3 text-xs font-medium rounded-md transition-colors ${
                  type === t
                    ? "bg-primary text-primary-foreground"
                    : "bg-card border border-card-border text-muted-foreground hover:text-foreground"
                }`}
                data-testid={`help-filter-${t}`}
              >
                {TYPE_LABEL[t]}
              </button>
            ))}
          </div>
          <span className="text-xs text-muted-foreground ml-auto">
            {visibleCount} of {totalCount} entries
          </span>
        </div>
      </div>

      <div className="flex gap-6 mt-4">
        {/* ─── Left rail: index of categories + entries ────────────────── */}
        <aside className="hidden lg:block w-64 shrink-0">
          <div className="sticky top-32 max-h-[calc(100vh-9rem)] overflow-y-auto pr-2">
            {grouped.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No matches.</p>
            ) : (
              <nav className="space-y-4">
                {grouped.map(({ category, entries }) => {
                  const Icon = categoryIcon(category);
                  return (
                    <div key={category}>
                      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                        <Icon className="h-3 w-3" />
                        <span>{category}</span>
                      </div>
                      <ul className="space-y-0.5 border-l border-card-border/60 ml-1.5">
                        {entries.map((e) => (
                          <li key={e.id}>
                            <a
                              href={`#${e.id}`}
                              className="block text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 pl-3 pr-1 py-1 rounded-r-md transition-colors"
                              onClick={(ev) => {
                                ev.preventDefault();
                                const el = document.getElementById(e.id);
                                if (el) {
                                  history.replaceState(null, "", `#${e.id}`);
                                  el.scrollIntoView({ behavior: "smooth", block: "start" });
                                }
                              }}
                            >
                              {e.title}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </nav>
            )}
          </div>
        </aside>

        {/* ─── Right: full entries ─────────────────────────────────────── */}
        <main className="flex-1 min-w-0 space-y-8">
          {grouped.length === 0 ? (
            <div className="bg-card border border-card-border rounded-lg p-10 text-center text-sm text-muted-foreground">
              No entries match "{query}".
              <div className="mt-2">
                <button
                  onClick={() => { setQuery(""); setType("all"); }}
                  className="text-xs text-primary hover:underline"
                >
                  Clear filters
                </button>
              </div>
            </div>
          ) : (
            grouped.map(({ category, entries }) => (
              <section key={category} id={`section-${category.replace(/\s+/g, "-").toLowerCase()}`}>
                <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-3 pb-2 border-b border-card-border">
                  {category}
                </h2>
                <div className="space-y-4">
                  {entries.map((e) => (
                    <article
                      key={e.id}
                      id={e.id}
                      className="bg-card border border-card-border rounded-lg p-5 scroll-mt-32"
                      data-testid={`help-entry-${e.id}`}
                    >
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <h3 className="text-base font-bold text-foreground truncate">{e.title}</h3>
                          <TypePill type={e.type} />
                        </div>
                        <a
                          href={`#${e.id}`}
                          onClick={(ev) => {
                            ev.preventDefault();
                            history.replaceState(null, "", `#${e.id}`);
                            navigator.clipboard?.writeText(window.location.href).catch(() => {});
                            const el = document.getElementById(e.id);
                            el?.scrollIntoView({ behavior: "smooth", block: "start" });
                          }}
                          className="text-muted-foreground hover:text-foreground shrink-0"
                          title="Copy link to this entry"
                          aria-label="Copy link"
                        >
                          <Hash className="h-4 w-4" />
                        </a>
                      </div>
                      <div className="space-y-3">{e.body}</div>
                    </article>
                  ))}
                </div>
              </section>
            ))
          )}
        </main>
      </div>
    </PageTemplate>
  );
}

function TypePill({ type }: { type: HelpEntryType }) {
  const cls =
    type === "how-to"
      ? "bg-primary/15 text-primary border border-primary/30"
      : "bg-watch/15 text-watch-light border border-watch/30";
  return (
    <span className={`text-mini font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${cls} shrink-0`}>
      {TYPE_LABEL[type]}
    </span>
  );
}
