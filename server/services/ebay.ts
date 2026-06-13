import { request } from "undici";

const DEFAULT_COMPS_URL =
  "https://dmtctlpzlfpcogpjweuv.supabase.co/functions/v1/ebay-sold-comps";

export interface EbayComp {
  itemId: string;
  title: string;
  price: number;
  currency: string;
  condition?: string;
  itemWebUrl: string;
  soldDate?: string;
}

export interface EbayCompResult {
  query: string;
  avgPrice: number;
  medianPrice: number;
  count: number;
  listings: EbayComp[];
  dataSource?: "ebay_sold";
  cached?: boolean;
}

/**
 * Thin client of the portfolio-shared `ebay-sold-comps` edge function in Mission
 * Control (Supabase dmtctlpzlfpcogpjweuv). Returns real eBay **SOLD** prices, not
 * active/asking prices — so ROI is believable. The trimmed-mean/median math and
 * 7-day caching now live server-side in the edge function; FlipRadar just consumes
 * the aggregates. One data source, many consumers (FlipRadar + VZT).
 *
 * Contract: personal-os/docs/shared-services/ebay-sold-comps.md
 */
export async function lookupEbayComps(query: string, limit = 20): Promise<EbayCompResult> {
  const url = process.env.EBAY_COMPS_SERVICE_URL ?? DEFAULT_COMPS_URL;
  const token = process.env.EBAY_COMPS_SERVICE_TOKEN;
  const empty: EbayCompResult = {
    query,
    avgPrice: 0,
    medianPrice: 0,
    count: 0,
    listings: [],
    dataSource: "ebay_sold",
  };

  if (!token) {
    throw new Error(
      "Sold-comps service token missing. Set EBAY_COMPS_SERVICE_TOKEN in .env",
    );
  }

  const res = await request(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, limit }),
  });

  if (res.statusCode !== 200) {
    const txt = await res.body.text();
    throw new Error(`ebay-sold-comps failed: ${res.statusCode} ${txt}`);
  }

  const data = (await res.body.json()) as Partial<EbayCompResult>;
  const listings: EbayComp[] = Array.isArray(data.listings) ? data.listings : [];

  if (!data.count || data.count <= 0) {
    return empty;
  }

  return {
    query: data.query ?? query,
    avgPrice: Number((data.avgPrice ?? 0).toFixed(2)),
    medianPrice: Number((data.medianPrice ?? 0).toFixed(2)),
    count: data.count,
    listings,
    dataSource: "ebay_sold",
    cached: data.cached,
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
