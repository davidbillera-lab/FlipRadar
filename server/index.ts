import "dotenv/config";
import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import cron from "node-cron";
import { runMigrations } from "./db/migrate.js";
import { appRouter } from "./router.js";
import { processUnscoredDeals, processFmListings } from "./jobs/process-deals.js";
import { db, schema } from "./db/index.js";
import { optimizeRoute } from "./services/route.js";
import { scrapeCity, upsertListings, getStaleCity } from "./services/fm-scraper.js";
import { resolveScraperCities } from "./lib/cities.js";
import { eq } from "drizzle-orm";

const PORT = Number(process.env.PORT ?? 3000);
const app = express();

app.use(express.json({ limit: "1mb" }));

// CORS — locked to configured origin(s); no wildcard in production
const ALLOWED_ORIGINS = (process.env.CORS_ORIGIN ?? "http://localhost:3001")
  .split(",")
  .map((s) => s.trim());

app.use((req, res, next) => {
  const origin = req.headers.origin ?? "";
  if (!origin || ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  if (req.method === "OPTIONS") { res.sendStatus(204); return; }
  next();
});

app.get("/healthz", (_req, res) => res.json({ ok: true }));

// Manus OAuth callback — just redirect home; auth.me returns a local user so no re-redirect.
app.get("/api/oauth/callback", (_req, res) => res.redirect("/"));

app.use(
  "/api/trpc",
  createExpressMiddleware({
    router: appRouter,
    createContext: () => ({}),
  }),
);

// Route planner — POST { startAddress, saleIds? } → optimized order.
// If saleIds is omitted, uses every garage sale with lat/lng and status != "skipped".
app.post("/api/route/optimize", async (req, res) => {
  try {
    const startAddress = String(req.body?.startAddress ?? "").trim();
    if (!startAddress) {
      res.status(400).json({ ok: false, error: "startAddress required" });
      return;
    }
    const saleIds: string[] | undefined = Array.isArray(req.body?.saleIds)
      ? req.body.saleIds.map(String)
      : undefined;

    const all = await db.select().from(schema.garageSales);
    const eligible = all
      .filter((s) => s.lat != null && s.lng != null && s.status !== "skipped")
      .filter((s) => !saleIds || saleIds.includes(s.id))
      .map((s) => ({
        id: s.id,
        title: s.title,
        address: s.address,
        lat: s.lat as number,
        lng: s.lng as number,
      }));

    if (!eligible.length) {
      res.status(400).json({ ok: false, error: "no eligible garage sales (need lat/lng)" });
      return;
    }

    const result = await optimizeRoute({ startAddress, sales: eligible });
    if (!result) {
      res.status(502).json({ ok: false, error: "route optimization failed (see server logs)" });
      return;
    }
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

// Scheduled task endpoint hit by score_deals.sh
app.post("/api/scheduled/deals.processDeals", async (_req, res) => {
  try {
    const r = await processUnscoredDeals();
    res.json({ ok: true, ...r });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

(async () => {
  await runMigrations();

  const cronExpr = process.env.SCRAPER_CRON ?? "*/30 * * * *";
  if (cronExpr && cron.validate(cronExpr)) {
    cron.schedule(cronExpr, async () => {
      try {
        const r = await processUnscoredDeals();
        console.log(`[cron] processed=${r.processed} flagged=${r.flagged}`);
      } catch (e) {
        console.error("[cron] error:", (e as Error).message);
      }
    });
    console.log(`[cron] auto-scoring every: ${cronExpr}`);
  }

  // FM scraper cron — runs once per hour, scrapes the next stale city
  cron.schedule("0 * * * *", async () => {
    try {
      const cities = await resolveScraperCities();
      const jobs = await db.select().from(schema.fmScrapeJobs);
      const city = getStaleCity(cities, jobs);
      if (!city) {
        console.log("[fm-cron] no stale city to scrape");
        return;
      }

      // Mark as running (upsert — row may not exist yet)
      await db
        .insert(schema.fmScrapeJobs)
        .values({ city, status: "running", errorMsg: null })
        .onConflictDoUpdate({
          target: schema.fmScrapeJobs.city,
          set: { status: "running", errorMsg: null },
        });

      try {
        const listings = await scrapeCity(city);
        await upsertListings(city, listings);
        await db
          .insert(schema.fmScrapeJobs)
          .values({ city, status: "done", lastScrapedAt: new Date(), listingsFound: listings.length, errorMsg: null })
          .onConflictDoUpdate({
            target: schema.fmScrapeJobs.city,
            set: { status: "done", lastScrapedAt: new Date(), listingsFound: listings.length, errorMsg: null },
          });
        console.log(`[fm-cron] scraped ${listings.length} listings for ${city}`);
      } catch (e) {
        await db
          .insert(schema.fmScrapeJobs)
          .values({ city, status: "error", errorMsg: (e as Error).message })
          .onConflictDoUpdate({
            target: schema.fmScrapeJobs.city,
            set: { status: "error", errorMsg: (e as Error).message },
          });
        console.error(`[fm-cron] scrape error for ${city}:`, (e as Error).message);
      }

      // Process new FM listings into the deals pipeline regardless of scrape outcome
      try {
        await processFmListings();
      } catch (e) {
        console.error("[fm-cron] processFmListings error:", (e as Error).message);
      }
    } catch (e) {
      console.error("[fm-cron] error:", (e as Error).message);
    }
  });
  console.log("[cron] FM scraper: hourly (0 * * * *)");

  app.listen(PORT, () => {
    console.log(`FlipRadar listening on http://localhost:${PORT}`);
  });
})();
