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
  if (res.statusCode !== 200) {
    throw new Error(`fetch ${url} failed: ${res.statusCode}`);
  }
  return res.body.text();
}

/**
 * Craigslist "for sale by owner" search. We focus on tools, electronics, antiques, collectibles.
 */
const CL_CATEGORIES: Record<string, string> = {
  electronics: "ela",
  antiques: "ata",
  collectibles: "cba",
  power_tools: "tla",
};

export async function scrapeCraigslist(opts: {
  city: string;
  category?: keyof typeof CL_CATEGORIES;
  maxPrice?: number;
  limit?: number;
}): Promise<ScrapedListing[]> {
  const cat = (opts.category && CL_CATEGORIES[opts.category]) || "sss";
  const params = new URLSearchParams({ srchType: "T", hasPic: "1" });
  if (opts.maxPrice) params.set("max_price", String(opts.maxPrice));
  const url = `https://${opts.city}.craigslist.org/search/${cat}?${params}`;

  let html: string;
  try {
    html = await fetchHtml(url);
  } catch (e) {
    console.error(`[scraper] craigslist ${url}: ${(e as Error).message}`);
    return [];
  }

  const $ = cheerio.load(html);
  const listings: ScrapedListing[] = [];
  const limit = opts.limit ?? 30;

  $(".cl-search-result, li.result-row").each((_, el) => {
    if (listings.length >= limit) return false;
    const $el = $(el);
    const link = $el.find("a.posting-title, a.result-title").first();
    const href = link.attr("href");
    const title = link.text().trim() || $el.find(".title").text().trim();
    const priceText = $el.find(".priceinfo, .result-price").first().text().trim();
    const priceMatch = priceText.match(/\$?([\d,]+)/);
    const price = priceMatch ? Number(priceMatch[1]!.replace(/,/g, "")) : NaN;
    const img = $el.find("img").first().attr("src") ?? null;

    if (href && title && Number.isFinite(price)) {
      listings.push({
        platform: "craigslist",
        sourceUrl: href.startsWith("http") ? href : `https://${opts.city}.craigslist.org${href}`,
        title,
        description: null,
        city: opts.city,
        askingPrice: price,
        imageUrl: img,
      });
    }
    return undefined;
  });

  return listings;
}

/**
 * Craigslist garage sales search.
 */
export async function scrapeCraigslistGarageSales(city: string, limit = 30): Promise<ScrapedGarageSale[]> {
  const url = `https://${city}.craigslist.org/search/gms?postedToday=1`;
  let html: string;
  try {
    html = await fetchHtml(url);
  } catch (e) {
    console.error(`[scraper] cl garage ${url}: ${(e as Error).message}`);
    return [];
  }

  const $ = cheerio.load(html);
  const sales: ScrapedGarageSale[] = [];

  $(".cl-search-result, li.result-row").each((_, el) => {
    if (sales.length >= limit) return false;
    const $el = $(el);
    const link = $el.find("a.posting-title, a.result-title").first();
    const href = link.attr("href");
    const title = link.text().trim() || $el.find(".title").text().trim();
    const date = $el.find("time").attr("datetime") ?? null;
    const img = $el.find("img").first().attr("src");

    if (href && title) {
      sales.push({
        platform: "craigslist",
        sourceUrl: href.startsWith("http") ? href : `https://${city}.craigslist.org${href}`,
        title,
        description: null,
        city,
        address: null,
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

/**
 * Facebook Marketplace requires authentication and aggressively blocks scrapers.
 * Without a logged-in session there is no reliable way to fetch listings server-side.
 * To support Facebook listings, users can paste a marketplace URL into the
 * "Import Deal URL" form on the dashboard — that path is handled in the router.
 */
export async function scrapeFacebookMarketplace(): Promise<ScrapedListing[]> {
  console.warn(
    "[scraper] Facebook Marketplace requires auth; use the Import URL flow on the dashboard instead.",
  );
  return [];
}

/**
 * Best-effort parse of a single Facebook Marketplace or Craigslist URL.
 * Used by the "Import Deal URL" UI button.
 */
export async function importListingFromUrl(url: string, city: string): Promise<ScrapedListing | null> {
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

  // Craigslist exposes price in markup; FB hides behind JSON in the HTML.
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

/**
 * EstateSales.net has a public listing index by city.
 */
export async function scrapeEstateSalesNet(city: string, state = "CO", limit = 20): Promise<ScrapedGarageSale[]> {
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
