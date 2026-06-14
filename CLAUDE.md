# CLAUDE.md — FlipRadar

**Location:** `<flipradar-repo>/CLAUDE.md` (committed)
**Purpose:** Source of truth for what FlipRadar is, how it's built, and how any agent should work on it.
**Read first:** `~/.claude/CLAUDE.md` (operator profile), then this file.
**Mission Control project_id:** `95e468ba-d76b-4329-aef0-3c56289a96fa`

---

## What This Is

A resale-arbitrage agent. FlipRadar scrapes local marketplaces (Craigslist, EstateSales.net,
Facebook Marketplace stub), identifies items with Claude, looks up eBay **sold** comps, scores
deals by net profit / ROI after fees, and fires Telegram alerts for the best ones. It also runs
a "Garage Sale Hunter" map and a route planner for in-person sourcing.

Currently single-user and local-only. **Decision (2026-06-13): build toward a sellable SaaS asset**
(exit thesis: Flippa / Empire Flippers at a revenue multiple), or as an inventory-sourcing feed for
the JSG estate-liquidation parent. Tier 2 (active build with exit potential).

---

## Tech Stack

- **Server:** Node ≥20, Express + tRPC v11 (`server/index.ts`, `server/router.ts`), TypeScript via `tsx`.
- **DB:** local SQLite via `better-sqlite3` + Drizzle ORM (`server/db/schema.ts`). Migrates via `npm run db:migrate`.
- **Scraping:** `cheerio` + `undici` (`server/services/scraper.ts`).
- **Item ID:** Anthropic SDK (`server/services/identify.ts` / Claude).
- **Comps:** eBay **sold** prices via the shared Mission Control `ebay-sold-comps` endpoint (see below).
- **Alerts:** Telegram bot.
- **Cron:** `node-cron` on a configurable schedule.
- **Frontend:** Next.js 14 App Router (`frontend/`) — editable source in repo. Deployed as a separate process from the Express backend. See `frontend/README.md` for dev setup.

### Shared sold-comps service (the data backbone)

FlipRadar does **not** run its own eBay scraper. It is a **thin client** of the portfolio-shared
`ebay-sold-comps` edge function in Mission Control (Supabase `dmtctlpzlfpcogpjweuv`).

- Endpoint: `POST https://dmtctlpzlfpcogpjweuv.supabase.co/functions/v1/ebay-sold-comps`
- Auth: `Authorization: Bearer ${EBAY_COMPS_SERVICE_TOKEN}` (in gitignored `.env`)
- Contract doc: `personal-os/docs/shared-services/ebay-sold-comps.md` (canonical) + MC vault.
- Why: real eBay **sold** prices (not active/asking) so ROI is believable. Built once in MC because
  VZT needs the same data and MC is the shared credential broker.

`server/services/ebay.ts` holds `lookupEbayComps()` (the thin client) and `estimateEbayFees()` (local fee math).

---

## Known Debt / Risks (acquisition lens)

1. **Phase 2 complete — frontend is editable source.** Next.js 14 App Router lives in `frontend/`;
   the compiled Vite black-box and bundle-rewrite hack are retired. No longer an acquisition red flag.
2. **AppRouter type coupling (minor).** `frontend/lib/trpc.ts` imports `AppRouter` from `../../server/router`
   via a relative path outside `frontend/tsconfig.json`'s `include`. Works for local dev and Vercel (types
   only, not compiled into the bundle), but a formal monorepo boundary (shared `types/` package) would be
   cleaner — deferred to Phase 4.
3. **Single-tenant.** Hardcoded local-user auth stub (`auth.me` in `server/router.ts`) → Phase 4 moves to
   Supabase auth + Stripe billing.
4. **Facebook Marketplace** is a stub (`server/services/scraper.ts:~298`) — no clean unauthenticated path;
   decision gate in Phase 3 (extension vs paid scraper vs Playwright).

See `decisions.md` for the full phased plan and `kill-criteria.md` for when to stop.

---

## Standing Rules (project-specific — additive to global)

1. **Sold comps come from the shared MC endpoint, never a per-app scraper.** One data source, many consumers.
2. **Never push directly to `master`/`main`.** Work on a branch; treat this repo with care.
3. **`.env` holds real keys** (Anthropic, eBay, Telegram, Google Maps, Firecrawl, service token). It is gitignored.
   Never commit, echo, or expose. Rotate anything ever committed.
4. Log model usage to a `model_costs` table per OS rules once multi-tenant.
5. Update this file when reality changes. Stale context is worse than none.

---

## Last Updated

2026-06-13 — Scaffolding added; comps rewired to shared MC sold-comps service.
2026-06-13 — Phase 2 complete: Next.js frontend in `frontend/`; Vite bundle + rewrite hack retired; XSS fix; port defaults corrected; tsconfig isolated.
