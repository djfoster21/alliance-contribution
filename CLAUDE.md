# CLAUDE.md — Alliance Activity Tracker

Tracker for a video-game alliance (**the alliance**, ~86 members). Participation in recurring in-game
activities (Bear Trap, Contribution, Alliance Mobilization) is logged from ranking screenshots; the app
scores it into a weighted **Participation Score** per member plus temporal views (weekly ranking, trends,
attendance). Replaces a Google Sheet proof-of-concept — the Sheet is historical reference only.

Phases 01–06 are built. New work lands as a dated spec/plan beside the existing ones.

## Read this first
- **`docs/specs/00_overview.md`** — entry point: vision, data model, service architecture, and the index
  of phase specs `01`–`06`. `07_llm_ingestion.md` plus the dated `YYYY-MM-DD_*.md` specs cover work
  layered on after the phases.
- **`docs/data/`** — domain reference: `runbook.md` (deep detail on scoring & alias rules and gotchas),
  `roster.md` (canonical 86-member roster), `aliases.md` (alias → canonical mappings), `tracker.md`
  (event-history reference).
- **`docs/fixtures/`** — gitignored reference-only TSVs documenting ingest column shape. Not test data,
  not seed input. The `kvk_*` / `castlebattle_*` files document activity types **not in the v1 schema**
  (`bear_trap` / `contribution` / `mobilization`) — a hint for future types, not v1 scope.

## Workflow
**No git worktrees.** Solo-dev project — work directly in this checkout, on a branch when the change
warrants one. Overrides any skill or harness default that reaches for worktree isolation.

`npm run dev:all` starts both servers — open **:5173** (Vite, proxies `/api`), not :8787 (Worker).

**First-time setup** (the repo is deployable by anyone onto their own Cloudflare account, so both
config files are per-deployment and gitignored — copy the committed templates):
```
cp wrangler.toml.example wrangler.toml   # then set database_name + database_id
cp .dev.vars.example .dev.vars           # then set the three API keys
npx wrangler d1 create <your-db-name>    # prints the name + id to paste above
npm run db:migrate:local && npm run seed:local
```
Nothing outside `wrangler.toml` names a specific Worker, database, or host — migrations and the
seed address D1 through the **`DB` binding**, not a database name. Keep it that way.

## Stack
TypeScript · Cloudflare Workers · Hono · D1 · React SPA (Vite) · Tailwind + shadcn/ui. **Single repo,
single Worker** serving `/api/*` and the built SPA (`dist/`). Backend layering is
`routes → services → repositories → D1`, with pure domain logic in `domain/` and types shared across the
Worker/SPA boundary in `shared/`.

## Non-obvious decisions
- **D1 is the only store** — system of record *and* serves every read. No KV/cache layer (dropped
  2026-07-22).
- **Every `/api` route needs a key**, except `/api/health` and `/api/auth/me` (uptime probe + the SPA's
  own key check). Three tiers: `ADMIN_API_KEY` → admin, `API_KEY` → manager, `VIEWER_API_KEY` → viewer.
  Viewer is read-only — non-GET or `/api/admin/*` with a viewer key is 403, not 401. `requireAdmin` gates
  destructive routes on top of that. See `src/middleware/auth.ts`. (GETs were open until 2026-07-25;
  closed because the public deploy exposed the alias/decoy map and per-member participation data.)

- **Rate limiting is in the Worker, not the WAF.** WAF rules are zone-level and don't reach
  `workers.dev`, so `/api/*` is capped by the `[[ratelimits]]` binding (120/60s per `CF-Connecting-IP`,
  in front of auth). Per-colo and eventually consistent — permissive by design. See
  `src/middleware/rate-limit.ts`.

## Nothing domain-configurable is hardcoded
Activity types, scoring tiers, and activity weights live in **SQLite tables**, editable at runtime through
the app — not TS constants. The roster and aliases are fully managed (CRUD) in-app, not seed-only. Derived
data (`participations.points`, `participations.member_id`) is always recomputable: any event, alias, rename,
or scoring change runs a deterministic **RecomputeService** (re-resolve → re-score). History is always
re-scored from the *current* config — no effective-dating (decided 2026-07-22).

## Rules that must not be softened (from runbook)
- **Never fuzzy-match names.** Identity resolves via the `aliases` table only; the alliance runs deliberate
  "Vega"/"Ember" decoy renames where similar names are *different people*. An unresolved name → NULL member
  (surface it in the unmapped queue), never a guess.
- **Log only participants with value > 0.** Strip the leading alliance tag (e.g. `[ABC]`) from raw names.
- **Scoring is config-driven from DB tables and unit-tested** (never hardcoded): Bear flat 1/appearance;
  Contribution tiered; Mobilization tiered ×2. Defaults seeded; editable in-app. See `docs/specs/02_scoring.md`.
- **Bear two-trap uniqueness:** Trap 1 & Trap 2 on the same date can't share a member (validate on ingest).

## Seed data
The seed pipeline seeds **default config only**: activity types, scoring tiers, and weights (see
`docs/specs/02_scoring.md` §1). Roster, aliases, and event history are entered in-app through their own
CRUD/ingest flows — never seeded.
