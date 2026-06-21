# Phase Relay — Piece 3 of 5: Railway Backend Deploy

**This is a manual piece — you (David) do all of this in Railway's dashboard and terminal.**

---

## Where Things Stand

- Supabase `hgntosqexnrnjiqettca` is live, all 6 tables created ✓
- Server code is fully converted to Postgres (branch `phase-3-fm-scraper`) ✓
- Code is committed and pushed to GitHub ✓
- Next: get the Express/tRPC backend running on Railway, pointed at Supabase

---

## What You're Deploying

**Railway service:** Express + tRPC backend (`server/index.ts`)
**Start command:** `npm run start` (or `npx tsx server/index.ts`)
**Tier:** Always-on (non-sleeping) — node-cron dies silently if Railway sleeps the process

---

## Step 1 — Create a new Railway project

1. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub repo
2. Select `FlipRadar` → branch `phase-3-fm-scraper`
3. Railway will detect Node.js automatically

---

## Step 2 — Set the start command

In Railway → Service Settings → Deploy → Start Command:

```
npx tsx server/index.ts
```

Or if you've added a `start` script to `package.json`:

```
npm run start
```

Check `package.json` — if `"start"` runs `tsx server/index.ts`, either works.

---

## Step 3 — Set environment variables

In Railway → Service → Variables, add ALL of these:

| Variable | Where to get it |
|---|---|
| `DATABASE_URL` | Supabase Dashboard → Project `hgntosqexnrnjiqettca` → Settings → Database → Connection string → URI (use **direct**, not pooler) |
| `ANTHROPIC_API_KEY` | Your `.env` |
| `EBAY_COMPS_SERVICE_TOKEN` | Your `.env` (this is the MC shared service token) |
| `TELEGRAM_BOT_TOKEN` | Your `.env` |
| `TELEGRAM_CHAT_ID` | Your `.env` |
| `GOOGLE_MAPS_API_KEY` | Your `.env` |
| `APIFY_FACEBOOK_API_KEY` | Your `.env` |
| `CORS_ORIGIN` | Set to your Vercel URL once you know it (Piece 4). For now: `http://localhost:3001` — update after Piece 4. |
| `PORT` | Leave unset — Railway injects this automatically |

**DATABASE_URL format:**
```
postgresql://postgres:[PASSWORD]@db.hgntosqexnrnjiqettca.supabase.co:5432/postgres
```

---

## Step 4 — Always-on tier (CRITICAL)

In Railway → Service Settings → Scaling:
- Set to **always-on** (non-sleeping tier)
- The node-cron scheduler in `server/index.ts` runs in-process. If Railway sleeps the server, cron stops silently and deals stop flowing.
- On Hobby plan, go to Settings → Sleeping → **Disable sleep**

---

## Step 5 — Deploy and check logs

1. Trigger a deploy (Railway redeploys on push automatically, or click "Deploy Now")
2. Watch Railway logs for:
   ```
   Migrations applied successfully
   Server running on port XXXX
   ```
3. The first boot runs `runMigrations()` — since tables already exist in Supabase (created via MCP), Drizzle's migrator will see the migration is already applied and skip it. This is safe.

---

## Step 6 — Smoke-test the backend

Once deployed, Railway gives you a public URL like `https://flipradar-production.up.railway.app`.

Test that tRPC is alive:

```bash
curl https://YOUR-RAILWAY-URL/trpc/settings.getAll
```

Should return JSON (even if empty settings). If you get a 200 or a valid tRPC error response, the backend is up.

---

## Step 7 — Note the Railway URL

You need this for Piece 4 (Vercel deploy). Write it down:

```
RAILWAY_URL = https://____________________________
```

Also update `CORS_ORIGIN` in Railway Variables to include your Vercel URL once Piece 4 is done.

---

## After You're Done

Write (or have Lead write) `.claude/relay/handoff-3.md` with:
- The Railway service URL
- Confirmation that logs showed clean startup
- Confirmation that the smoke-test curl returned valid JSON
- Any gotchas you hit

Then signal Lead to proceed with Piece 4 (Vercel frontend deploy via MCP).

---

## Security reminders

- `DATABASE_URL` and all keys go in Railway Variables only — never in code
- Target Supabase project is `hgntosqexnrnjiqettca` — never `dmtctlpzlfpcogpjweuv`
- Branch is `phase-3-fm-scraper` — never push to `master`
