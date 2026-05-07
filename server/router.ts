import { z } from "zod";
import { router, publicProcedure } from "./trpc.js";
import { db, schema } from "./db/index.js";
import { eq, sql, and, type SQL } from "drizzle-orm";
import { processUnscoredDeals, getDealStats } from "./jobs/process-deals.js";
import {
  scrapeCraigslist,
  scrapeCraigslistGarageSales,
  scrapeFacebookMarketplace,
  scrapeEstateSalesNet,
  importListingFromUrl,
} from "./services/scraper.js";
import { randomUUID } from "node:crypto";

const CATEGORIES = ["electronics", "antiques", "collectibles", "power_tools"] as const;

export const appRouter = router({
  deals: router({
    list: publicProcedure
      .input(
        z
          .object({
            category: z.string().optional(),
            highRoiOnly: z.boolean().optional(),
            platform: z.enum(["facebook", "craigslist", "estatesales"]).optional(),
            tracking: z.boolean().optional(),
          })
          .optional(),
      )
      .query(async ({ input }) => {
        const conds: SQL[] = [];
        if (input?.category && input.category !== "all") {
          conds.push(eq(schema.deals.category, input.category));
        }
        if (input?.highRoiOnly) conds.push(sql`flagged_high_roi = 1`);
        if (input?.platform) conds.push(eq(schema.deals.platform, input.platform));
        if (input?.tracking) conds.push(sql`purchase_price IS NOT NULL`);

        const where = conds.length ? and(...conds) : undefined;
        const rows = await db
          .select()
          .from(schema.deals)
          .where(where)
          .orderBy(sql`score DESC NULLS LAST, created_at DESC`)
          .limit(200)
          .all();
        const stats = await getDealStats();
        return { deals: rows, ...stats };
      }),

    get: publicProcedure
      .input(z.object({ id: z.string() }))
      .query(async ({ input }) => {
        const deal = await db
          .select()
          .from(schema.deals)
          .where(eq(schema.deals.id, input.id))
          .get();
        return { deal: deal ?? null };
      }),

    runScraper: publicProcedure
      .input(
        z.object({
          city: z.string().optional(),
          includeFacebook: z.boolean().optional(),
          includeCraigslist: z.boolean().optional(),
          includeEstateSales: z.boolean().optional(),
          maxPrice: z.number().optional(),
        }),
      )
      .mutation(async ({ input }) => {
        const city = input.city ?? process.env.SCRAPER_CITY ?? "denver";
        let imported = 0;

        if (input.includeCraigslist !== false) {
          for (const cat of CATEGORIES) {
            const found = await scrapeCraigslist({
              city,
              category: cat,
              maxPrice: input.maxPrice,
              limit: 30,
            });
            for (const f of found) {
              try {
                await db
                  .insert(schema.deals)
                  .values({
                    id: randomUUID(),
                    platform: f.platform,
                    sourceUrl: f.sourceUrl,
                    title: f.title,
                    description: f.description,
                    city: f.city,
                    category: cat,
                    askingPrice: f.askingPrice,
                    imageUrl: f.imageUrl,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                  })
                  .onConflictDoNothing()
                  .run();
                imported++;
              } catch {
                // ignore dupes
              }
            }
          }
        }

        if (input.includeFacebook) {
          // Facebook requires auth; this returns [] and logs guidance.
          const fb = await scrapeFacebookMarketplace();
          for (const _f of fb) imported++;
        }

        if (input.includeEstateSales) {
          const sales = await scrapeEstateSalesNet(city);
          for (const s of sales) {
            try {
              await db
                .insert(schema.garageSales)
                .values({
                  id: randomUUID(),
                  platform: s.platform,
                  sourceUrl: s.sourceUrl,
                  title: s.title,
                  description: s.description,
                  city: s.city,
                  address: s.address,
                  lat: s.lat,
                  lng: s.lng,
                  saleDate: s.saleDate,
                  images: s.images,
                  createdAt: new Date(),
                })
                .onConflictDoNothing()
                .run();
            } catch {
              // ignore
            }
          }
        }

        // Always also pull garage sales from craigslist
        const clSales = await scrapeCraigslistGarageSales(city);
        for (const s of clSales) {
          try {
            await db
              .insert(schema.garageSales)
              .values({
                id: randomUUID(),
                platform: s.platform,
                sourceUrl: s.sourceUrl,
                title: s.title,
                description: s.description,
                city: s.city,
                address: s.address,
                lat: s.lat,
                lng: s.lng,
                saleDate: s.saleDate,
                images: s.images,
                createdAt: new Date(),
              })
              .onConflictDoNothing()
              .run();
          } catch {
            // ignore
          }
        }

        return { imported };
      }),

    processDeals: publicProcedure.mutation(async () => {
      const r = await processUnscoredDeals();
      return r;
    }),

    importUrl: publicProcedure
      .input(z.object({ url: z.string().url(), city: z.string().optional() }))
      .mutation(async ({ input }) => {
        const city = input.city ?? process.env.SCRAPER_CITY ?? "denver";
        const listing = await importListingFromUrl(input.url, city);
        if (!listing) {
          throw new Error("Could not parse listing from URL");
        }
        const id = randomUUID();
        await db
          .insert(schema.deals)
          .values({
            id,
            platform: listing.platform,
            sourceUrl: listing.sourceUrl,
            title: listing.title,
            description: listing.description,
            city: listing.city,
            askingPrice: listing.askingPrice,
            imageUrl: listing.imageUrl,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .onConflictDoNothing()
          .run();
        return { id };
      }),

    updateTracking: publicProcedure
      .input(
        z.object({
          id: z.string(),
          purchasePrice: z.number().nullable().optional(),
          soldPrice: z.number().nullable().optional(),
          notes: z.string().nullable().optional(),
        }),
      )
      .mutation(async ({ input }) => {
        const soldAt = input.soldPrice != null ? new Date() : null;
        await db
          .update(schema.deals)
          .set({
            purchasePrice: input.purchasePrice ?? null,
            soldPrice: input.soldPrice ?? null,
            soldAt,
            trackingNotes: input.notes ?? null,
            updatedAt: new Date(),
          })
          .where(eq(schema.deals.id, input.id))
          .run();
        return { ok: true };
      }),
  }),

  garageSales: router({
    list: publicProcedure
      .input(z.object({ city: z.string().optional() }).optional())
      .query(async ({ input }) => {
        const where = input?.city ? eq(schema.garageSales.city, input.city) : undefined;
        const rows = await db
          .select()
          .from(schema.garageSales)
          .where(where)
          .orderBy(sql`created_at DESC`)
          .limit(200)
          .all();
        return { sales: rows };
      }),
  }),

  settings: router({
    get: publicProcedure.query(async () => {
      const rows = await db.select().from(schema.settings).all();
      const out: Record<string, string> = {};
      for (const r of rows) out[r.key] = r.value;
      return out;
    }),
    set: publicProcedure
      .input(z.object({ key: z.string(), value: z.string() }))
      .mutation(async ({ input }) => {
        await db
          .insert(schema.settings)
          .values({ key: input.key, value: input.value })
          .onConflictDoUpdate({ target: schema.settings.key, set: { value: input.value } })
          .run();
        return { ok: true };
      }),
  }),
});

export type AppRouter = typeof appRouter;
