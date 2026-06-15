import { db, schema } from "../db/index.js";
import { eq, isNull, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { identifyProduct } from "../services/llm.js";
import { lookupEbayComps } from "../services/ebay.js";
import { scoreDeal } from "../scoring.js";
import { sendTelegramAlert, formatDealAlert } from "../services/telegram.js";

const HIGH_ROI_THRESHOLD_DEFAULT = 35;
const MIN_NET_PROFIT_DEFAULT = 25;

async function getNumericSetting(key: string, fallback: number): Promise<number> {
  const row = await db.select().from(schema.settings).where(eq(schema.settings.key, key)).get();
  if (!row) return fallback;
  // settings are stored as JSON-encoded strings (e.g. "35"); strip quotes and parse
  let raw: any = row.value;
  try { raw = JSON.parse(row.value); } catch {}
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export async function processUnscoredDeals(): Promise<{ processed: number; flagged: number }> {
  const unscored = await db
    .select()
    .from(schema.deals)
    .where(or(isNull(schema.deals.score), isNull(schema.deals.ebayAvgSold)))
    .all();

  const roiThreshold = await getNumericSetting("roi_threshold_min", HIGH_ROI_THRESHOLD_DEFAULT);
  const minProfit = await getNumericSetting("min_profit_dollars", MIN_NET_PROFIT_DEFAULT);

  let flagged = 0;
  for (const deal of unscored) {
    try {
      const ident = await identifyProduct({
        title: deal.title,
        description: deal.description,
        askingPrice: deal.askingPrice,
      });
      const comps = await lookupEbayComps(ident.ebay_search_query);
      const score = scoreDeal({
        askingPrice: deal.askingPrice,
        ebayAvgSold: comps.avgPrice || null,
        ebayMedianSold: comps.medianPrice || null,
        compCount: comps.count,
        category: ident.category === "other" ? deal.category : ident.category,
        llmConfidence: ident.confidence,
      });

      const isHighRoi =
        (score.roiPct ?? 0) >= roiThreshold && (score.netProfit ?? 0) >= minProfit;

      await db
        .update(schema.deals)
        .set({
          aiBrand: ident.brand,
          aiModel: ident.model,
          aiProduct: ident.product,
          category: ident.category === "other" ? deal.category : ident.category,
          ebayAvgSold: comps.avgPrice || null,
          ebayCompCount: comps.count,
          ebaySearchQuery: ident.ebay_search_query,
          ebayFees: score.ebayFees,
          netProfit: score.netProfit,
          roiPct: score.roiPct,
          score: score.score,
          exitChannel: score.exitChannel,
          flaggedHighRoi: isHighRoi,
          updatedAt: new Date(),
        })
        .where(eq(schema.deals.id, deal.id));

      if (isHighRoi) {
        flagged++;
        await sendTelegramAlert(
          formatDealAlert({
            title: deal.title,
            askingPrice: deal.askingPrice,
            ebayAvgSold: comps.avgPrice || null,
            netProfit: score.netProfit,
            roiPct: score.roiPct,
            score: score.score,
            sourceUrl: deal.sourceUrl,
            city: deal.city,
            compConfidence: score.compConfidence,
            compCount: score.compCount,
          }),
        );
      }
    } catch (e) {
      console.error(`[process-deals] failed for ${deal.id}:`, (e as Error).message);
    }
  }

  return { processed: unscored.length, flagged };
}

/**
 * Re-evaluates only the high-ROI flag against current settings thresholds.
 * Cheap (no eBay/LLM calls) — runs purely against stored numbers.
 */
export async function rescoreHighRoiFlags(): Promise<{
  reviewed: number;
  newlyFlagged: number;
  unflagged: number;
}> {
  const roiThreshold = await getNumericSetting("roi_threshold_min", HIGH_ROI_THRESHOLD_DEFAULT);
  const minProfit = await getNumericSetting("min_profit_dollars", MIN_NET_PROFIT_DEFAULT);

  const scored = await db
    .select()
    .from(schema.deals)
    .where(sql`score IS NOT NULL`)
    .all();

  let newlyFlagged = 0;
  let unflagged = 0;

  for (const d of scored) {
    const shouldFlag =
      (d.roiPct ?? 0) >= roiThreshold && (d.netProfit ?? 0) >= minProfit;
    if (Boolean(d.flaggedHighRoi) !== shouldFlag) {
      await db
        .update(schema.deals)
        .set({ flaggedHighRoi: shouldFlag, updatedAt: new Date() })
        .where(eq(schema.deals.id, d.id))
        .run();
      if (shouldFlag) newlyFlagged++;
      else unflagged++;
    }
  }

  return { reviewed: scored.length, newlyFlagged, unflagged };
}

/**
 * Bridges unprocessed FM listings into the deals table so they ride the
 * existing identify → eBay comps → score → alert pipeline.
 * Does NOT run identification or scoring itself — processUnscoredDeals() handles that.
 */
export async function processFmListings(): Promise<{ processed: number }> {
  const listings = await db
    .select()
    .from(schema.fmListings)
    .where(eq(schema.fmListings.processed, false))
    .limit(50)
    .all();

  let processed = 0;

  for (const listing of listings) {
    try {
      // priceCents is nullable; skip listings with no price (can't score)
      const askingPrice =
        listing.priceCents != null ? listing.priceCents / 100 : null;

      if (askingPrice == null) {
        // Mark processed so we don't retry no-price listings every run
        await db
          .update(schema.fmListings)
          .set({ processed: true })
          .where(eq(schema.fmListings.id, listing.id))
          .run();
        continue;
      }

      const images: string[] = Array.isArray(listing.images) ? listing.images : [];
      const imageUrl = images[0] ?? null;

      const r: any = await db
        .insert(schema.deals)
        .values({
          id: randomUUID(),
          platform: "facebook",
          sourceUrl: listing.sourceUrl,
          title: listing.title,
          description: listing.description ?? null,
          city: listing.city,
          askingPrice,
          imageUrl,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoNothing()
        .run();

      // Whether we inserted or skipped (conflict), mark FM listing as processed
      await db
        .update(schema.fmListings)
        .set({ processed: true })
        .where(eq(schema.fmListings.id, listing.id))
        .run();

      if (r?.changes) processed++;
    } catch (e) {
      console.error(`[process-fm] failed for ${listing.id}:`, (e as Error).message);
    }
  }

  return { processed };
}

export async function getDealStats() {
  const total = await db.select({ c: sql<number>`count(*)` }).from(schema.deals).get();
  const avgScore = await db
    .select({ a: sql<number>`avg(score)` })
    .from(schema.deals)
    .get();
  const totalProfit = await db
    .select({ s: sql<number>`sum(net_profit)` })
    .from(schema.deals)
    .where(sql`flagged_high_roi = 1`)
    .get();
  const sold = await db
    .select({ c: sql<number>`count(*)` })
    .from(schema.deals)
    .where(sql`sold_at IS NOT NULL`)
    .get();
  const highRoi = await db
    .select({ c: sql<number>`count(*)` })
    .from(schema.deals)
    .where(sql`flagged_high_roi = 1`)
    .get();
  const top = await db
    .select()
    .from(schema.deals)
    .orderBy(sql`score DESC`)
    .limit(1)
    .get();

  return {
    totalDeals: Number(total?.c ?? 0),
    avgScore: Math.round(Number(avgScore?.a ?? 0)),
    totalProjectedProfit: Number(totalProfit?.s ?? 0),
    dealsSold: Number(sold?.c ?? 0),
    highRoiDeals: Number(highRoi?.c ?? 0),
    topDeal: top ? { deal: top } : null,
  };
}
