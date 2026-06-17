import { request } from "undici";
import { randomUUID } from "node:crypto";
import { db, schema } from "../db/index.js";

const APIFY_TOKEN = process.env.APIFY_FACEBOOK_API_KEY ?? "";
const ACTOR_ID = "apify~facebook-marketplace-scraper";
const BASE = "https://api.apify.com/v2";
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 300_000; // 5 minutes

export interface FmRawListing {
  title: string;
  price: string | null;
  location: string | null;
  url: string;
  description: string | null;
  images: string[];
  postedAt: string | null;
}

export interface FmNormalizedListing {
  id: string;
  city: string;
  title: string;
  priceCents: number | null;
  locationText: string | null;
  sourceUrl: string;
  description: string | null;
  images: string[];
  postedAt: Date | null;
  scrapedAt: Date;
}

function parsePriceCents(raw: string | null): number | null {
  if (!raw) return null;
  const digits = raw.replace(/[^0-9.]/g, "");
  const n = parseFloat(digits);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

function normalize(city: string, raw: FmRawListing): FmNormalizedListing {
  return {
    id: randomUUID(),
    city,
    title: raw.title,
    priceCents: parsePriceCents(raw.price),
    locationText: raw.location ?? null,
    sourceUrl: raw.url,
    description: raw.description ?? null,
    images: Array.isArray(raw.images) ? raw.images : [],
    postedAt: raw.postedAt ? new Date(raw.postedAt) : null,
    scrapedAt: new Date(),
  };
}

async function apifyPost(path: string, body: unknown) {
  const res = await request(`${BASE}${path}?token=${APIFY_TOKEN}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.body.text();
  if (res.statusCode >= 400) {
    throw new Error(`Apify POST ${path} returned ${res.statusCode}: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text);
}

async function apifyGet(path: string) {
  const res = await request(`${BASE}${path}?token=${APIFY_TOKEN}`, { method: "GET" });
  const text = await res.body.text();
  if (res.statusCode >= 400) {
    throw new Error(`Apify GET ${path} returned ${res.statusCode}: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text);
}

export async function scrapeCity(city: string, maxItems = 200): Promise<FmNormalizedListing[]> {
  if (!APIFY_TOKEN) throw new Error("APIFY_FACEBOOK_API_KEY not set");

  // 1. Start run
  const runResp = await apifyPost(`/acts/${ACTOR_ID}/runs`, {
    location: city,
    maxItems,
  });
  const runId: string = runResp.data?.id;
  if (!runId) throw new Error("Apify did not return a run ID");

  // 2. Poll for completion
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let datasetId: string | null = null;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const statusResp = await apifyGet(`/acts/${ACTOR_ID}/runs/${runId}`);
    const status: string = statusResp.data?.status;
    if (status === "SUCCEEDED") {
      datasetId = statusResp.data?.defaultDatasetId;
      break;
    }
    if (status === "FAILED" || status === "TIMED-OUT" || status === "ABORTED") {
      throw new Error(`Apify run ${runId} ended with status ${status}`);
    }
  }
  if (!datasetId) throw new Error(`Apify run ${runId} timed out after 5 minutes`);

  // 3. Fetch results
  const itemsResp = await apifyGet(`/datasets/${datasetId}/items`);
  const raw: FmRawListing[] = Array.isArray(itemsResp) ? itemsResp : (itemsResp.data?.items ?? []);

  return raw.map((r) => normalize(city, r));
}

export async function upsertListings(city: string, listings: FmNormalizedListing[]): Promise<number> {
  let inserted = 0;
  for (const l of listings) {
    try {
      const r: any = await db
        .insert(schema.fmListings)
        .values(l)
        .onConflictDoNothing()
        .run();
      if (r?.changes) inserted++;
    } catch {}
  }
  return inserted;
}

export function getStaleCity(
  cities: string[],
  jobs: Array<{ city: string; lastScrapedAt: Date | null }>
): string | null {
  const STALE_THRESHOLD_MS = 4 * 60 * 60 * 1000; // 4 hours
  const now = Date.now();
  const jobMap = new Map(jobs.map((j) => [j.city.toLowerCase(), j.lastScrapedAt]));

  const sorted = [...cities].sort((a, b) => {
    const aTime = jobMap.get(a.toLowerCase())?.getTime() ?? 0;
    const bTime = jobMap.get(b.toLowerCase())?.getTime() ?? 0;
    return aTime - bTime;
  });

  const candidate = sorted[0];
  if (!candidate) return null;
  const lastScraped = jobMap.get(candidate.toLowerCase())?.getTime() ?? 0;
  return now - lastScraped >= STALE_THRESHOLD_MS ? candidate : null;
}
