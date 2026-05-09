import { request } from "undici";
import * as cheerio from "cheerio";

export interface ScrapedListing {
  platform: "craigslist" | "facebook" | "estatesales";
  sourceUrl: string;
  title: string;
  description: string | null;
  city: string;
  askingPrice: number;
  imageUrl: string | null;
}

export interface ScrapedGarageSale {
  platform: "craigslist" | "facebook" | "estatesales";
  sourceUrl: string;
  title: string;
  description: string | null;
  city: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  saleDate: string | null;
  images: string[];
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

async function fetchHtml(url: string): Promise<string> {
  const res = await request(url, {
    method: "GET",
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (res.statusCode !== 200) throw new Error(`fetch ${url} failed: ${res.statusCode}`);
  return res.body.text();
}

const CL_CATEGORIES: Record<string, string> = {
  electronics: "ela",
  antiques: "ata",
  collectibles: "cba",
  power_tools: "tla",
};

// Map of normalized city slugs → Craigslist subdomain.
// Craigslist subdomains often differ from human-readable city names.
const CL_SUBDOMAIN: Record<string, string> = {
  // Colorado
  denver: "denver",
  boulder: "denver",
  aurora: "denver",
  lakewood: "denver",
  thornton: "denver",
  fortcollins: "fortcollins",
  coloradosprings: "cosprings",
  pueblo: "pueblo",
  grandjunction: "westslope",
  // California
  losangeles: "losangeles",
  sandiego: "sandiego",
  sanfrancisco: "sfbay",
  oakland: "sfbay",
  sanjose: "sfbay",
  sacramento: "sacramento",
  fresno: "fresno",
  bakersfield: "bakersfield",
  // Texas
  austin: "austin",
  dallas: "dallas",
  houston: "houston",
  sanantonio: "sanantonio",
  fortworth: "dallas",
  elpaso: "elpaso",
  // Arizona
  phoenix: "phoenix",
  tucson: "tucson",
  // New York
  newyork: "newyork",
  buffalo: "buffalo",
  rochester: "rochester",
  // Washington
  seattle: "seattle",
  spokane: "spokane",
  // Oregon
  portland: "portland",
  eugene: "eugene",
  // Nevada
  lasvegas: "lasvegas",
  reno: "reno",
  // Utah
  saltlakecity: "saltlakecity",
  // Florida
  miami: "miami",
  orlando: "orlando",
  tampa: "tampa",
  jacksonville: "jacksonville",
  // Georgia
  atlanta: "atlanta",
  // Illinois
  chicago: "chicago",
  // Massachusetts
  boston: "boston",
  // Pennsylvania
  philadelphia: "philadelphia",
  pittsburgh: "pittsburgh",
  // Michigan
  detroit: "detroit",
  // Ohio
  cleveland: "cleveland",
  columbus: "columbus",
  cincinnati: "cincinnati",
  // North Carolina
  charlotte: "charlotte",
  raleigh: "raleigh",
  // Tennessee
  nashville: "nashville",
  memphis: "memphis",
  // Minnesota
  minneapolis: "minneapolis",
  // Missouri
  stlouis: "stlouis",
  kansascity: "kansascity",
  // DC
  washingtondc: "washingtondc",
  // New Mexico
  albuquerque: "albuquerque",
};

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function resolveCraigslistSubdomain(city: string): string {
  const s = slug(city);
  if (CL_SUBDOMAIN[s]) return CL_SUBDOMAIN[s];
  console.warn(
    `[scraper] no Craigslist subdomain mapped for "${city}" — falling back to "${s}". ` +
      `If results are empty, add an entry to CL_SUBDOMAIN in server/services/scraper.ts.`,
  );
  return s;
}

function parseClStaticResults(
  $: cheerio.CheerioAPI,
  opts: { city: string; subdomain: string; limit: number },
): ScrapedListing[] {
  const out: ScrapedListing[] = [];
  $("li.cl-static-search-result").each((_, el) => {
    if (out.length >= opts.limit) return false;
    const $el = $(el);
    const link = $el.find("a").first();
    const href = link.attr("href");
    const title = $el.find(".title").first().text().trim() || $el.attr("title") || "";
    const priceText = $el.find(".price").first().text().trim();
    const m = priceText.match(/\$?([\d,]+)/);
    const price = m ? Number(m[1]!.replace(/,/g, "")) : NaN;
    const cityText = $el.find(".location").first().text().trim() || opts.city;
    if (href && title && Number.isFinite(price)) {
      out.push({
        platform: "craigslist",
        sourceUrl: href.startsWith("http") ? href : `https://${opts.subdomain}.craigslist.org${href}`,
        title,
        description: null,
        city: cityText,
        askingPrice: price,
        imageUrl: null,
      });
    }
    return undefined;
  });
  return out;
}

export async function scrapeCraigslist(opts: {
  city: string;
  category?: keyof typeof CL_CATEGORIES;
  maxPrice?: number;
  limit?: number;
}): Promise<ScrapedListing[]> {
  const subdomain = resolveCraigslistSubdomain(opts.city);
  const cat = (opts.category && CL_CATEGORIES[opts.category]) || "sss";
  const params = new URLSearchParams({ hasPic: "1" });
  if (opts.maxPrice) params.set("max_price", String(opts.maxPrice));
  const url = `https://${subdomain}.craigslist.org/search/${cat}?${params}`;

  let html: string;
  try {
    html = await fetchHtml(url);
  } catch (e) {
    console.error(`[scraper] craigslist ${url}: ${(e as Error).message}`);
    return [];
  }
  const $ = cheerio.load(html);
  return parseClStaticResults($, { city: opts.city, subdomain, limit: opts.limit ?? 30 });
}

/**
 * Extract address + coordinates from a Craigslist detail page.
 * Returns nulls when the seller didn't share a map location.
 */
export async function fetchCraigslistDetail(
  detailUrl: string,
): Promise<{ address: string | null; lat: number | null; lng: number | null; description: string | null }> {
  let html: string;
  try {
    html = await fetchHtml(detailUrl);
  } catch (e) {
    console.error(`[scraper] cl detail ${detailUrl}: ${(e as Error).message}`);
    return { address: null, lat: null, lng: null, description: null };
  }
  const $ = cheerio.load(html);

  // The map div carries data-latitude / data-longitude attributes when present
  const latStr = $("#map").attr("data-latitude") ?? null;
  const lngStr = $("#map").attr("data-longitude") ?? null;
  const lat = latStr ? Number(latStr) : null;
  const lng = lngStr ? Number(lngStr) : null;

  // Address is often inside .mapaddress
  const address = $(".mapaddress").first().text().trim() || null;

  const description = $("#postingbody").text().trim() || null;

  return {
    address,
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    description,
  };
}

export async function scrapeCraigslistGarageSales(
  city: string,
  limit = 30,
): Promise<ScrapedGarageSale[]> {
  const subdomain = resolveCraigslistSubdomain(city);
  const url = `https://${subdomain}.craigslist.org/search/gms`;
  let html: string;
  try {
    html = await fetchHtml(url);
  } catch (e) {
    console.error(`[scraper] cl garage ${url}: ${(e as Error).message}`);
    return [];
  }
  const $ = cheerio.load(html);
  const sales: ScrapedGarageSale[] = [];
  $("li.cl-static-search-result").each((_, el) => {
    if (sales.length >= limit) return false;
    const $el = $(el);
    const link = $el.find("a").first();
    const href = link.attr("href");
    const title = $el.find(".title").first().text().trim() || $el.attr("title") || "";
    const cityText = $el.find(".location").first().text().trim() || city;
    if (href && title) {
      sales.push({
        platform: "craigslist",
        sourceUrl: href.startsWith("http") ? href : `https://${subdomain}.craigslist.org${href}`,
        title,
        description: null,
        city: cityText,
        address: null,
        lat: null,
        lng: null,
        saleDate: null,
        images: [],
      });
    }
    return undefined;
  });
  return sales;
}

export async function scrapeFacebookMarketplace(): Promise<ScrapedListing[]> {
  console.warn("[scraper] Facebook Marketplace requires auth; use Import URL instead.");
  return [];
}

export async function importListingFromUrl(
  url: string,
  city: string,
): Promise<ScrapedListing | null> {
  let html: string;
  try {
    html = await fetchHtml(url);
  } catch (e) {
    console.error(`[scraper] import ${url}: ${(e as Error).message}`);
    return null;
  }
  const $ = cheerio.load(html);
  const isFb = /facebook\.com/.test(url);
  const ogTitle = $('meta[property="og:title"]').attr("content");
  const ogDesc = $('meta[property="og:description"]').attr("content");
  const ogImage = $('meta[property="og:image"]').attr("content");
  let price = NaN;
  const clPrice = $(".price").first().text().trim();
  const m1 = clPrice.match(/\$([\d,]+)/);
  if (m1) price = Number(m1[1]!.replace(/,/g, ""));
  if (!Number.isFinite(price)) {
    const m2 = (ogDesc ?? "").match(/\$([\d,]+(?:\.\d{2})?)/);
    if (m2) price = Number(m2[1]!.replace(/,/g, ""));
  }
  if (!Number.isFinite(price)) {
    const m3 = html.match(/"amount_with_offset_in_currency":"([\d.]+)"/);
    if (m3) price = Number(m3[1]);
  }
  const title = ogTitle ?? $("title").text().trim();
  const description = $("#postingbody").text().trim() || ogDesc || null;
  if (!title || !Number.isFinite(price)) return null;
  return {
    platform: isFb ? "facebook" : "craigslist",
    sourceUrl: url,
    title,
    description,
    city,
    askingPrice: price,
    imageUrl: ogImage ?? null,
  };
}

export async function scrapeEstateSalesNet(
  city: string,
  state = "CO",
  limit = 20,
): Promise<ScrapedGarageSale[]> {
  const url = `https://www.estatesales.net/${state}/${city.replace(/\s+/g, "-")}`;
  let html: string;
  try {
    html = await fetchHtml(url);
  } catch (e) {
    console.error(`[scraper] estatesales ${url}: ${(e as Error).message}`);
    return [];
  }
  const $ = cheerio.load(html);
  const sales: ScrapedGarageSale[] = [];
  $("article.sale, .sale-card, [data-sale-id]").each((_, el) => {
    if (sales.length >= limit) return false;
    const $el = $(el);
    const link = $el.find("a").first();
    const href = link.attr("href");
    const title = $el.find("h2, .sale-title").first().text().trim();
    const address = $el.find(".sale-address, address").first().text().trim() || null;
    const date = $el.find("time, .sale-date").first().text().trim() || null;
    const img = $el.find("img").first().attr("src") ?? null;
    if (href && title) {
      sales.push({
        platform: "estatesales",
        sourceUrl: href.startsWith("http") ? href : `https://www.estatesales.net${href}`,
        title,
        description: null,
        city,
        address,
        lat: null,
        lng: null,
        saleDate: date,
        images: img ? [img] : [],
      });
    }
    return undefined;
  });
  return sales;
}
