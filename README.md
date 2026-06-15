# FlipRadar — Resale Arbitrage Agent

Autonomous resale arbitrage intelligence for Denver & Colorado Springs (or any city).
FlipRadar scrapes Facebook Marketplace, Craigslist, and EstateSales.net for under-priced
items, identifies them with Claude, looks up eBay sold comps, scores them by ROI, and
sends Telegram alerts for the best deals.

## Architecture

```
┌──────────────────────────┐        ┌──────────────────────────────┐
│  React SPA (compiled)    │ ─tRPC─ │  Express + tRPC server       │
│  src/index-*.js + .css   │        │  server/index.ts             │
│  Dashboard / DealDetail  │        │   ├─ scrape (cheerio)        │
│  GarageSales / Tracking  │        │   ├─ identify (Claude)       │
│  Settings                │        │   ├─ comp lookup (eBay API)  │
└──────────────────────────┘        │   ├─ score deals             │
                                    │   ├─ alert (Telegram)        │
                                    │   └─ SQLite (better-sqlite3) │
                                    └──────────────────────────────┘
```

## Features

- **Deal feed** with stats: total deals, avg score, best deal, projected profit
- **Deal scoring**: net profit & ROI after eBay fees, payment processing, ship reserve
- **High-ROI flagging** with configurable thresholds (default: ROI ≥ 35% and net profit ≥ $25)
- **Garage Sale Hunter**: map of garage and estate sales scraped from Craigslist + EstateSales.net
- **Tracking**: record purchase price and sold price to compute actual ROI per deal
- **Import URL**: paste any Facebook Marketplace or Craigslist listing URL to score a single item
- **Telegram alerts**: get pinged the moment a high-ROI deal hits the feed
- **Cron**: auto-runs deal scoring on a configurable schedule

## Routes

| Path             | Page                                                    |
| ---------------- | ------------------------------------------------------- |
| `/`              | Dashboard (deal feed, stats, filters, import URL)       |
| `/deal/:id`      | Deal detail (profit breakdown, eBay comps, tracking)    |
| `/garage-sales`  | Map and list of upcoming garage / estate sales          |
| `/tracking`      | Purchased & sold deals with actual ROI                  |
| `/settings`      | ROI threshold, AI model, scraper, Telegram settings     |

## tRPC procedures (`/api/trpc`)

- `deals.list({ category?, highRoiOnly?, platform?, tracking? })` — query
- `deals.get({ id })` — query
- `deals.runScraper({ city?, includeFacebook?, includeCraigslist?, includeEstateSales?, maxPrice? })` — mutation
- `deals.processDeals()` — mutation, scores all unscored deals
- `deals.importUrl({ url, city? })` — mutation
- `deals.updateTracking({ id, purchasePrice?, soldPrice?, notes? })` — mutation
- `garageSales.list({ city? })` — query
- `settings.get()` / `settings.set({ key, value })`

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Copy and fill in environment variables
cp .env.example .env
# Edit .env — at minimum set ANTHROPIC_API_KEY, EBAY_CLIENT_ID, EBAY_CLIENT_SECRET

# 3. Initialize the database
npm run db:migrate

# 4. Start the server (dev mode with hot-reload)
npm run dev
# or production mode
npm start
```

Open http://localhost:3000 — the dashboard will be empty until you run the scraper.

## Required credentials

| Env var               | How to get it                                                           |
| --------------------- | ----------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`   | https://console.anthropic.com → Settings → API keys                     |
| `EBAY_CLIENT_ID`      | https://developer.ebay.com/my/keys → create production app keyset       |
| `EBAY_CLIENT_SECRET`  | Same — the "Cert ID" field                                              |
| `TELEGRAM_BOT_TOKEN`  | (optional) chat with @BotFather, run `/newbot`                          |
| `TELEGRAM_CHAT_ID`    | (optional) message your bot, then GET `/getUpdates` to read chat.id     |

## Scheduled scoring

`score_deals.sh` triggers the scoring endpoint via cron (e.g. on a serverless host).
The server also runs an in-process cron job on `SCRAPER_CRON` (default every 30 min).

```bash
# Set in your env:
export SCHEDULED_TASK_ENDPOINT_BASE=https://your-domain.com
export SCHEDULED_TASK_COOKIE=...

# Triggered by an external scheduler:
./score_deals.sh
```

## Notes

- **Facebook Marketplace** blocks unauthenticated scraping. The bulk scraper logs a
  warning and skips it. To score a Facebook listing, use the **Import URL** form on
  the dashboard while signed in to FB in your browser (the server fetches the public
  preview metadata).
- **eBay sold comps**: the public Browse API returns *active* listings (used here as a
  conservative comp). For true sold listings, eBay requires the restricted-access
  Marketplace Insights API.
- **Map**: the `Map.tsx` component uses the Google Maps JS SDK; supply a key via the
  page's HTML if you wire it back in.

## Layout

```
.
├── server/                       # Backend (Node + tRPC + SQLite)
│   ├── index.ts                  # Express entry, mounts tRPC, serves SPA
│   ├── router.ts                 # tRPC router (deals, garageSales, settings)
│   ├── trpc.ts                   # tRPC instance
│   ├── scoring.ts                # ROI / score heuristic
│   ├── db/
│   │   ├── index.ts              # Drizzle + better-sqlite3
│   │   ├── schema.ts             # Drizzle table definitions
│   │   └── migrate.ts            # Idempotent CREATE TABLE migration
│   ├── jobs/
│   │   ├── process-deals.ts      # Identify → comps → score → alert pipeline
│   │   └── score-deals.ts        # CLI entry for cron (`npm run score-deals`)
│   └── services/
│       ├── ebay.ts               # eBay Browse API + fee estimator
│       ├── llm.ts                # Anthropic Claude product identifier
│       ├── telegram.ts           # Telegram alert sender
│       └── scraper.ts            # Craigslist / EstateSales / FB-import-url
├── src/                          # Compiled frontend bundle (Vite output)
│   ├── index-DOKjpJlx.js
│   ├── index-h1dH8hq2.css
│   ├── api/deals.ts              # Re-exports server processDeals
│   ├── services/{ebay,llm}.ts    # Re-export server services
│   └── utils/telegram.ts         # Re-exports server alert
├── response.html                 # Frontend index (SPA shell)
├── score_deals.sh                # Curl-based scheduled trigger
├── package.json
├── tsconfig.json
└── .env.example
```
