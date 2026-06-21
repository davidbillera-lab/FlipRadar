# FlipRadar Path B Deploy — Phase Relay Plan

**Design spec:** `docs/superpowers/specs/2026-06-20-flipradar-path-b-deploy-design.md`
**Branch:** `phase-3-fm-scraper`
**MC project_id:** `95e468ba-d76b-4329-aef0-3c56289a96fa`
**Status:** Piece 1 in progress

---

## The 5 Pieces

| # | What | Who | Status |
|---|---|---|---|
| 1 | Supabase FlipRadar-prod project provision | Lead (Opus 4.8) via MCP | COMPLETE ✓ |
| 2 | SQLite → Postgres driver swap + ~42 call-site conversions | Fresh Sonnet 4.6 agent | IN PROGRESS |
| 3 | Railway backend deploy | David manually | PENDING |
| 4 | Vercel frontend deploy | Lead via Vercel MCP | PENDING |
| 5 | Smoke test + close-out + MC sync | qa-verifier + Lead | PENDING |

---

## Topology

```
Vercel (Next.js 14)  →  Railway (Express + tRPC, ALWAYS-ON)  →  Supabase Postgres (FlipRadar-dedicated)
```

## Security constraints (non-negotiable)
- FlipRadar Supabase project is FlipRadar-only — never `dmtctlpzlfpcogpjweuv` (that's MC/ebay-comps broker)
- `DATABASE_URL` and all keys in gitignored `.env` only — never commit, echo, or expose
- Fresh empty DB — scraper repopulates on first cron run
- Never push directly to `master`
- CORS: lock `Access-Control-Allow-Origin` to Vercel origin + `http://localhost:3001` via `CORS_ORIGIN` env var
- Railway must be always-on (non-sleeping) — node-cron dies silently if process sleeps

---

## Handoff trail
- `piece-1-out.md` — Supabase DATABASE_URL, project_id (written by Lead after provision)
- `brief-2.md` — Piece 2 brief for Sonnet 4.6 agent
- `handoff-2.md` — written by Piece 2 agent after completion
- `brief-3.md` — Piece 3 brief for David (manual Railway deploy)
- `handoff-3.md` — written by David / Lead after Railway is live
- `brief-4.md` — Piece 4 brief for Lead (Vercel MCP deploy)
- `handoff-4.md` — written after Vercel deploy
- `brief-5.md` — Piece 5 brief for qa-verifier
- `handoff-5.md` — final close-out
