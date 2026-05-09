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

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

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
});
