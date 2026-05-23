---
name: fmp-endpoint
description: Find the canonical FMP (Financial Modeling Prep) endpoint and exact field names for a given data need (e.g. "next earnings date", "insider trades", "short interest"). Returns the endpoint path, the precise field name(s) to read, and a copy-paste TypeScript snippet using `fmpGet` from `server/data/providers/fmp.client`. Use whenever a feature needs FMP data and you'd otherwise be guessing field names.
---

# FMP Endpoint Lookup

Stops the recurring "guessing FMP field names" problem. FMP is the primary data provider for stockotter (Polygon and Yahoo are being killed).

## When to use

- Writing new code that fetches market/fundamentals/news/insider/etc. data.
- Touching existing code that calls FMP and you're not 100% sure of the field name.
- Migrating something off Yahoo or Polygon to FMP.

## How to look up

1. **First, read `docs/FMP_REFERENCE.md`** — the curated reference with the endpoints stockotter actually uses, field names, sample payloads, and gotchas.
2. **If not found there, read `docs/FMP_API_DOCS_RAW.md`** — the raw dump of FMP's docs. Larger and noisier, but comprehensive.
3. **Cross-check against existing usage** — `grep -rn "fmpGet" server/` to see how stockotter already calls the endpoint. Match the existing pattern.
4. **If still unclear**, hit the live endpoint via a quick diag call (or suggest one) to inspect the actual JSON keys — never guess.

## Output format

Always return this structure to Chris in plain English (no jargon dump):

> **Endpoint:** `<path>`
> **Field(s):** `<exact field name>` — `<unit / type / nullable?>`
> **Snippet:**
> ```ts
> import { fmpGet } from "../data/providers/fmp.client";
> const data = await fmpGet<...>("...");
> const value = data?.[0]?.<field>;
> ```
> **Caveat:** <stable URL? rate-limited? quarterly cadence? caching note?>

## Caching reminder

Per Chris's caching strategy: quarterly/historical data is cached aggressively. Don't fetch fundamentals per-request — route through `server/cache.ts` / `institutional-cache.ts` / `long-range-cache.ts` patterns already in the codebase. Refresh on quarterly cadence or earnings, not on every page load.

## If the data isn't on FMP

Flag it explicitly. Do **not** silently fall back to Yahoo or Polygon — those are kill targets. Surface the gap to Chris with options:
- skip the feature,
- find a different FMP endpoint that approximates it,
- accept a different provider (only with Chris's explicit OK).

## Maintenance

After any session where you discover a new endpoint or a field-name gotcha, add it to `docs/FMP_REFERENCE.md`. This is the standing "FMP endpoint reference TODO" from memory — the doc only gets better if every lookup contributes back.
