# Phase Relay — Piece 2 of 5

## Your job
Convert the FlipRadar server from SQLite (better-sqlite3 + drizzle sqlite-core) to Postgres (postgres-js + drizzle pg-core), including all ~40 async call-site conversions, then apply the schema migrations to the live Supabase project.

---

## Context you need

- **Project:** FlipRadar (resale-arbitrage agent)
- **Repo root:** `c:\Users\david\FlipRadar`
- **Branch:** `phase-3-fm-scraper` — do NOT push to master
- **Stack:** Node ≥20, Express + tRPC v11, TypeScript via `tsx`, Drizzle ORM, `better-sqlite3` (current) → `postgres` driver (after your changes)
- **Target DB:** Supabase Postgres — project ref `hgntosqexnrnjiqettca`, host `db.hgntosqexnrnjiqettca.supabase.co`
- **`DATABASE_URL`** lives in gitignored `.env` at project root (David fills it in from Supabase Dashboard before you run migrations)
- **CLAUDE.md** files: read `~/.claude/CLAUDE.md` (operator profile) and `c:\Users\david\FlipRadar\CLAUDE.md` (project rules)

---

## State you're starting from

- Piece 1 complete: Supabase FlipRadar-prod project is ACTIVE_HEALTHY, empty (no tables yet)
- All server code is written against `better-sqlite3` sync calls and `drizzle-orm/sqlite-core`
- `.env` has `DATABASE_URL` set to the Supabase connection URI (direct connection, not pooler) — confirm it's present before running migrations
- No application code changes were made in Piece 1

---

## Your task — exact steps in order

### Step 1 — Install / uninstall dependencies

```bash
npm install postgres drizzle-orm
npm uninstall better-sqlite3
npm uninstall @types/better-sqlite3
```

Verify `package.json` no longer references `better-sqlite3`.

---

### Step 2 — `server/db/schema.ts` — convert all 6 tables to pg-core

Replace the entire import block:
```ts
// OLD
import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
// NEW
import { pgTable, text, integer, real, boolean, timestamp, jsonb, bigserial, doublePrecision } from "drizzle-orm/pg-core";
```

Convert every table from `sqliteTable` → `pgTable`. Below are the **exact column type changes** per table:

#### `deals` table
- `sqliteTable` → `pgTable`
- `integer("sold_at", { mode: "timestamp" })` → `timestamp("sold_at")`
- `integer("created_at", { mode: "timestamp" })` → `timestamp("created_at")`
- `integer("updated_at", { mode: "timestamp" })` → `timestamp("updated_at")`
- `integer("flagged_high_roi", { mode: "boolean" })` → `boolean("flagged_high_roi")`
- Add a new `nid` column for Postgres row identity: `nid: bigserial("nid", { mode: "number" }).primaryKey()` — OR use the existing `id` text column as PK if it already is. **Read the file first to see the actual PK setup**, then decide. If `id` is already the PK (text uuid/nanoid), just drop `nid` — it's only needed if there's no existing integer rowid substitute.

#### `garageSales` table
- `sqliteTable` → `pgTable`
- `integer("created_at", { mode: "timestamp" })` → `timestamp("created_at")`
- `text("images", { mode: "json" }).$type<string[]>().default([])` → `jsonb("images").$type<string[]>().default([])`

#### `settings` table
- `sqliteTable` → `pgTable`
- No timestamp or boolean columns — just `text` and `integer`. `integer` stays as-is in pg-core.

#### `geocodeCache` table
- `sqliteTable` → `pgTable`
- `integer("created_at").notNull()` — convert to `timestamp("created_at").notNull()` for consistency
- Update the one write site in `server/services/geocode.ts` that inserts `createdAt` — it currently likely inserts `Date.now()` (epoch ms int). Change to `new Date()` to match the timestamp column type.

#### `fmListings` table
- `sqliteTable` → `pgTable`
- `integer("posted_at", { mode: "timestamp" })` → `timestamp("posted_at")`
- `integer("scraped_at", { mode: "timestamp" })` → `timestamp("scraped_at")`
- `integer("processed", { mode: "boolean" })` → `boolean("processed")`
- `text("images", { mode: "json" }).$type<string[]>().default([])` → `jsonb("images").$type<string[]>().default([])`

#### `fmScrapeJobs` table
- `sqliteTable` → `pgTable`
- `integer("last_scraped_at", { mode: "timestamp" })` → `timestamp("last_scraped_at")`

---

### Step 3 — `server/db/index.ts` — swap driver

Replace the entire file content with the postgres-js pattern:

```ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is required");
}

const client = postgres(process.env.DATABASE_URL);
export const db = drizzle(client, { schema });
```

Remove all `better-sqlite3` imports. Remove `Database` instantiation. Remove `BetterSQLite3Database` type if referenced anywhere.

---

### Step 4 — `server/db/migrate.ts` — rewrite for pg migrator

```ts
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import path from "path";

export async function runMigrations() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to run migrations");
  }
  const client = postgres(process.env.DATABASE_URL, { max: 1 });
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: path.join(__dirname, "../../drizzle") });
  await client.end();
}
```

---

### Step 5 — `server/index.ts` — async startup + CORS lockdown

Two changes in this file:

**a) CORS lockdown.** Replace `Access-Control-Allow-Origin: *` (or `cors({ origin: "*" })`) with an allowlist:
```ts
const ALLOWED_ORIGINS = (process.env.CORS_ORIGIN ?? "http://localhost:3001").split(",").map(s => s.trim());

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origin ${origin} not allowed`));
    }
  },
  credentials: true,
}));
```

**b) Async startup for migrations.** If `runMigrations()` is called at module top-level with `await`, wrap the server startup in an async IIFE:
```ts
(async () => {
  await runMigrations();
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
})();
```
Read the file first — it may already have an async pattern. Adapt accordingly.

---

### Step 6 — `server/router.ts` — ~30 async call-site fixes

Read the file. For every Drizzle query call:

- Remove `.run()` terminators — they don't exist in postgres-js. The query itself is the promise.
- `.all()` → just `await` the query directly (returns array)
- `.get()` → `await` the query, then `[0]` to get the first row (or undefined)
- Any function containing a Drizzle query must be `async` and `await` the query

Pattern examples:
```ts
// BEFORE (SQLite sync)
const rows = db.select().from(schema.deals).all();
const row = db.select().from(schema.deals).where(...).get();
db.insert(schema.deals).values(data).run();
db.update(schema.deals).set(data).where(...).run();
db.delete(schema.deals).where(...).run();

// AFTER (postgres-js async)
const rows = await db.select().from(schema.deals);
const row = (await db.select().from(schema.deals).where(...))[0];
await db.insert(schema.deals).values(data);
await db.update(schema.deals).set(data).where(...);
await db.delete(schema.deals).where(...);
```

**rowid references:** If any query uses `.where(eq(schema.deals.rowid, ...))` or similar SQLite rowid, replace with the appropriate PK column (likely `id`). Search for `rowid` across all server files.

tRPC route handlers must become `async` if they aren't already. Check every `.query()` and `.mutation()` handler.

---

### Step 7 — `server/lib/cities.ts` — 2 call-site fixes

Read this file. Find the `.get()` calls and convert to `(await query)[0]` pattern. Functions must be `async`.

---

### Step 8 — `server/services/fm-scraper.ts` — `upsertListings()` fix

Find the upsert block that currently reads:
```ts
const r: any = await db.insert(schema.fmListings).values(l).onConflictDoNothing().run();
if (r?.changes) inserted++;
```

Replace with the pg pattern:
```ts
const rows = await db.insert(schema.fmListings).values(l).onConflictDoNothing().returning({ id: schema.fmListings.id });
inserted += rows.length;
```

Also check for any other `.run()` or `.all()` or `.get()` in this file and fix them.

---

### Step 9 — `server/jobs/process-deals.ts` — 15+ call-site fixes

This file likely has the highest density of Drizzle calls. Read it and apply the same async/await pattern from Step 6. Every `.run()`, `.all()`, `.get()` must be converted. Every function that makes a DB call must be `async`.

---

### Step 10 — `server/services/geocode.ts` — timestamp write site

Find the insert that writes `createdAt`. It likely does something like:
```ts
createdAt: Date.now()  // or: Math.floor(Date.now() / 1000)
```

Since `geocodeCache.createdAt` is now a `timestamp` column, change to:
```ts
createdAt: new Date()
```

Also convert any sync Drizzle calls to async.

---

### Step 11 — Generate + push Drizzle migrations

```bash
# Generate migration files for pg dialect
npx drizzle-kit generate

# Push schema to the Supabase project (uses DATABASE_URL from .env)
npx drizzle-kit push
```

After `push`, verify in Supabase Dashboard (or via `list_tables` if MCP available) that all 6 tables exist: `deals`, `garage_sales`, `settings`, `geocode_cache`, `fm_listings`, `fm_scrape_jobs`.

---

### Step 12 — Type-check

```bash
npx tsc --noEmit
```

Fix any remaining type errors. Common ones after this migration:
- Functions that return sync types now return `Promise<T>` — update callers
- `BetterSQLite3Database` type still imported somewhere — remove it
- `integer` used for timestamp columns — check schema matches actual usage

---

### Step 13 — `drizzle.config.ts` — update dialect

If a `drizzle.config.ts` file exists, ensure it specifies:
```ts
dialect: "postgresql",
```
Not `sqlite`. Also ensure `out:` points to the `drizzle/` migrations folder.

---

## Done when

1. `npx tsc --noEmit` exits 0 (no type errors)
2. `npx drizzle-kit push` completes — all 6 tables exist in the Supabase project `hgntosqexnrnjiqettca`
3. `better-sqlite3` is removed from `package.json` dependencies
4. No `.run()`, `.all()`, `.get()` calls remain on Drizzle queries in the server codebase (grep to verify)
5. `server/index.ts` CORS is locked to the `CORS_ORIGIN` env var (no `*`)

---

## Security constraints (enforce — non-negotiable)

- `DATABASE_URL` lives in `.env` only — never commit, log, or expose it
- The target Supabase project is `hgntosqexnrnjiqettca` — NEVER `dmtctlpzlfpcogpjweuv` (that's the MC broker)
- Never push directly to `master` — branch is `phase-3-fm-scraper`
- Fresh empty DB — do not attempt to port or insert legacy SQLite data

---

## After you finish

1. Commit all changes: `git add -A && git commit -m "feat: SQLite → Postgres driver swap + schema migration"` (or split into logical commits — schema, driver, call sites)
2. Write `.claude/relay/handoff-2.md` using the phase-relay handoff format
3. Do NOT start Piece 3 (Railway deploy) — that's David's manual step

---

## Handoff format to write

```markdown
# Handoff — Piece 2 Complete

## What was completed
- [bullet list]
- Commits: [hash — message]
- Files modified: [paths]

## Key decisions made this piece
- [decision] — [why, one line]

## Gotchas for next agent
- [anything surprising]

## State I'm handing off
- Tests passing: [yes / no / N/A]
- Build clean: [yes / no — tsc --noEmit result]
- Branch: phase-3-fm-scraper
- Last commit: [hash]

## Where next agent starts
[Piece 3 is Railway deploy — David does this manually. The next automated piece is Piece 4: Vercel deploy via MCP.]
```
