# kill-criteria.md — FlipRadar

The four kill criteria. Reviewed at every phase gate. A "fail" gets surfaced to the operator within 24h.

| Criterion | Kill if… | Current status (2026-06-13) |
|---|---|---|
| **Functionality** | Sold-comp ROI numbers can't be made believable (estimates don't track real eBay sold prices within a reasonable band) | **Warning → fixing.** Old path used eBay *active* (asking) prices as a proxy → systematic ROI overstatement (a $28 suitcase showed 5,794% ROI). Phase 1 rewires to real sold comps via the shared MC endpoint. Re-evaluate after back-test. |
| **Efficiency** | Per-deal cost (scrape + Claude ID + comp lookup) exceeds the value of the signal, or scraping is too fragile to run unattended | **Pass (provisional).** Sold-comp calls are cached 7 days in MC; Firecrawl ~$0.01/uncached lookup. Local marketplace scrapers are cheap but layout-fragile. |
| **Scalability** | Can't go multi-tenant without a rewrite that costs more than the asset is worth | **Warning.** Single-tenant SQLite + hardcoded auth stub + black-box frontend. Phases 2 & 4 address; if rebuild cost balloons, reconsider as a JSG-internal tool only. |
| **Time-to-revenue** | No credible path to paying users / acquisition interest within a reasonable window | **Unproven.** No paying users yet. SaaS turn-on is Phase 4. Fallback value: inventory-sourcing feed for the JSG/DOA estate-liquidation parent (justifies the build regardless of SaaS outcome). |

## Hard kill triggers

- Sold-comp data source becomes unavailable/unviable **and** no swap-in works behind the provider seam → comps are the whole product; without trustworthy comps, kill.
- eBay/marketplace ToS enforcement makes the scrape posture untenable with no licensed-data path.
- After Phase 2+3, still no signal that anyone outside the operator will pay → demote to JSG-internal tool, stop SaaS investment.

## Fallback (not a kill)

If SaaS economics don't materialize, FlipRadar survives as an **internal sourcing feed** for JSG/DOA.
That outcome is a win, not a kill — it just changes the exit thesis from "sell the SaaS" to "operational leverage."
