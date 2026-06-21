# Handoff — Piece 1 Complete (Supabase FlipRadar-prod Provision)

## What was completed
- Provisioned a new dedicated Supabase Postgres project for FlipRadar (us-east-1)
- Project is ACTIVE_HEALTHY
- Captured API URL and publishable/anon keys
- **Did NOT touch** the MC/ebay-comps broker project `dmtctlpzlfpcogpjweuv` — these are completely separate

## Supabase FlipRadar-prod project values

| Key | Value |
|-----|-------|
| project_id / ref | `hgntosqexnrnjiqettca` |
| region | us-east-1 |
| DB host | `db.hgntosqexnrnjiqettca.supabase.co` |
| API URL | `https://hgntosqexnrnjiqettca.supabase.co` |
| Anon / legacy key | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhnbnRvc3FleG5ybmppcWV0dGNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwMjIyMjEsImV4cCI6MjA5NzU5ODIyMX0.3QqN57bX4MZk8UW-7eDPB0kviqjVmEK6NE-9VtW_Xnw` |
| Publishable key | `sb_publishable_l4sejIPHC5sF5QPX5pJBPw_g3BErIk-` |

## DATABASE_URL — David must fill in manually

The MCP provisioning tool does **not** return the database password. David must:
1. Go to [Supabase Dashboard → Project hgntosqexnrnjiqettca → Project Settings → Database → Connection string → URI](https://supabase.com/dashboard/project/hgntosqexnrnjiqettca/settings/database)
2. Use the **direct connection** (not pooler) URI
3. Copy the full URI (format: `postgresql://postgres:[PASSWORD]@db.hgntosqexnrnjiqettca.supabase.co:5432/postgres`)
4. Paste it as `DATABASE_URL=` in gitignored `.env` at the project root

**Never commit the DATABASE_URL. Never echo it to the console. It lives in .env only.**

## DB state at handoff
- Fresh empty project — no tables yet (pre-migration)
- Schema will be applied by Piece 2 agent via `npx drizzle-kit push` against this project

## Gotchas for next agent
- The anon key above is the **publishable** key — safe to reference in frontend config. It is NOT a service-role key.
- Always use `hgntosqexnrnjiqettca` — never `dmtctlpzlfpcogpjweuv` (that's MC/ebay-comps, separate project)
- `DATABASE_URL` must be in `.env` before the Piece 2 agent can run `db:migrate`

## State I'm handing off
- Tests passing: N/A (infrastructure provision)
- Build clean: yes (no code changes in Piece 1)
- Branch: `phase-3-fm-scraper`
- DB: ACTIVE_HEALTHY, empty

## Where Piece 2 agent starts
1. Confirm `DATABASE_URL` is set in `.env` (ask David if it isn't)
2. `server/db/schema.ts` — convert SQLite schema to pg-core
3. `server/db/index.ts` — swap driver
4. Then the ~40 call sites across router/jobs/services
