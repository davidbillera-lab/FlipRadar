# decisions.md — FlipRadar

Canonical log of meaningful decisions. Newest first. Every architectural/scope/direction change goes here with date + reasoning.

---

## 2026-06-13 — Sold comps come from a shared Mission Control service, not a per-app scraper

**Decision:** FlipRadar's `lookupEbayComps()` becomes a **thin client** of the shared
`ebay-sold-comps` edge function in Mission Control (Supabase `dmtctlpzlfpcogpjweuv`). FlipRadar
no longer calls eBay's Browse API and no longer runs comp math locally.

**Reasoning:** The old path hit eBay's free Browse API, which returns **active** listings (asking
prices), and used the median asking price as a proxy for sold price. Active > sold, so ROI was
systematically overstated (a $28 suitcase showed 5,794% ROI) — the single biggest threat to trust
and the #1 fix for sellability. VZT (PROTECTED) needs the same sold data, and MC is the portfolio's
shared credential broker, so the sold-data engine was built **once** behind **one** endpoint in MC
(Firecrawl-scraped eBay sold search, trimmed mean/median, 7-day cache, cost-logged). FlipRadar is
consumer #1; VZT is consumer #2 (contract doc only).

**Tradeoff given up:** A network hop + dependency on the MC endpoint (vs. a self-contained eBay API
call). Accepted because one trustworthy data source beats N drifting ones, and the engine is swappable
behind a provider seam (Firecrawl → Playwright/Apify/eBay Marketplace Insights) without any FlipRadar change.

---

## 2026-06-13 — Build FlipRadar toward a sellable SaaS asset (phased)

**Decision:** Treat FlipRadar as a Tier 2 portfolio asset with a SaaS exit thesis
(Flippa / Empire Flippers at a revenue multiple), built in foundation-first phases:

- **Phase 0 — Scaffolding & cleanup.** Delete stale nested worktree, verify `.env` gitignored, add OS docs
  (`CLAUDE.md`/`kill-criteria.md`/`decisions.md`/`model-routing.md`), create MC entry, push pending commits.
- **Phase 1 — Accurate sold comps via the shared service (TOP PRIORITY).** Rewire `lookupEbayComps()` to the
  MC endpoint; add comp-confidence (count + spread) to `server/scoring.ts`.
- **Phase 2 — Own the frontend.** Rebuild the black-box Vite bundle as Next.js on Vercel against the existing tRPC API.
- **Phase 3 — Facebook Marketplace (DECISION GATE).** Extension vs paid scraper vs authenticated Playwright. Deferred to operator.
- **Phase 4 — Multi-tenancy & billing.** Supabase auth + Stripe; per-tenant scoping and cost controls.

**Reasoning:** Fix the data-trust and ownership problems before adding users and billing. Each phase ships something usable.

**Fallback:** If SaaS economics don't materialize, FlipRadar survives as an internal inventory-sourcing feed for JSG/DOA.

---

## 2026-06-13 — Canonical repo is the outer `C:\Users\david\FlipRadar\` (master)

**Decision:** Deleted the stale nested `FlipRadar\FlipRadar\` repo (branch
`claude/complete-flipradar-push-2ECUX`). Its HEAD (`0156e2b`) was already in outer `master` history and it
held no unique files. The Firecrawl key was relocated from the nested `.env` into the outer gitignored `.env` first.

**Reasoning:** A duplicate nested repo is confusing and an acquisition red flag. One canonical repo, one source of truth.
