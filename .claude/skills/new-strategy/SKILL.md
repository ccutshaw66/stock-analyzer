---
name: new-strategy
description: Scaffold a new trading strategy in stockotter — strategy file under `server/signals/strategies/`, registry wiring, Strategy Chart toggle entry, and a P&L evaluation harness pass. Follows the foundation-first / always-evolving pattern (registry/plugin, additive schemas, no hard-coded forks). Use when Chris wants to add a new signal/strategy variant or split an existing one.
---

# New Strategy

Adds a new strategy the right way — foundation-first, registry-driven, evaluated before it ships.

## When to use

- Chris wants to add a new strategy (e.g. "build a TFT-100w variant", "add a mean-reversion signal").
- Splitting an existing strategy into two variants.
- Replacing a demoted strategy after a rebuild (e.g. the short-side rebuild, VER_WATCH_SELL rebuild).

## Conventions (read these first)

- Strategy files live in `server/signals/strategies/` — one file per strategy. Existing examples: `bbtc.ts`, `ver.ts`, `amc.ts`, `tft.ts`.
- Each exports a `compute<Name>(...)` (or `score<Name>(...)`) function returning typed signals.
- Long-only by default since 2026-05-08. Shorts are info-only unless the strategy has a separately-validated short P&L (see `strategy-pnl` skill).
- The Strategy Chart page (`/chart`) toggles strategies via a registry — adding a strategy should mean adding **one entry** to that registry, not editing the page.

## Steps

### 1. Confirm the spec with Chris (don't guess)

Before writing code, get a one-paragraph spec from Chris:
- entry rule, exit rule, stop rule;
- which side(s) — long, short, or both;
- inputs (which indicators, which timeframes);
- whether it stacks with existing strategies or stands alone.

Ask **one combined question** if needed — never spread clarifications across multiple turns.

### 2. Author the strategy file

`server/signals/strategies/<name>.ts`. Match the shape of `bbtc.ts` / `tft.ts`:
- exported `Signal` type (with `side`, `date`, `price`, `reason`).
- exported `compute<Name>(bars, settings)` function — **pure**, no I/O, takes the bar array and a settings object.
- indicator math inline or imported from `server/indicators/` (don't duplicate EMA/RSI/MACD — reuse existing helpers).

### 3. Wire into the registry

Find where existing strategies are registered (grep for `bbtc` and `tft` co-located references — typically in `server/signals/` index files and the Strategy Chart client config). Add the new strategy:
- in the strategy registry (server side, used by signal computation);
- in the Strategy Chart toggle config (client side, `/chart` page);
- in any diag endpoints that walk "all strategies" (e.g. signal preview).

**Additive only.** Don't rename or restructure existing entries to fit the new one — Chris's "always evolving" principle: registry/plugin patterns, additive schemas, config over forks.

### 4. Add a P&L evaluation path

Either:
- (a) extend `server/diag/strategy-pnl.ts` to include the new strategy, OR
- (b) create `server/diag/strategy-<name>-pnl.ts` if its trade-pairing logic differs (as `strategy-tft-pnl.ts` does for TFT).

Wire a `GET /api/diag/strategy-<name>-pnl` route in `server/routes.ts` next to the existing `strategy-eval` / `strategy-pnl` / `strategy-tft-pnl` routes (~line 5130–5240).

### 5. Run the evaluation

Use the `strategy-pnl` skill against the same 10-year basket Chris uses. Don't ship the strategy live until $ P&L is positive — same gate that long-only and the demoted strategies are held to.

### 6. Document in CHANGES.md

One entry per the `changes-entry` skill, including:
- the spec (entry/exit/stop in plain English);
- the basket P&L result;
- which toggles / pages it shows up on.

### 7. Ship

Via the `ship` skill. Strategy goes live; the registry-driven toggle means it's already available on `/chart` once main is deployed.

## Hard rules

- Pure compute functions — no fetches, no I/O, no module-level state.
- Reuse indicator helpers from `server/indicators/`; do not duplicate math.
- Registry-driven wiring — adding a strategy should not require editing the `/chart` page itself, only its config.
- No new strategy goes live without a P&L pass on the standard basket.
- Long-only unless short P&L is independently validated.
