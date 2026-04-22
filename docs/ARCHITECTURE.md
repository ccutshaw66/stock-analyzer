# Stock Otter — Backend Scaffold

Foundational architecture for stockotter.ai. Drop these files into the repo as
the target structure and migrate existing code into each module incrementally.

## Layout

```
server/
  data/          Vendor-agnostic data layer (Polygon, FMP, Yahoo, in-house)
  indicators/    Pure math: RSI, BB, MACD, volume, beta, pullback
  signals/       Gates + confluence engine (one voice)
  features/      Page-level orchestration
  platform/      Cross-cutting: auth, tiers, billing, alerts, jobs, config, telemetry
  api/           Thin HTTP routes
```

## Dependency rule

Each layer imports only from layers below it:

`api -> features -> signals -> indicators -> data`
`platform/*` is accessible from any layer but never imports upward.

## Migration order

1. `data/` + move Polygon calls behind the facade
2. `indicators/` + unify RSI (fixes Gate 1 ↔ VER mismatch)
3. `signals/` + route one page (Scanner) through confluence
4. `platform/tiers/` middleware on protected routes
5. `platform/alerts/` then the alerts feature
6. `platform/jobs/` scheduler + register existing crons
7. `platform/billing/` Stripe wrapper

See `docs/MASTER_PATHWAY.md` for the full plan.
