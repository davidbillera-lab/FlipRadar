// Thin proxy to the server-side deal processing job.
// The real implementation lives in server/jobs/process-deals.ts and is
// exposed via tRPC at /api/trpc and via the scheduled-task endpoint at
// POST /api/scheduled/deals.processDeals.
export { processUnscoredDeals as processDeals } from "../../server/jobs/process-deals.js";
