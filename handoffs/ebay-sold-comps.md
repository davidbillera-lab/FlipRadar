# HANDOFF — Shared eBay Sold-Comps Service (build in Mission Control)

**For:** an agent working in the **Mission Control / personal-OS** VSCode window.
**Origin:** drafted from the FlipRadar repo; FlipRadar is consumer #1, VZT is consumer #2.
**Status:** approved plan, not yet built. Build steps 1–4 here in MC, then step 5 returns to the FlipRadar window.
**MC Supabase project:** `dmtctlpzlfpcogpjweuv` (mission-control, ACTIVE_HEALTHY, us-west-2). No edge functions exist there yet — this is the first.

---

## Why we're building this

FlipRadar answers "is this flip worth buying?" — which requires knowing what an
item **actually sells for**. It currently doesn't. FlipRadar's `lookupEbayComps()`
hits the eBay **Browse API** (`item_summary/search`), which returns **active
listings only** (asking prices, not sale prices). Result: garbage ROI — a $28
suitcase comped against $1,988 of optimistic active listings → 5,794% ROI; a
$0-priced item → 4,520% ROI. Every downstream number inherits the error.

**Fix:** comp against eBay **SOLD** listings — real final prices eBay exposes
publicly at `&LH_Sold=1&LH_Complete=1` (no login, no API gate; the Marketplace
Insights API is effectively closed to new applicants).

**Why it lives in MC, not inside FlipRadar:** VZT needs the same sold-comp data
to price consignment inventory. The scraper needs a paid engine (Firecrawl) +
proxy credentials that belong in the MC vault, and MC is the portfolio's shared
credential broker. Build once, behind one endpoint — FlipRadar and VZT both call
it, neither holds the keys. Reuse of REELFLOW's edge-function pattern + MC's
vault, not a greenfield rebuild.

---

## Architecture

```
FlipRadar  ──┐
             ├──>  POST {MC}/functions/v1/ebay-sold-comps  ──> cache hit? return
VZT (later) ─┘            (Bearer: shared service token)         │ miss
                                                                 ▼
                                                          Firecrawl scrape
                                                    ebay.com/sch/i.html?_nkw=Q
                                                       &LH_Sold=1&LH_Complete=1
                                                                 │
                                                    parse → trim outliers → stats
                                                                 │
                                              write ebay_sold_comps cache (TTL 7d)
                                              log model_costs (engine=firecrawl)
                                                                 │
                                                         return EbayCompResult
```

---

## Build order

### Step 4 first — cache table (`apply_migration` on `dmtctlpzlfpcogpjweuv`)

```sql
create table if not exists public.ebay_sold_comps (
  query_norm   text primary key,           -- lowercased, trimmed search string
  avg_price    numeric,
  median_price numeric,
  sample_count int,
  listings     jsonb,                       -- top 5 sold comps: {title, price, soldDate, url}
  data_source  text default 'ebay_sold',
  scraped_at   timestamptz default now()
);
alter table public.ebay_sold_comps enable row level security;
-- no policies: access only via service role from the edge function
```
Staleness is handled in-function by `maxAgeDays` (default 7), not a cron — cheaper.

### Step 1 — provider seam (swappable engine)

In the function, define `CompsProvider` with one method:
`fetchSoldListings(query: string, limit: number) => Promise<RawSoldListing[]>`.
Ship `FirecrawlProvider` first. The seam lets us swap to Playwright/Apify later
without touching callers. Firecrawl is chosen because it owns Cloudflare/stealth/
proxy rotation and returns structured extraction — we don't want to own evasion.

Sold URL the provider builds:
```
https://www.ebay.com/sch/i.html?_nkw=<query>&LH_Sold=1&LH_Complete=1&_ipg=60
```
Extract per item: `title`, sold `price` (number), `condition`, `soldDate`,
`itemWebUrl`, `thumbnail`. Keep requests polite (<20/min, jittered) — Firecrawl
handles proxies but don't hammer.

### Step 2 — edge function `ebay-sold-comps`

Copy the **REELFLOW edge-function auth pattern**: JWT verification disabled in
the dashboard, manual auth in code. Here, verify a **shared service token**
(Bearer) — these are server-to-server calls, not user JWTs.

Flow:
1. Verify `Authorization: Bearer …` against `EBAY_COMPS_SERVICE_TOKEN` → 401 on mismatch.
2. Parse `{ query: string, limit?: number = 20, maxAgeDays?: number = 7 }`.
3. **Cache check:** `ebay_sold_comps` row for normalized query with
   `scraped_at > now() - maxAgeDays` → return immediately with `cached: true`.
4. Miss → `provider.fetchSoldListings(query, limit)`.
5. **Compute stats by porting FlipRadar's exact logic** (below) so numbers match
   across the portfolio: sort ascending, trim top & bottom 10%, mean = `avgPrice`,
   middle = `medianPrice`, `count` = total before trim.
6. Upsert the cache row; insert a `model_costs` row
   (`project`, `engine='firecrawl'`, pages scraped, est. cost) — standing cost-log rule.
7. Return the **`EbayCompResult` shape** (contract below) plus additive sold-only
   fields: `soldDate` per listing, `dataSource: 'ebay_sold'`, `cached: boolean`.

### Step 3 — secrets / credentials

- Set as **Supabase function secrets** on the MC project (runtime needs env vars):
  - `FIRECRAWL_API_KEY`
  - `EBAY_COMPS_SERVICE_TOKEN` (generate a long random string; this is what
    FlipRadar/VZT send as the Bearer)
- **Mirror both into MC's `vault_items` / `credentials` table** so they're
  documented, portable, and access-logged. Vault = source of record, function
  secrets = runtime copy.

---

## The `EbayCompResult` contract (must return this shape)

Ported from FlipRadar `server/services/ebay.ts` lines 45–60. Consumers already
depend on this exact shape — do not rename fields.

```ts
interface EbayComp {
  itemId: string;
  title: string;
  price: number;
  currency: string;        // "USD"
  condition?: string;
  itemWebUrl: string;
  soldDate?: string;       // additive — sold-only
}

interface EbayCompResult {
  query: string;
  avgPrice: number;        // trimmed mean, 2dp
  medianPrice: number;     // trimmed median, 2dp
  count: number;           // sample size before trim
  listings: EbayComp[];    // top 5
  dataSource?: "ebay_sold";// additive
  cached?: boolean;        // additive
}
```

### Stat logic to port verbatim (from FlipRadar ebay.ts:112–124)

```ts
const sorted = [...listings].sort((a, b) => a.price - b.price);
const trim = Math.floor(sorted.length * 0.1);
const trimmed = sorted.slice(trim, sorted.length - trim);
const sum = trimmed.reduce((acc, l) => acc + l.price, 0);
const avgPrice = trimmed.length > 0 ? sum / trimmed.length : 0;
const mid = Math.floor(trimmed.length / 2);
const medianPrice =
  trimmed.length === 0 ? 0
  : trimmed.length % 2 === 0
    ? ((trimmed[mid - 1]?.price ?? 0) + (trimmed[mid]?.price ?? 0)) / 2
    : (trimmed[mid]?.price ?? 0);
// return avgPrice & medianPrice rounded to 2dp; count = listings.length; listings.slice(0,5)
```

Empty result (no sold comps found): return
`{ query, avgPrice: 0, medianPrice: 0, count: 0, listings: [], dataSource: "ebay_sold" }`.

---

## Verification (do this before handing back to FlipRadar)

1. **Provider local:** `fetchSoldListings("dewalt dcd771c2", 20)` against the live
   sold page → ≥1 listing with a real sold price and `soldDate`.
2. **Deployed function:** `curl` with the service token → 200 + populated
   `EbayCompResult`. Repeat the same query → `cached: true`, faster. Bad token → 401.
3. **Cache:** `execute_sql` on `dmtctlpzlfpcogpjweuv` →
   `select * from ebay_sold_comps` shows the row, `scraped_at` recent.
4. **Cost log:** `select * from model_costs` shows a Firecrawl entry per cache-miss.

---

## Back to the FlipRadar window (step 5 — do NOT do this in MC)

Once the endpoint is verified live:
1. In `server/services/ebay.ts`, **keep** the exported `lookupEbayComps(query, limit)`
   signature and the `EbayCompResult` / `EbayComp` interfaces unchanged — every
   caller (scoring, jobs, router) keeps working untouched.
2. Replace the Browse-API body with a `fetch` to
   `${MC_FUNCTIONS_URL}/ebay-sold-comps` sending `Authorization: Bearer ${EBAY_COMPS_SERVICE_TOKEN}`
   and `{ query, limit }`; return the JSON as `EbayCompResult`.
3. Add `.env` keys: `MC_FUNCTIONS_URL`, `EBAY_COMPS_SERVICE_TOKEN`. The old
   `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET` / `EBAY_MARKETPLACE_ID` go dead for
   comps — leave or remove in a follow-up.
4. Update the stale doc comment that claims "active listings as a proxy."
   `estimateEbayFees()` is unaffected — leave it.
5. **Integration check:** run `processUnscoredDeals()` on a known deal; confirm
   comps reflect sold prices and the absurd ROIs (5,794% suitcase) collapse to
   realistic figures. Spot-check a Telegram alert.
6. Commit FlipRadar on a **branch** (the global rule: never push directly to main
   on protected projects; treat with care).

## VZT (consumer #2 — documented, not built here)
VZT is **PROTECTED**. Deliverable is only the contract doc above committed to the
monorepo so VZT swaps its eBay pricing call to this same endpoint on its own branch.

## Deferred / out of scope
Vision-based product ID; `$0-asking-price` ROI guardrail in FlipRadar `scoring.ts`
(fast follow — sold comps fix the numerator, not a $0 denominator); Facebook
assisted-scrape; monetization brainstorm.
