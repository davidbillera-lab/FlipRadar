# Phase Relay — Handoff 2 of 5
**Date:** 2026-06-21
**Branch:** phase-3-fm-scraper
**Task:** SQLite → Postgres migration (all server-side code)

---

## What Was Done

Complete conversion of FlipRadar's server from SQLite (`better-sqlite3` + `drizzle-orm/sqlite-core`) to Postgres (`postgres` + `drizzle-orm/pg-core`). Every call-site was converted; TypeScript reports zero errors.

### Files Changed

| File | Change |
|------|--------|
| `package.json` | Removed `better-sqlite3`, `@types/better-sqlite3`; added `postgres` |
| `server/db/schema.ts` | All 6 tables converted: `sqliteTable` → `pgTable`; `integer(mode:"boolean")` → `boolean()`; `integer(mode:"timestamp")` → `timestamp()`; `text(mode:"json")` → `jsonb()` |
| `server/db/index.ts` | Replaced `better-sqlite3` driver with `postgres-js` + `drizzle-orm/postgres-js`; `rawDb` export removed |
| `server/db/migrate.ts` | Replaced sync `rawDb.exec(SCHEMA_SQL)` with `drizzle-orm/postgres-js/migrator` async flow; reads from `./drizzle/` folder |
| `server/index.ts` | CORS lockdown (no wildcard — reads `CORS_ORIGIN` env var); async IIFE startup with `runMigrations()` gate; all `.all()` removed |
| `server/router.ts` | Removed `nid`/`rowid` patterns; all `.run()`, `.all()`, `.get()` removed; ID inputs changed from `Number` to `String` (text UUID); `.returning()` used for insert detection |
| `server/lib/cities.ts` | Two `.get()` → `(await query)[0]` |
| `server/services/fm-scraper.ts` | `upsertListings()`: `.run()` + `r?.changes` → `.returning()` + `rows.length` |
| `server/services/geocode.ts` | Removed `rawDb` prepared statements; rewritten with Drizzle async calls + `new Date()` instead of `Date.now()`; conflict on upsert uses `.onConflictDoUpdate()` |
| `server/services/route.ts` | Pre-existing TS error fixed: `order.map().filter()` to remove undefined from waypoints |
| `server/jobs/process-deals.ts` | 15+ call-sites fixed: all `.get()`, `.all()`, `.run()`, `r?.changes` removed; `rescoreHighRoiFlags()` boolean compare fixed |
| `drizzle.config.ts` | Created — points to `./server/db/schema.ts`, output `./drizzle/`, dialect `postgresql` |
| `drizzle/0000_next_steel_serpent.sql` | Generated migration — all 6 tables as Postgres DDL |

### Verification

- `npx drizzle-kit generate` — succeeded, generated `drizzle/0000_next_steel_serpent.sql`
- `npx tsc --noEmit` — **zero errors**

---

## What's NOT Done (Piece 3+)

- **DATABASE_URL** must be set in `.env` pointing to Supabase project `hgntosqexnrnjiqettca` (NOT `dmtctlpzlfpcogpjweuv` — that's MC broker)
- First run will apply the migration via `runMigrations()` automatically on server start
- No legacy SQLite data was ported — fresh empty DB on first boot
- Multi-tenant auth (Phase 4), Stripe billing, Supabase auth all deferred
- `model_costs` table not yet created (deferred to Phase 4 multi-tenant build)

---

## Security Constraints (carry forward)

- `DATABASE_URL` stays in `.env` only — never commit, log, or expose
- Target Supabase project: `hgntosqexnrnjiqettca` — NEVER `dmtctlpzlfpcogpjweuv`
- Branch is `phase-3-fm-scraper` — never push to `master`

---

## Next Agent Briefing (Piece 3 of 5)

The DB layer is done. The next piece should:
1. Provision the Supabase `hgntosqexnrnjiqettca` database schema by running the server once (or applying `drizzle/0000_next_steel_serpent.sql` directly via Supabase SQL editor)
2. Test the server boots cleanly: `DATABASE_URL=<url> npm run dev`
3. Smoke-test the tRPC routes via the frontend
4. Any remaining Phase 3 FM scraper features (as scoped in the original phase plan)

Read: `CLAUDE.md`, `decisions.md`, this file, then the phase plan.
