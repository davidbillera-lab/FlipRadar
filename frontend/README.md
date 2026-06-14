# FlipRadar — Next.js Frontend

This is the editable Next.js frontend for FlipRadar. It connects to the Express/tRPC backend via `NEXT_PUBLIC_API_URL`.

## Dev setup (two-process)

The backend (Express) and frontend (Next.js) run on separate ports in development.

**Terminal 1 — Backend (Express + tRPC, port 3001):**
```bash
# from repo root
PORT=3001 npm start
```

**Terminal 2 — Frontend (Next.js, port 3000):**
```bash
cd frontend
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in a browser.

## Environment variables

Create `frontend/.env.local` (gitignored) with:

```env
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=<your key from root .env>
```

In production, set these in your hosting environment (e.g. Vercel env config). `NEXT_PUBLIC_API_URL` must point at the deployed Express server URL.

## Pages

| Route | Description |
|---|---|
| `/` | Dashboard — deal list with scores and comp badges |
| `/deal/[id]` | Deal detail — comps, ROI, tracking form |
| `/garage-sales` | Garage sales map + list |
| `/tracking` | Purchased/sold deal tracker |
| `/settings` | Scoring thresholds, scraper cities |
| `/route` | Route planner — optimized driving order for garage sales |

## Build

```bash
cd frontend
npm run build
```

Lint + type-check:
```bash
npm run lint
npx tsc --noEmit
