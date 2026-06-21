import { z } from "zod";
import { router, publicProcedure } from "./trpc.js";
import { db, schema } from "./db/index.js";
import { eq, sql, and, getTableColumns, type SQL } from "drizzle-orm";
import { resolveScraperCities } from "./lib/cities.js";
import { processUnscoredDeals, getDealStats, rescoreHighRoiFlags, processFmListings } from "./jobs/process-deals.js";
import { scrapeCity, upsertListings } from "./services/fm-scraper.js";
import {
  scrapeCraigslist,
  scrapeCraigslistGarageSales,
  scrapeFacebookMarketplace,
  scrapeEstateSalesNet,
  importListingFromUrl,
  fetchCraigslistDetail,
} from "./services/scraper.js";
import { geocodeAddress } from "./services/geocode.js";
import { randomUUID } from "node:crypto";

// Tracks the most recent city to produce rows during a scrape run.
// `garageSales.list` falls back to this when the requested city has no rows,
// so that scraping a non-default city makes those rows visible in a dashboard
// that's hard-coded to the default city.
let lastScrapedCityWithRows: string | null = null;

const CATEGORIES = ["electronics", "antiques", "collectibles", "power_tools"] as const;
const LOCAL_USER = { id: "local", name: "Local User", email: "local@flipradar.local" };

function toRow(d: any) {
  if (!d) return null;
  const {
    score, netProfit, roiPct, exitChannel, ebayFees,
    ebayAvgSold, ebayCompCount, ebaySearchQuery,
    id: uuid,
    ...rest
  } = d;
  return {
    deal: { ...rest, id: uuid, uuid },
    score: { score, netProfit, roiPct, exitChannel, ebayFees },
    valuation: {
      ebayAvgSold,
      ebayCompCount,
      ebaySearchQuery,
      ebayCompsUrl: ebaySearchQuery
        ? `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(ebaySearchQuery)}&LH_Sold=1&LH_Complete=1`
        : null,
    },
  };
}

function reshapeGarageSale(s: any) {
  if (!s) return null;
  return {
    ...s,
    uuid: s.id,
    id: s.id,
    images: Array.isArray(s.images) ? s.images : [],
  };
}

export const appRouter = router({
  auth: router({
    me: publicProcedure.query(() => LOCAL_USER),
    logout: publicProcedure.mutation(() => ({ ok: true })),
  }),

  stats: router({
    summary: publicProcedure.query(async () => {
      const stats = await getDealStats();
      let topRow: any = null;
      if (stats.topDeal?.deal?.id) {
        const tops = await db.select().from(schema.deals).where(eq(schema.deals.id, stats.topDeal.deal.id));
        const top = tops[0];
        topRow = top ? toRow(top) : null;
      }
      return {
        totalDeals: stats.totalDeals,
        avgScore: stats.avgScore,
        highRoiDeals: stats.highRoiDeals,
        dealsSold: stats.dealsSold,
        topDeal: topRow,
        totalProjectedProfit: stats.totalProjectedProfit,
      };
    }),
  }),

  deals: router({
    list: publicProcedure
      .input(
        z
          .object({
            category: z.string().optional(),
            flaggedHighRoi: z.boolean().optional(),
            highRoiOnly: z.boolean().optional(),
            platform: z.string().optional(),
            exitChannel: z.string().optional(),
            status: z.string().optional(),
            tracking: z.boolean().optional(),
            limit: z.number().optional(),
          })
          .optional(),
      )
      .query(async ({ input }) => {
        const conds: SQL[] = [];
        if (input?.category && input.category !== "all") conds.push(eq(schema.deals.category, input.category));
        if (input?.flaggedHighRoi || input?.highRoiOnly) conds.push(sql`flagged_high_roi = true`);
        if (input?.platform && input.platform !== "all") conds.push(eq(schema.deals.platform, input.platform));
        if (input?.exitChannel && input.exitChannel !== "all") conds.push(eq(schema.deals.exitChannel, input.exitChannel));
        if (input?.tracking) conds.push(sql`purchase_price IS NOT NULL`);
        if (input?.status === "sold") conds.push(sql`sold_at IS NOT NULL`);
        else if (input?.status === "tracking") conds.push(sql`purchase_price IS NOT NULL AND sold_at IS NULL`);
        else if (input?.status === "available") conds.push(sql`purchase_price IS NULL`);
        const where = conds.length ? and(...conds) : undefined;
        let q = db.select().from(schema.deals).$dynamic();
        if (where) q = q.where(where);
        const rows = await q
          .orderBy(sql`score DESC, created_at DESC`)
          .limit(input?.limit ?? 200);
        return { rows: rows.map(toRow) };
      }),

    get: publicProcedure
      .input(z.object({ id: z.union([z.string(), z.number()]).transform((v) => String(v)) }))
      .query(async ({ input }) => {
        const rows = await db.select().from(schema.deals).where(eq(schema.deals.id, input.id));
        const d: any = rows[0];
        if (!d) return { deal: null, score: null, valuation: null, tracking: null };
        const row = toRow(d)!;
        return {
          deal: row.deal,
          score: row.score,
          valuation: row.valuation,
          tracking: {
            purchasePrice: d.purchasePrice,
            soldPrice: d.soldPrice,
            actualRoi: d.actualRoi,
            notes: d.trackingNotes,
          },
        };
      }),

    runScraper: publicProcedure
      .input(
        z
          .object({
            includeFacebook: z.boolean().optional(),
            city: z.string().optional(),
            cities: z.array(z.string()).optional(),
          })
          .optional(),
      )
      .mutation(async ({ input }) => {
        const cities = await resolveScraperCities(input?.city, input?.cities);
        let clNew = 0, clSkipped = 0;
        for (const city of cities) {
          for (const cat of CATEGORIES) {
            const found = await scrapeCraigslist({ city, category: cat, limit: 30 });
            for (const f of found) {
              try {
                const rows = await db
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
                  .returning({ id: schema.deals.id });
                if (rows.length) clNew++;
                else clSkipped++;
              } catch {
                clSkipped++;
              }
            }
          }
        }
        let fbNew = 0, fbSkipped = 0;
        if (input?.includeFacebook) {
          const fb = await scrapeFacebookMarketplace();
          for (const _ of fb) fbNew++;
        }
        return {
          craigslist: { newListings: clNew, skipped: clSkipped },
          facebook: { newListings: fbNew, skipped: fbSkipped },
        };
      }),

    processDeals: publicProcedure.mutation(async () => await processUnscoredDeals()),

    rescoreFlags: publicProcedure.mutation(async () => await rescoreHighRoiFlags()),

    importUrl: publicProcedure
      .input(z.object({ url: z.string().url(), source: z.string().optional(), city: z.string().optional() }))
      .mutation(async ({ input }) => {
        const city = input.city ?? process.env.SCRAPER_CITY ?? "denver";
        const listing = await importListingFromUrl(input.url, city);
        if (!listing) throw new Error("Could not parse listing from URL");
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
          .onConflictDoNothing();
        return { id };
      }),

    updateTracking: publicProcedure
      .input(
        z.object({
          dealId: z.union([z.string(), z.number()]).transform((v) => String(v)),
          purchasePrice: z.number().nullable().optional(),
          soldPrice: z.number().nullable().optional(),
          actualRoi: z.number().nullable().optional(),
          notes: z.string().nullable().optional(),
        }),
      )
      .mutation(async ({ input }) => {
        // soldAt is set when soldPrice is provided, cleared when soldPrice is explicitly null
        const soldAt =
          input.soldPrice == null
            ? null
            : input.soldPrice > 0
              ? new Date()
              : null;
        await db
          .update(schema.deals)
          .set({
            purchasePrice: input.purchasePrice ?? null,
            soldPrice: input.soldPrice ?? null,
            actualRoi: input.actualRoi ?? null,
            soldAt,
            trackingNotes: input.notes ?? null,
            updatedAt: new Date(),
          })
          .where(eq(schema.deals.id, input.dealId));
        return { ok: true };
      }),
  }),

  garageSales: router({
    list: publicProcedure
      .input(
        z
          .object({
            city: z.string().optional(),
            status: z.string().optional(),
            limit: z.number().optional(),
          })
          .optional(),
      )
      .query(async ({ input }) => {
        const buildQuery = (city?: string) => {
          const conds: SQL[] = [];
          if (city) conds.push(eq(schema.garageSales.city, city));
          if (input?.status && input.status !== "all") conds.push(eq(schema.garageSales.status, input.status));
          const where = conds.length ? and(...conds) : undefined;
          let q = db.select().from(schema.garageSales).$dynamic();
          if (where) q = q.where(where);
          return q.orderBy(sql`created_at DESC`).limit(input?.limit ?? 200);
        };

        let raw = await buildQuery(input?.city);
        // If the requested city returned nothing but we just scraped a different
        // city, surface those rows instead so they aren't invisible to the UI.
        if (raw.length === 0 && input?.city && lastScrapedCityWithRows && lastScrapedCityWithRows !== input.city) {
          raw = await buildQuery(lastScrapedCityWithRows);
        }
        const rows = raw.map(reshapeGarageSale);
        return { rows, sales: rows, total: rows.length };
      }),

    get: publicProcedure
      .input(z.object({ id: z.union([z.string(), z.number()]).transform((v) => String(v)) }))
      .query(async ({ input }) => {
        const rows = await db.select().from(schema.garageSales).where(eq(schema.garageSales.id, input.id));
        return { sale: reshapeGarageSale(rows[0] ?? null) };
      }),

    scrape: publicProcedure
      .input(
        z
          .object({
            cities: z.array(z.string()).optional(),
            includeFacebook: z.boolean().optional(),
            includeEstateSales: z.boolean().optional(),
          })
          .optional(),
      )
      .mutation(async ({ input }) => {
        const cities = input?.cities ?? [process.env.SCRAPER_CITY ?? "denver"];
        const sources: string[] = [];
        let newListings = 0;

        for (const city of cities) {
          const cl = await scrapeCraigslistGarageSales(city);
          if (cl.length) sources.push("Craigslist");

          for (const s of cl) {
            // Enrich with detail-page address + coords
            let address = s.address;
            let lat = s.lat;
            let lng = s.lng;
            let description = s.description;
            try {
              const detail = await fetchCraigslistDetail(s.sourceUrl);
              address = detail.address ?? address;
              lat = detail.lat ?? lat;
              lng = detail.lng ?? lng;
              description = detail.description ?? description;
            } catch {}

            // If we have an address but no coords, geocode
            if (address && (lat == null || lng == null)) {
              const g = await geocodeAddress(`${address}, ${city}`);
              if (g) {
                lat = g.lat;
                lng = g.lng;
              }
            }

            try {
              const inserted = await db
                .insert(schema.garageSales)
                .values({
                  id: randomUUID(),
                  platform: s.platform,
                  sourceUrl: s.sourceUrl,
                  title: s.title,
                  description,
                  city: s.city,
                  address,
                  lat,
                  lng,
                  saleDate: s.saleDate,
                  images: s.images,
                  createdAt: new Date(),
                })
                .onConflictDoNothing()
                .returning({ id: schema.garageSales.id });
              if (inserted.length) {
                newListings++;
                lastScrapedCityWithRows = s.city;
              }
            } catch {}
          }

          if (input?.includeEstateSales) {
            const es = await scrapeEstateSalesNet(city);
            if (es.length) sources.push("EstateSales.net");
            for (const s of es) {
              let lat = s.lat;
              let lng = s.lng;
              if (s.address && (lat == null || lng == null)) {
                const g = await geocodeAddress(`${s.address}, ${city}`);
                if (g) {
                  lat = g.lat;
                  lng = g.lng;
                }
              }
              try {
                const inserted = await db
                  .insert(schema.garageSales)
                  .values({
                    id: randomUUID(),
                    platform: s.platform,
                    sourceUrl: s.sourceUrl,
                    title: s.title,
                    description: s.description,
                    city: s.city,
                    address: s.address,
                    lat,
                    lng,
                    saleDate: s.saleDate,
                    images: s.images,
                    createdAt: new Date(),
                  })
                  .onConflictDoNothing()
                  .returning({ id: schema.garageSales.id });
                if (inserted.length) {
                  newListings++;
                  lastScrapedCityWithRows = s.city;
                }
              } catch {}
            }
          }
        }
        return { newListings, sources: Array.from(new Set(sources)), city: lastScrapedCityWithRows };
      }),

    update: publicProcedure
      .input(
        z.object({
          id: z.union([z.string(), z.number()]).transform((v) => String(v)),
          status: z.string().optional(),
          notes: z.string().optional(),
        }),
      )
      .mutation(async ({ input }) => {
        const patch: any = {};
        if (input.status !== undefined) patch.status = input.status;
        if (input.notes !== undefined) patch.notes = input.notes;
        if (Object.keys(patch).length) {
          await db.update(schema.garageSales).set(patch).where(eq(schema.garageSales.id, input.id));
        }
        return { ok: true };
      }),
  }),

  fm: router({
    scrapeStatus: publicProcedure.query(async () => {
      const jobs = await db.select().from(schema.fmScrapeJobs);
      return jobs;
    }),

    triggerScrape: publicProcedure
      .input(z.object({ city: z.string().min(1) }))
      .mutation(async ({ input }) => {
        const { city } = input;
        await db
          .insert(schema.fmScrapeJobs)
          .values({ city, status: "running", errorMsg: null })
          .onConflictDoUpdate({ target: schema.fmScrapeJobs.city, set: { status: "running", errorMsg: null } });
        try {
          const listings = await scrapeCity(city);
          const inserted = await upsertListings(city, listings);
          await db
            .insert(schema.fmScrapeJobs)
            .values({ city, status: "done", lastScrapedAt: new Date(), listingsFound: listings.length, errorMsg: null })
            .onConflictDoUpdate({
              target: schema.fmScrapeJobs.city,
              set: { status: "done", lastScrapedAt: new Date(), listingsFound: listings.length, errorMsg: null },
            });
          await processFmListings();
          return { ok: true, listingsFound: listings.length, inserted };
        } catch (e) {
          await db
            .insert(schema.fmScrapeJobs)
            .values({ city, status: "error", errorMsg: (e as Error).message })
            .onConflictDoUpdate({
              target: schema.fmScrapeJobs.city,
              set: { status: "error", errorMsg: (e as Error).message },
            });
          throw e;
        }
      }),
  }),

  settings: router({
    get: publicProcedure.query(async () => {
      const rows = await db.select().from(schema.settings);
      const out: Record<string, any> = {};
      for (const r of rows) {
        try {
          out[r.key] = JSON.parse(r.value);
        } catch {
          out[r.key] = r.value;
        }
      }
      return out;
    }),
    update: publicProcedure
      .input(z.object({}).passthrough())
      .mutation(async ({ input }) => {
        for (const [key, value] of Object.entries(input)) {
          await db
            .insert(schema.settings)
            .values({ key, value: JSON.stringify(value) })
            .onConflictDoUpdate({ target: schema.settings.key, set: { value: JSON.stringify(value) } });
        }
        // Re-evaluate high-ROI flag against new thresholds
        try {
          await rescoreHighRoiFlags();
        } catch (e) {
          console.error("[settings.update] rescore failed:", (e as Error).message);
        }
        return { ok: true };
      }),
  }),
});

export type AppRouter = typeof appRouter;
