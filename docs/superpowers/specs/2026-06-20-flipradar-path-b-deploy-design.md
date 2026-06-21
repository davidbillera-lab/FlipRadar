# FlipRadar — Path B Production Deploy (Design Spec)

**Date:** 2026-06-20
**Status:** Approved design — ready for implementation planning
**Mission Control project_id:** `95e468ba-d76b-4329-aef0-3c56289a96fa`
**Branch:** work on a deploy branch off `phase-3-fm-scraper` (or a fresh branch off `master` after merge). Never push directly to `master`.

---

## 1. Goal

Take FlipRadar from never-deployed to a live production stack. **Path B = host the backend first, then the frontend**, so the deployed frontend reaches a real always-on API instead of shipping a dead shell.

Success = open the Vercel URL → it calls the Railway backend → backend reads/writes Supabase Postgres → the node-cron scheduler fires a scrape that writes a row.

---

## 2. Topology

```
Vercel (Next.js 14 App Router frontend)
   │  NEXT_PUBLIC_API_URL → Railway URL, + /api/trpc
   ▼
Railway (Express + tRPC v11 + node-cron, ALWAYS-ON)
   │  postgres-js driver
   ▼
Supabase Postgres (NEW dedicated FlipRadar project)
```

**Hard rule:** the new Supabase project is FlipRadar-only. It is **not** the shared Mission Control broker `dmtctlpzlfpcogpjweuv` — that stays the credential / `ebay-sold-comps` broker and must never host app tables.

**Locked decisions (2026-06-20):**
- **Database:** Move to Supabase Postgres — a NEW dedicated FlipRadar project.
- **Backend host:** Railway — chosen specifically because free tiers that sleep would kill the in-process `node-cron` scheduler. Always-on tier required.
- **Frontend host:** Vercel.
- **DB data:** Fresh empty DB. No port of local SQLite data — the scraper repopulates on first cron run. Local SQLite stays as a backup.
- **Env split:** Single Supabase project serves local dev and Railway prod for now. Split into dev/prod projects later in Phase 4 (multi-tenant/billing).
- **CORS:** Lock `Access-Control-Allow-Origin` to the Vercel frontend origin (+ `localhost` for dev). No more `*`.

---

## 3. The 5 Sequential Pieces

Each piece is independently committable and verifiable, and depends on the prior piece being correct. This dependency chain is why the build runs as a **phase-relay** (see §5).

### Piece 1 — Provision Supabase
- `get_cost` then `create_project` for a new dedicated FlipRadar Postgres project.
- Capture the connection string → gitignored `.env` as `DATABASE_URL`.
- Fresh/empty. No data migration.
- **Verify:** project reachable; `list_tables` returns empty (pre-migration).

### Piece 2 — DB migration SQLite → Postgres (the heavy mechanical piece)
- **`server/db/schema.ts`** — convert all 6 tables (`deals`, `garageSales`, `settings`, `geocodeCache`, `fmListings`, `fmScrapeJobs`) from `drizzle-orm/sqlite-core` to `drizzle-orm/pg-core`:
  - `sqliteTable` → `pgTable`.
  - `integer(..., { mode: "timestamp" })` → `timestamp(...)` — applies to `deals.soldAt/createdAt/updatedAt`, `garageSales.createdAt`, `fmListings.postedAt/scrapedAt`, `fmScrapeJobs.lastScrapedAt`.
  - `integer(..., { mode: "boolean" })` → `boolean(...)` — applies to `deals.flaggedHighRoi`, `fmListings.processed`.
  - `text(..., { mode: "json" }).$type<string[]>().default([])` → `jsonb(...).$type<string[]>().default([])` — applies to `garageSales.images`, `fmListings.images`.
  - `real(...)` → `real(...)` (pg-core has `real`); use `doublePrecision` only if precision demands it.
  - `geocodeCache.createdAt` is plain `integer("created_at").notNull()` (NOT timestamp mode). Decision: convert to `timestamp(...)` for consistency, OR keep as `bigint` epoch. **Spec choice: `timestamp` for consistency** — update the one write site in `server/services/geocode.ts` if it inserts a raw epoch int.
- **`server/db/index.ts`** — swap the `better-sqlite3` driver for `postgres-js` (`drizzle-orm/postgres-js` + `postgres`). Read `DATABASE_URL` from env.
- **~40 call sites** — convert Drizzle sync calls (`.run()` / `.all()` / `.get()`) to async `await`. postgres-js is async-only; the query builder no longer exposes the SQLite sync terminators.
- **`server/services/fm-scraper.ts upsertListings()`** — the current code:
  ```ts
  const r: any = await db.insert(schema.fmListings).values(l).onConflictDoNothing().run();
  if (r?.changes) inserted++;
  ```
  `.run()` and `r.changes` are SQLite-only. Replace with the pg pattern: `.onConflictDoNothing().returning({ id: schema.fmListings.id })` and count returned rows (`inserted += rows.length`).
- Regenerate Drizzle migrations for Postgres (`drizzle-kit generate` with the pg dialect); run `npm run db:migrate` against the new Supabase project.
- **Verify:** `npm run build`/typecheck passes; `db:migrate` creates all 6 tables in Supabase; a local insert/select round-trips.

### Piece 3 — Railway backend
- Deploy the Express app to Railway on an always-on (non-sleeping) tier.
- Set env vars: `DATABASE_URL`, `ANTHROPIC_API_KEY`, `EBAY_COMPS_SERVICE_TOKEN`, Telegram bot token + chat id, Google Maps key, `APIFY_FACEBOOK_API_KEY`, cron schedule, `PORT` (Railway-provided).
- **CORS lockdown (architecture call, do here):** in `server/index.ts`, replace `Access-Control-Allow-Origin: *` with an allowlist = Vercel production origin + `http://localhost:3001` (dev). Read the allowed origin from env so it's not hardcoded.
- **Verify:** Railway health endpoint responds; logs show node-cron registered and firing on schedule; a manual tRPC call from `curl` succeeds.

### Piece 4 — Vercel frontend
- **Heed `frontend/AGENTS.md` first:** "This is NOT the Next.js you know." Read the relevant guide in `node_modules/next/dist/docs/` before writing any Next config. Heed deprecation notices.
- Set `NEXT_PUBLIC_API_URL` = Railway URL on Vercel (build + runtime).
- Resolve the `AppRouter` cross-boundary import in `frontend/lib/trpc.ts` (`import type { AppRouter } from "../../server/router"`) so `next build`'s type-check passes. Fallback: `typescript.ignoreBuildErrors` in `next.config`. The clean monorepo/shared-types fix is deferred to Phase 4 per CLAUDE.md known-debt.
- **Verify:** Vercel build succeeds; deployed page loads; network tab shows tRPC requests hitting the Railway origin (not localhost) and returning 200.

### Piece 5 — Smoke test + close-out
- End-to-end: frontend loads → a tRPC query hits Railway → reads Postgres → trigger (or wait for) a cron scrape that writes an `fm_listings` row → confirm it surfaces in the UI.
- Confirm CORS: a request from a non-allowlisted origin is rejected; the Vercel origin is accepted.
- Update `CLAUDE.md` (topology + "deployed" status) and `decisions.md` (this deploy + the locked decisions from §2).
- Push to GitHub. Sync Mission Control (`mc_update_project_status`).

---

## 4. Risks / Known Debt Touched

- **AppRouter type coupling** (CLAUDE.md debt #2) — surfaces at `next build`. Handled in Piece 4 with a fallback; clean fix deferred Phase 4.
- **Single-tenant auth stub** (`auth.me`) — unchanged by this deploy; Phase 4 concern.
- **Facebook Marketplace via Apify** — already wired; Piece 3 just needs `APIFY_FACEBOOK_API_KEY` in Railway env.
- **node-cron in-process** — the whole reason for Railway-always-on. If Railway ever sleeps the process, the scheduler dies silently. Verify in Piece 3.

---

## 5. Execution Strategy — Skills, Models, Context Discipline

This section is the anti-context-rot, anti-overspend plan. It is binding on how the implementation is run.

### Methodology stack (all three skills, layered — not either/or)
- **`davids-way`** is the governing umbrella: Step 0 model-tier audit → Step 1 targeted reads only (no broad Explore/Glob sweeps that trigger autocompact thrashing) → Steps 2–3 plan + approval gate → Step 4 build one-commit-per-piece → session-end push + MC sync. `davids-way` Step 4 explicitly routes 3+ sequential pieces to `phase-relay`.
- **`phase-relay`** drives implementation. The 5 pieces are sequential and dependent, so each runs in its **own fresh context window**, connected by handoff docs in `.claude/relay/` (`plan.md`, `brief-N.md`, `handoff-N.md`). No piece may need more than ~80k tokens of context. The lead never builds; piece agents never plan.
- **`dynamic-workflow`** is the planning-loop counterpart (its strength is parallel independent work). The deploy is sequential, so its only role here is parallel read-only Explore during mapping if needed. Not the primary driver.

### Role + model assignment (cost discipline — global CLAUDE.md routing)
| Work | Role | Model | Tier / why |
|---|---|---|---|
| Orchestration, briefs, handoff review, architecture (CORS allowlist, AppRouter boundary, timestamp decision) | **Lead (this session)** | Opus 4.8 | Tier 3 — being wrong costs days |
| Piece 2: schema rewrite + driver swap + ~40 call-site conversion + `upsertListings` fix | **Piece agent** | Sonnet 4.6 | Tier 2 — mechanical but cross-file, needs care |
| Any pure find-replace splinter of Piece 2 (e.g. bulk `.run()`→`await`) | **Piece agent** | Haiku 4.5 | Tier 1 — rote |
| Piece 5: end-to-end smoke test | **qa-verifier** | Sonnet 4.6 | Tier 2 — independent verification |
| Provisioning / deploy MCP calls (Supabase, Railway, Vercel) | **Lead** | Opus 4.8 | irreversible infra — lead executes directly |

The payoff: the ~40-line call-site diff and the schema rewrite never enter the Opus lead window. The lead reads only short handoff docs (a few hundred tokens each), not full diffs. That eliminates context rot, autocompact thrashing, and token overspend simultaneously, while keeping Opus on the high-value reasoning only.

### Relay seed
`.claude/relay/plan.md` is seeded from §3 (the 5 pieces) and this strategy. Piece 1 brief is authored by the lead before any build agent is spawned. Default to **manual relay for Piece 1** (David opens a fresh window / lead spawns a single Sonnet agent), evaluate automated spawning for Pieces 2–5.

---

## 6. Out of Scope (this spec)

- Multi-tenant auth, Stripe billing (Phase 4).
- Shared-types monorepo boundary (Phase 4).
- Dev/prod Supabase project split (Phase 4).
- Porting historical local SQLite data (decided against).
