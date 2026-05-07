import "dotenv/config";
import { runMigrations } from "../db/migrate.js";
import { processUnscoredDeals } from "./process-deals.js";

async function main() {
  runMigrations();
  const r = await processUnscoredDeals();
  console.log(`[score-deals] processed=${r.processed} flagged=${r.flagged}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
