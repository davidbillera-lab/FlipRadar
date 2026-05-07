import "dotenv/config";
import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import cron from "node-cron";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { appRouter } from "./router.js";
import { runMigrations } from "./db/migrate.js";
import { processUnscoredDeals } from "./jobs/process-deals.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const PORT = Number(process.env.PORT ?? 3000);
const app = express();

app.use(express.json({ limit: "1mb" }));

app.get("/healthz", (_req, res) => res.json({ ok: true }));

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
app.use("/assets", express.static(join(ROOT, "src")));

// SPA fallback: serve clean index.html (no Manus auth runtime).
app.get("*", (_req, res) => {
  const html = readFileSync(join(ROOT, "index.html"), "utf-8");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

runMigrations();

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
