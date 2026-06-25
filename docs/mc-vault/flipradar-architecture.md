# FlipRadar — Architecture Knowledge (MC Vault Entry)

**Vault type:** knowledge
**Tags:** flipradar, architecture, deploy, schema, decisions, stack
**Project ID:** 95e468ba-d76b-4329-aef0-3c56289a96fa

---

## What FlipRadar Is

A resale-arbitrage agent. Scrapes local marketplaces (Craigslist, EstateSales.net, Facebook Marketplace), identifies items with Claude, looks up eBay **sold** comps via the shared MC endpoint, scores deals by net profit / ROI after fees, and fires Telegram alerts for the best ones. Also runs a Garage Sale Hunter map and route planner for in-person sourcing.

**Exit thesis:** SaaS → Flippa / Empire Flippers at a revenue multiple. Fallback: internal inventory-sourcing feed for JSG estate liquidation.
**Tier:** 2 (active build with exit potential)
**GitHub:** `FlipRadar` repo, primary branch `master`, active build branch `phase-3-fm-scraper`

---

## Production Topology

```
Vercel (Next.js 14 App Router)
        ↓  HTTPS + tRPC
Railway (Express + tRPC v11, ALWAYS-ON — non-sleeping tier required)
        ↓  postgres-js / Drizzle ORM
Supabase Postgres — project hgntosqexnrnjiqettca (FlipRadar-dedicated)
```

**CRITICAL:** FlipRadar Supabase project is `hgntosqexnrnjiqettca`.
Never use `dmtctlpzlfpcogpjweuv` — that is the Mission Control / ebay-sold-comps broker project.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node ≥ 20 |
| Backend framework | Express + tRPC v11 (`server/index.ts`, `server/router.ts`) |
| Backend language | TypeScript via `tsx` |
| Database ORM | Drizzle ORM (`drizzle-orm/pg-core`) |
| DB driver | `postgres-js` |
| Migrations | `drizzle-orm/postgres-js/migrator` — reads from `./drizzle/` folder |
| Scheduler | `node-cron` (runs in-process — Railway MUST be always-on) |
| Frontend | Next.js 14 App Router (`frontend/` directory) |
| Frontend deploy | Vercel |
| Backend deploy | Railway (always-on, non-sleeping tier) |
| Database | Supabase Postgres (`hgntosqexnrnjiqettca`) |
| Item identification | Anthropic SDK (`server/services/identify.ts`) |
| eBay sold comps | Shared MC endpoint — FlipRadar is a thin client only |
| Alerts | Telegram bot |
| FM scraping | Apify API (`APIFY_FACEBOOK_API_KEY`) |
| Geocoding | Google Maps API |

---

## Database Schema (Supabase `hgntosqexnrnjiqettca`)

Migration file: `drizzle/0000_next_steel_serpent.sql`
Schema file: `server/db/schema.ts`

### deals
Primary key: `id` (text)
Columns: platform, source_url, title, description, category, city, asking_price (real), image_url, ai_brand, ai_model, ai_product, ebay_avg_sold (real), ebay_comp_count (int), ebay_search_query, ebay_fees (real), net_profit (real), roi_pct (real), score (int), exit_channel, flagged_high_roi (boolean), purchase_price (real), sold_price (real), actual_roi (real), sold_at (timestamp), tracking_notes, created_at (timestamp), updated_at (timestamp)

### fm_listings
Primary key: `id` (text)
Columns: city, title, price_cents (int), location_text, source_url, description, images (jsonb default []), posted_at (timestamp), scraped_at (timestamp), processed (boolean)

### fm_scrape_jobs
Primary key: `city` (text)
Columns: last_scraped_at (timestamp), status (text default 'pending'), listings_found (int default 0), error_msg

### garage_sales
Primary key: `id` (text)
Columns: platform, source_url, title, description, city, address, lat (real), lng (real), sale_date, status (default 'upcoming'), notes, images (jsonb default []), created_at (timestamp)

### geocode_cache
Primary key: `address` (text)
Columns: lat (real), lng (real), formatted, created_at (timestamp)

### settings
Primary key: `key` (text)
Columns: value (text)

**RLS status:** Disabled on all 6 tables through Phase 3 (intentional — see Key Decisions below).

---

## Shared eBay Sold-Comps Service

FlipRadar does NOT run its own eBay scraper. It is a thin client of the portfolio-shared edge function.

- **Endpoint:** `POST https://dmtctlpzlfpcogpjweuv.supabase.co/functions/v1/ebay-sold-comps`
- **Auth:** `Authorization: Bearer ${EBAY_COMPS_SERVICE_TOKEN}`
- **Request:** `{ query: string, limit?: number (default 20, max 60) }`
- **Response:** `{ query, avgPrice, medianPrice, count, listings[≤5], dataSource: "ebay_sold", cached: bool }`
- **Client file:** `server/services/ebay.ts` → `lookupEbayComps()`
- **Why:** Returns real eBay SOLD prices (not active/asking). Built once in MC because VZT needs the same data. One trustworthy source beats N drifting scrapers.

---

## Key Decisions

### RLS disabled through Phase 3 (enable in Phase 4)
All DB access routes through the Railway Express/tRPC backend via `DATABASE_URL` (service-level credentials). The frontend never calls Supabase directly. RLS with anon-key policies is only needed when a browser client calls Supabase directly — that's Phase 4 (Supabase auth + multi-tenant). **Do NOT enable RLS without policies — enabling RLS with no policies blocks all access.**

### SQLite → Postgres: fresh empty DB, no data migration
SQLite data was ephemeral dev/test data with no production value. The scraper is the source of truth and repopulates on first cron run.

### Sold comps from shared MC service, not a per-app scraper
Prior implementation hit eBay's Browse API which returns active (asking) prices — ROI was systematically overstated. Rewired to MC shared endpoint returning Firecrawl-scraped eBay sold prices (trimmed mean/median, 7-day cache). FlipRadar is consumer #1; VZT is consumer #2.

### Backend-only DB access pattern
Frontend (Vercel) calls Railway tRPC only. Railway calls Supabase via `DATABASE_URL`. The Supabase anon key is never exposed to the browser and never used for data queries in this architecture.

---

## Environment Variables Required (Railway)

| Variable | Source |
|---|---|
| `DATABASE_URL` | Supabase Dashboard → project `hgntosqexnrnjiqettca` → Settings → Database → Connection string → URI (direct, not pooler) |
| `ANTHROPIC_API_KEY` | Anthropic console |
| `EBAY_COMPS_SERVICE_TOKEN` | MC vault credential |
| `TELEGRAM_BOT_TOKEN` | Telegram BotFather |
| `TELEGRAM_CHAT_ID` | Telegram |
| `GOOGLE_MAPS_API_KEY` | Google Cloud Console |
| `APIFY_FACEBOOK_API_KEY` | Apify console |
| `CORS_ORIGIN` | Comma-separated list: Vercel URL + `http://localhost:3001` |
| `PORT` | Do NOT set — Railway injects automatically |

## Environment Variables Required (Vercel)

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | Railway backend URL (e.g. `https://flipradar-production.up.railway.app`) |

---

## Security Constraints (Non-Negotiable)

1. FlipRadar Supabase project is `hgntosqexnrnjiqettca` — NEVER `dmtctlpzlfpcogpjweuv`
2. `DATABASE_URL` and all keys in Railway Variables only — never in code, never committed
3. CORS locked to Vercel origin + `http://localhost:3001` via `CORS_ORIGIN` env var — no wildcard
4. Railway must be always-on (non-sleeping) — node-cron dies silently if process sleeps
5. Never push directly to `master` — work on branches

---

## Phase Plan (phased SaaS build)

- **Phase 0 — Scaffolding:** COMPLETE. OS docs, MC entry, canonical repo established.
- **Phase 1 — Accurate sold comps:** COMPLETE. Rewired to MC shared endpoint; comp-confidence scoring added.
- **Phase 2 — Own the frontend:** COMPLETE. Next.js 14 App Router in `frontend/`; Vite black-box retired.
- **Phase 3 — Production deploy (current):** SQLite → Postgres COMPLETE. Railway deploy PENDING (David manual). Vercel deploy PENDING. FM scraper (Apify, keyword-set-per-city) COMPLETE.
- **Phase 4 — Multi-tenancy & billing:** Supabase auth + Stripe, per-tenant scoping, RLS enabled, `model_costs` table.

### Phase 3 Deploy Relay State (as of 2026-06-25)
| Piece | What | Status |
|---|---|---|
| 1 | Supabase provision (`hgntosqexnrnjiqettca`) | COMPLETE ✓ |
| 2 | SQLite → Postgres driver swap + ~42 call-site conversions | COMPLETE ✓ |
| 3 | Railway backend deploy | PENDING — David manual (see `.claude/relay/brief-3.md`) |
| 4 | Vercel frontend deploy | PENDING — Lead via Vercel MCP |
| 5 | Smoke test + close-out | PENDING |

---

## Key Files

| File | Purpose |
|---|---|
| `server/index.ts` | Express app, CORS lockdown, async startup with runMigrations() gate |
| `server/router.ts` | tRPC router, all routes |
| `server/db/schema.ts` | Drizzle schema — all 6 tables |
| `server/db/index.ts` | postgres-js client + Drizzle instance |
| `server/db/migrate.ts` | Runs drizzle-orm/postgres-js/migrator on startup |
| `server/services/ebay.ts` | `lookupEbayComps()` thin client + `estimateEbayFees()` |
| `server/services/fm-scraper.ts` | Apify-based FM scraper, city-keyword sets |
| `server/services/identify.ts` | Claude item identification |
| `server/scoring.ts` | ROI scoring with comp-confidence weighting |
| `drizzle.config.ts` | Drizzle Kit config (dialect: postgresql, out: ./drizzle/) |
| `drizzle/0000_next_steel_serpent.sql` | Applied migration — all 6 tables as Postgres DDL |
| `frontend/` | Next.js 14 App Router source |
| `decisions.md` | Full decision log with reasoning |
| `.claude/relay/` | Phase 3 deploy relay handoff trail |

---

## Infrastructure IDs

| Resource | ID / Value |
|---|---|
| MC project_id | `95e468ba-d76b-4329-aef0-3c56289a96fa` |
| Supabase project (FlipRadar) | `hgntosqexnrnjiqettca` |
| Supabase host | `db.hgntosqexnrnjiqettca.supabase.co` |
| Supabase API URL | `https://hgntosqexnrnjiqettca.supabase.co` |
| Supabase region | us-east-1 |
| Railway URL | TBD — update after Piece 3 |
| Vercel URL | TBD — update after Piece 4 |

---

*Last updated: 2026-06-25. Update Railway URL and Vercel URL after Pieces 3 and 4 complete.*
