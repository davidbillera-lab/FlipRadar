import { request } from "undici";
import { randomUUID } from "node:crypto";
import { db, schema } from "../db/index.js";

const APIFY_TOKEN = process.env.APIFY_FACEBOOK_API_KEY ?? "";
const ACTOR_ID = "apify~facebook-marketplace-scraper";
const BASE = "https://api.apify.com/v2";
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 300_000; // 5 minutes

// Shape returned by apify~facebook-marketplace-scraper (includeListingDetails: true).
// Error rows (no listings) come back as { url, error, errorDescription } instead.
export interface FmRawListing {
  id?: string;
  itemUrl?: string;
  listingTitle?: string;
  listingPrice?: { amount?: string; formatted_amount_zeros_stripped?: string } | null;
  locationText?: { text?: string } | null;
  description?: { text?: string } | null;
  listingPhotos?: Array<{ image?: { uri?: string } }>;
  primaryListingPhoto?: { image?: { uri?: string } } | null;
  timestamp?: string | null;
  isSold?: boolean;
  isPending?: boolean;
  error?: string;
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
  const price =
    raw.listingPrice?.amount ??
    raw.listingPrice?.formatted_amount_zeros_stripped ??
    null;
  const images = (raw.listingPhotos ?? [])
    .map((p) => p.image?.uri)
    .filter((u): u is string => typeof u === "string");
  if (images.length === 0 && raw.primaryListingPhoto?.image?.uri) {
    images.push(raw.primaryListingPhoto.image.uri);
  }
  return {
    id: randomUUID(),
    city,
    title: raw.listingTitle ?? "(untitled)",
    priceCents: parsePriceCents(price),
    locationText: raw.locationText?.text ?? null,
    sourceUrl: raw.itemUrl ?? "",
    description: raw.description?.text ?? null,
    images,
    postedAt: raw.timestamp ? new Date(raw.timestamp) : null,
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

// The actor has no "all listings in a city" feed — Marketplace search requires a
// keyword query (a query-less /search/ URL returns { error: "no_items" }). So we run
// a small set of flip-focused queries per city and merge the results. Editable later
// from Settings; this is the default net.
const DEFAULT_FM_QUERIES = ["furniture", "tools", "electronics", "antiques", "bikes"];

// Facebook Marketplace uses lowercase, space-stripped city slugs in its URLs
// (e.g. "Lone Tree" → "lonetree"). The actor requires a /marketplace/.../search/?query= startUrl.
function citySlug(city: string): string {
  return city.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function citySearchUrl(city: string, query: string): string {
  return `https://www.facebook.com/marketplace/${citySlug(city)}/search/?query=${encodeURIComponent(query)}`;
}

// Start one actor run for a single startUrl, poll to completion, return raw listings.
async function runActor(url: string, resultsLimit: number): Promise<FmRawListing[]> {
  const runResp = await apifyPost(`/acts/${ACTOR_ID}/runs`, {
    startUrls: [{ url }],
    resultsLimit,
    includeListingDetails: true,
  });
  const runId: string = runResp.data?.id;
  if (!runId) throw new Error("Apify did not return a run ID");

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

  const itemsResp = await apifyGet(`/datasets/${datasetId}/items`);
  return Array.isArray(itemsResp) ? itemsResp : (itemsResp.data?.items ?? []);
}

export async function scrapeCity(
  city: string,
  maxItems = 200,
  queries: string[] = DEFAULT_FM_QUERIES
): Promise<FmNormalizedListing[]> {
  if (!APIFY_TOKEN) throw new Error("APIFY_FACEBOOK_API_KEY not set");

  const perQuery = Math.max(1, Math.ceil(maxItems / queries.length));
  const byUrl = new Map<string, FmNormalizedListing>();

  // One Apify run per query; merge + de-dupe by listing URL. A failing/empty query
  // shouldn't sink the whole city, so we collect errors and only throw if all fail.
  const errors: string[] = [];
  for (const q of queries) {
    try {
      const raw = await runActor(citySearchUrl(city, q), perQuery);
      for (const r of raw) {
        // Skip the actor's "no_items" error rows, any sold/pending listings, and
        // rows with a blank URL (an empty itemUrl would write an unresolvable ghost row).
        if (r.error || !r.itemUrl?.trim() || r.isSold || r.isPending) continue;
        if (!byUrl.has(r.itemUrl)) byUrl.set(r.itemUrl, normalize(city, r));
      }
    } catch (e) {
      errors.push(`${q}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Surface partial failures: a city that returns thin results because 3 of 5 queries
  // errored should leave a trail in the logs, not look like a healthy-but-quiet scrape.
  if (errors.length > 0) {
    console.warn(`[fm-scraper] ${city}: ${errors.length}/${queries.length} queries failed: ${errors.join("; ")}`);
  }

  if (byUrl.size === 0 && errors.length > 0 && errors.length === queries.length) {
    throw new Error(`All FM queries failed for ${city}: ${errors.join("; ")}`);
  }
  return [...byUrl.values()];
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
    } catch (e) {
      // Don't let one bad row sink the batch, but never swallow it silently —
      // a schema drift would otherwise show "0 inserted" with no trail to debug.
      console.error(`[fm-scraper] failed to insert listing ${l.id} (${l.sourceUrl}):`, e);
    }
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
