# Alliance Tracker

Participation tracker for a video-game alliance. Members take part in recurring in-game activities;
this app turns the ranking screenshots from those activities into a per-member **Participation Score**
plus the temporal views built on top of it — weekly rankings, overall rankings, attendance, and trends.

It replaces the spreadsheet most alliances end up maintaining by hand.

## What it does

- **Tracks three activity types out of the box** — Bear Trap, Contribution, Alliance Mobilization.
  Activity types are rows in the database, not constants, so you can add your own in-app.
- **Scores participation from config, not code.** Bear Trap is a flat point per appearance;
  Contribution and Mobilization are tiered on the raw value, with Mobilization weighted ×2.
  Tiers and weights are editable at runtime through the Scoring admin page.
- **Ingests events by paste.** The app never uploads images or calls an LLM. You paste your
  screenshots into an LLM chat with the prompt from `docs/specs/07_llm_ingestion.md`, and paste the
  tab-separated rows it returns into the Add Event dialog. Ingest is idempotent — re-pasting the same
  event updates rather than duplicates.
- **Resolves names through an alias table only, never fuzzy matching.** Alliances run deliberate decoy
  renames where near-identical names are different people, so an unrecognised name is never guessed —
  it lands in an unmapped queue for you to map.
- **Recomputes deterministically.** Any change to scoring config, aliases, or the roster re-resolves
  and re-scores all history from the current configuration. No effective-dating.
- **Three access tiers** — admin, manager, viewer (read-only) — so you can hand out a viewer key
  without exposing writes or the alias map.

Pages: Overview, Ranking (weekly + overall), Attendance, Members with per-member profiles, and an
admin section covering Events, Roster, Aliases, Scoring, and Backup.

## Stack

| Layer | Choice |
| --- | --- |
| Runtime | Cloudflare Workers |
| API | Hono (TypeScript) |
| Database | Cloudflare D1 (SQLite) — sole datastore, no cache layer |
| Frontend | React SPA, Vite, Tailwind + shadcn/ui |
| Tests | Vitest, with `@cloudflare/vitest-pool-workers` for integration tests against a local D1 |
| Tooling | Wrangler, Node 22 |

Single repo, single Worker: it serves `/api/*` and the built SPA from `dist/`. Backend layering is
`routes → services → repositories → D1`, with pure logic in `src/domain/` and types shared across the
Worker/SPA boundary in `shared/`.

## Requirements

- Node 22 (the version CI uses; there is no `engines` pin)
- A Cloudflare account — free tier is enough
- Wrangler is installed as a dev dependency; no global install needed

## Install

```bash
git clone <your-fork-url> alliance-tracker
cd alliance-tracker

npm install                  # Worker / backend
npm --prefix web install     # SPA — separate dependency tree, not a workspace
```

Then create your config. Both config files are gitignored because they name *your* Worker, *your*
database, and *your* keys — copy the committed templates:

```bash
cp wrangler.toml.example wrangler.toml
cp .dev.vars.example .dev.vars

npx wrangler d1 create alliance-tracker-db   # prints the database name and id
```

Paste the printed `database_name` and `database_id` into `wrangler.toml`, set your keys in
`.dev.vars` (see [Configuration](#configuration)), then set up the local database:

```bash
npm run db:migrate:local
npm run seed:local           # default scoring config only — no roster, aliases, or events
```

## Run locally

```bash
npm run dev:all
```

That starts both servers. **Open http://localhost:5173** — the Vite dev server, which proxies `/api`
to the Worker on :8787. Hitting :8787 directly gives you the API without the SPA.

Individually: `npm run dev` (Worker only), `npm run dev:web` (SPA only).

The roster, aliases, and event history are all entered in the app — there is no seed path for them.
Start at the admin Roster page, import your members, then add events.

## Test

```bash
npm test        # unit + integration, in one run
npx tsc --noEmit
```

Integration tests spin up a local D1 from `wrangler.toml` plus the migrations and seed SQL, so they
need no Cloudflare credentials — but they *do* read `wrangler.toml`, so it must exist. That is why CI
copies the template before running.

## Deploy

Set your production secrets once (these are separate from `.dev.vars`, which is local-only):

```bash
npx wrangler secret put ADMIN_API_KEY
npx wrangler secret put API_KEY
npx wrangler secret put VIEWER_API_KEY
```

Migrate and seed the remote database, then deploy:

```bash
npm run db:migrate:remote
npm run seed:remote
npm run deploy               # builds the SPA into dist/, then wrangler deploy
```

Your app lands at `https://<worker-name>.<your-subdomain>.workers.dev`, where `<worker-name>` is the
`name` field in your `wrangler.toml`.

On later deploys, `npm run deploy` is enough; run `db:migrate:remote` again only when you have pulled
new migrations.

## Configuration

### `wrangler.toml` (from `wrangler.toml.example`)

| Setting | Notes |
| --- | --- |
| `name` | Your Worker's name — becomes the hostname |
| `[[d1_databases]]` `database_name`, `database_id` | From `wrangler d1 create`. The only place in the repo a database is named — migrations and the seed address D1 through the `DB` binding |
| `[[ratelimits]]` `API_RATE_LIMIT` | 120 requests / 60s per client IP, applied in front of auth. Required in production; skipped locally, where there is no `CF-Connecting-IP` header. Rate limiting lives in the Worker rather than the WAF because WAF rules are zone-level and do not apply to `workers.dev` |
| `[assets]` | Serves the built SPA from `dist/`, with SPA fallback routing |

### Secrets

| Variable | Tier | Grants |
| --- | --- | --- |
| `ADMIN_API_KEY` | admin | Everything, including destructive routes and DB export/import |
| `API_KEY` | manager | Reads and writes; not admin-only routes |
| `VIEWER_API_KEY` | viewer | Reads only — any non-GET or any `/api/admin/*` request is 403 |

Sent by the client as an `X-Api-Key` header. Set all three: a tier whose key is unset or empty fails
closed, so that tier simply cannot authenticate. Every `/api` route requires a key except
`GET /api/health` (uptime probe) and `GET /api/auth/me` (lets the SPA discover which tier its key
resolves to).

Rotating a key is `wrangler secret put <NAME>` — no redeploy needed — but every client then has to
re-enter it. Keys are stored in the browser's `localStorage` with no expiry. The SPA shell itself is
public; it holds no data, and the key gate renders before any fetch resolves.

## Documentation

- `docs/specs/00_overview.md` — vision, data model, service architecture, and the index of phase specs
- `docs/specs/07_llm_ingestion.md` — the screenshot → LLM → paste ingestion contract
- `docs/data/runbook.md` — scoring and alias rules in detail, including the gotchas
- `docs/data/roster.md`, `docs/data/aliases.md` — example roster and alias data (fictional)
- `CLAUDE.md` — conventions and non-obvious decisions, for both humans and coding agents

## License

MIT — see [LICENSE.md](LICENSE.md).
