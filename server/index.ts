import "dotenv/config";
import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import cron from "node-cron";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
// IMPORTANT: migrate must run before router/services that touch the DB.
// migrate.ts runs runMigrations() as a top-level side effect on import, so
// importing it here guarantees tables exist before any downstream module
// (e.g. services/geocode.ts) prepares statements at its own module load.
import { runMigrations } from "./db/migrate.js";
import { appRouter } from "./router.js";
import { processUnscoredDeals } from "./jobs/process-deals.js";
import { db, schema } from "./db/index.js";
import { optimizeRoute } from "./services/route.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const PORT = Number(process.env.PORT ?? 3000);
const app = express();

app.use(express.json({ limit: "1mb" }));

app.get("/healthz", (_req, res) => res.json({ ok: true }));

// Quick config self-check for the user — visit /api/diagnostics in a browser.
app.get("/api/diagnostics", async (_req, res) => {
  const features = {
    googleMaps: Boolean(process.env.GOOGLE_MAPS_API_KEY),
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    ebay: Boolean(process.env.EBAY_CLIENT_ID && process.env.EBAY_CLIENT_SECRET),
    telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
  };
  let dbCounts: Record<string, number> = {};
  try {
    const allSales = await db.select().from(schema.garageSales).all();
    const allDeals = await db.select().from(schema.deals).all();
    dbCounts = {
      garageSales: allSales.length,
      garageSalesWithCoords: allSales.filter((s) => s.lat != null && s.lng != null).length,
      deals: allDeals.length,
      dealsScored: allDeals.filter((d) => d.score != null).length,
      dealsFlagged: allDeals.filter((d) => d.flaggedHighRoi).length,
    };
  } catch {
    dbCounts = { error: 0 };
  }
  res.json({
    ok: true,
    features,
    dbCounts,
    cron: process.env.SCRAPER_CRON ?? "*/30 * * * *",
    defaultCity: process.env.SCRAPER_CITY ?? "denver",
    notes: [
      features.googleMaps ? null : "GOOGLE_MAPS_API_KEY missing — map pins and route planner won't work",
      features.anthropic ? null : "ANTHROPIC_API_KEY missing — deal scorer can't identify products",
      features.ebay ? null : "EBAY_CLIENT_ID/SECRET missing — deals will have no ROI scores",
    ].filter(Boolean),
  });
});

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

// Standalone route planner page.
app.get("/route", (_req, res) => {
  const html = readFileSync(join(ROOT, "server", "route-page.html"), "utf-8")
    .replace("__GOOGLE_MAPS_API_KEY__", process.env.GOOGLE_MAPS_API_KEY ?? "");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
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

// --- Static frontend ---
// The compiled bundle lives in ./src — response.html points at /assets/.
// We intercept the main JS bundle to rewrite two hardcoded constants:
//   p3 = "https://forge.manus.ai"           (Manus map proxy host)
//   f3 = "oPVToggwvvGzB7BYjrZZga"           (Manus internal proxy token)
// so the in-page Google Maps loader hits maps.googleapis.com directly with
// the user's GOOGLE_MAPS_API_KEY from .env. Cached after first read.
const PATCHED_BUNDLES = new Map<string, string>();
app.get("/assets/:file", (req, res, next) => {
  const file = req.params.file;
  if (!file.endsWith(".js")) return next();
  try {
    let body = PATCHED_BUNDLES.get(file);
    if (!body) {
      const raw = readFileSync(join(ROOT, "src", file), "utf-8");
      const key = process.env.GOOGLE_MAPS_API_KEY ?? "";
      body = raw
        .replace(
          'p3="https://forge.manus.ai",m3=`${p3}/v1/maps/proxy`',
          'p3="https://maps.googleapis.com",m3=`${p3}`',
        )
        .replace('f3="oPVToggwvvGzB7BYjrZZga"', `f3=${JSON.stringify(key)}`);
      PATCHED_BUNDLES.set(file, body);
    }
    res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    res.send(body);
  } catch {
    next();
  }
});
app.use("/assets", express.static(join(ROOT, "src")));

// SPA fallback: serve clean index.html (no Manus auth runtime).
app.get("*", (_req, res) => {
  const html = readFileSync(join(ROOT, "index.html"), "utf-8");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
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
  printConfigAudit();
});

function printConfigAudit() {
  const ok = (label: string) => console.log(`  [✓] ${label}`);
  const miss = (label: string, why: string) => console.log(`  [ ] ${label} — ${why}`);
  console.log("Integrations:");
  process.env.GOOGLE_MAPS_API_KEY
    ? ok("Google Maps (geocoding + map pins)")
    : miss("Google Maps", "GOOGLE_MAPS_API_KEY not set; garage sales will have no coords and won't appear on the map");
  process.env.ANTHROPIC_API_KEY
    ? ok("Anthropic (LLM product identification)")
    : miss("Anthropic", "ANTHROPIC_API_KEY not set; deal scorer can't extract product info");
  process.env.EBAY_CLIENT_ID && process.env.EBAY_CLIENT_SECRET
    ? ok("eBay Browse API (comp pricing)")
    : miss("eBay", "EBAY_CLIENT_ID/SECRET not set; deals will have no ROI scores");
  process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID
    ? ok("Telegram alerts")
    : miss("Telegram", "optional — no alerts on high-ROI flags");
}
