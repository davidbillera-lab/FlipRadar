import "dotenv/config";
import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import cron from "node-cron";
// IMPORTANT: migrate must run before router/services that touch the DB.
// migrate.ts runs runMigrations() as a top-level side effect on import, so
// importing it here guarantees tables exist before any downstream module
// (e.g. services/geocode.ts) prepares statements at its own module load.
import { runMigrations } from "./db/migrate.js";
import { appRouter } from "./router.js";
import { processUnscoredDeals } from "./jobs/process-deals.js";
import { db, schema } from "./db/index.js";
import { optimizeRoute } from "./services/route.js";

const PORT = Number(process.env.PORT ?? 3000);
const app = express();

app.use(express.json({ limit: "1mb" }));

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

    const all = await db.select().from(schema.garageSales).all();
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

// runMigrations() already ran during the import side-effect above.

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

app.listen(PORT, () => {
  console.log(`FlipRadar listening on http://localhost:${PORT}`);
});
