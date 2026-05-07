import { request } from "undici";

const EBAY_OAUTH_URL = "https://api.ebay.com/identity/v1/oauth2/token";
const EBAY_BROWSE_BASE = "https://api.ebay.com/buy/browse/v1";

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAppAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.token;
  }
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "eBay credentials missing. Set EBAY_CLIENT_ID and EBAY_CLIENT_SECRET in .env",
    );
  }
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: "https://api.ebay.com/oauth/api_scope",
  }).toString();

  const res = await request(EBAY_OAUTH_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (res.statusCode !== 200) {
    const txt = await res.body.text();
    throw new Error(`eBay OAuth failed: ${res.statusCode} ${txt}`);
  }
  const json = (await res.body.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  return cachedToken.token;
}

export interface EbayComp {
  itemId: string;
  title: string;
  price: number;
  currency: string;
  condition?: string;
  itemWebUrl: string;
}

export interface EbayCompResult {
  query: string;
  avgPrice: number;
  medianPrice: number;
  count: number;
  listings: EbayComp[];
}

/**
 * Browse API only returns active listings. We use these as a proxy for "comps":
 * the median active price is generally a conservative estimate of sold price.
 */
export async function lookupEbayComps(query: string, limit = 20): Promise<EbayCompResult> {
  const token = await getAppAccessToken();
  const marketplace = process.env.EBAY_MARKETPLACE_ID ?? "EBAY_US";
  const url = new URL(`${EBAY_BROWSE_BASE}/item_summary/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("filter", "buyingOptions:{FIXED_PRICE},conditionIds:{1000|1500|2000|2500|3000|4000|5000}");
  url.searchParams.set("sort", "price");

  const res = await request(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": marketplace,
      "Content-Type": "application/json",
    },
  });
  if (res.statusCode !== 200) {
    const txt = await res.body.text();
    throw new Error(`eBay search failed: ${res.statusCode} ${txt}`);
  }
  const data = (await res.body.json()) as {
    itemSummaries?: Array<{
      itemId: string;
      title: string;
      price?: { value: string; currency: string };
      condition?: string;
      itemWebUrl: string;
    }>;
  };

  const listings: EbayComp[] = (data.itemSummaries ?? [])
    .filter((it) => it.price?.value)
    .map((it) => ({
      itemId: it.itemId,
      title: it.title,
      price: Number(it.price!.value),
      currency: it.price!.currency,
      condition: it.condition,
      itemWebUrl: it.itemWebUrl,
    }));

  if (listings.length === 0) {
    return { query, avgPrice: 0, medianPrice: 0, count: 0, listings: [] };
  }

  // Drop top/bottom 10% to reduce outlier influence
  const sorted = [...listings].sort((a, b) => a.price - b.price);
  const trim = Math.floor(sorted.length * 0.1);
  const trimmed = sorted.slice(trim, sorted.length - trim);
  const sum = trimmed.reduce((acc, l) => acc + l.price, 0);
  const avgPrice = trimmed.length > 0 ? sum / trimmed.length : 0;
  const mid = Math.floor(trimmed.length / 2);
  const medianPrice =
    trimmed.length === 0
      ? 0
      : trimmed.length % 2 === 0
        ? ((trimmed[mid - 1]?.price ?? 0) + (trimmed[mid]?.price ?? 0)) / 2
        : (trimmed[mid]?.price ?? 0);

  return {
    query,
    avgPrice: Number(avgPrice.toFixed(2)),
    medianPrice: Number(medianPrice.toFixed(2)),
    count: listings.length,
    listings: listings.slice(0, 5),
  };
}

// eBay final value fees vary by category — these are rough 2025 defaults.
const EBAY_FEE_RATES: Record<string, number> = {
  electronics: 0.1335,
  antiques: 0.135,
  collectibles: 0.135,
  power_tools: 0.135,
  default: 0.135,
};

export function estimateEbayFees(salePrice: number, category: string | null | undefined): number {
  const rate = (category && EBAY_FEE_RATES[category]) || EBAY_FEE_RATES.default!;
  // Final value fee + ~$0.30 per-order fee
  return Number((salePrice * rate + 0.3).toFixed(2));
}
