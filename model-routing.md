# model-routing.md — FlipRadar

Project-specific model/tool routing. Additive to the global tiers in `~/.claude/CLAUDE.md`.
Default to the cheapest tier that does the job; escalate only when being wrong costs real time/money.

## Runtime model calls (in-app)

| Job | Tier | Model | Notes |
|---|---|---|---|
| Item identification from listing title/desc | **1** | Haiku 4.5 (Anthropic SDK, `server/services/identify.ts`) | High volume, one call per scraped listing. Never escalate to Opus for routine ID. |
| Image-based product ID (deferred idea) | **4** | Gemini Vision + Nano Banana 2 | Stack default for multimodal; better than trusting junk seller titles. Only when Phase 1 data is trusted. |
| Sold-comp lookup | n/a (not a model call) | Shared MC `ebay-sold-comps` endpoint (Firecrawl behind the seam) | Cost logged in MC `model_costs`, not here, until FlipRadar is multi-tenant. |
| Negotiation-message drafting (deferred) | **2** | Sonnet 4.6 + copywriter human-voice pass | Customer-facing → no AI-template feel. |

## Build/agent work (on the repo)

| Job | Tier | Tool |
|---|---|---|
| Thin-client comps rewrite, scoring changes (Phase 1) | 3 | Claude Code (strong codebase context) |
| Next.js frontend rebuild (Phase 2) | 2–3 | Claude Code; design pass as needed |
| Second-opinion review on critical commits | 2 | Codex / GPT-5.x (`CodexQC`) |
| Routine triage / doc drafts | 1 | Haiku / Flash |

## Cost discipline

- The sold-comps engine is cached 7 days in MC — a cache hit costs $0. Don't add a second comp source per-app.
- Item ID is the main recurring spend. Keep it Tier 1. Batch where possible.
- Once multi-tenant (Phase 4), log per-tenant model usage to a `model_costs` table per OS rules.
