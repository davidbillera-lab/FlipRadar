import { db, schema } from "../db/index.js";
import { eq, isNull, or, sql } from "drizzle-orm";
import { identifyProduct } from "../services/llm.js";
import { lookupEbayComps } from "../services/ebay.js";
import { scoreDeal } from "../scoring.js";
import { sendTelegramAlert, formatDealAlert } from "../services/telegram.js";

const HIGH_ROI_THRESHOLD_DEFAULT = 35; // %
const MIN_NET_PROFIT_DEFAULT = 25; // $

async function getNumericSetting(key: string, fallback: number): Promise<number> {
  const row = await db.select().from(schema.settings).where(eq(schema.settings.key, key)).get();
  if (!row) return fallback;
  const n = Number(row.value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Score every un-scored deal in the DB. Idempotent.
 */
export async function processUnscoredDeals(): Promise<{ processed: number; flagged: number }> {
  const unscored = await db
    .select()
    .from(schema.deals)
    .where(or(isNull(schema.deals.score), isNull(schema.deals.ebayAvgSold)))
    .all();

  const roiThreshold = await getNumericSetting("roi_threshold", HIGH_ROI_THRESHOLD_DEFAULT);
  const minProfit = await getNumericSetting("min_net_profit", MIN_NET_PROFIT_DEFAULT);

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
          }),
        );
      }
    } catch (e) {
      console.error(`[process-deals] failed for ${deal.id}:`, (e as Error).message);
    }
  }

  return { processed: unscored.length, flagged };
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
    topDeal: top ? { deal: top } : null,
  };
}
