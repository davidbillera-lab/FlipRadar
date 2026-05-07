import Anthropic from "@anthropic-ai/sdk";

export const IDENTIFICATION_PROMPT = `You are a resale arbitrage product identifier. Given a marketplace listing, identify the specific product, brand, and model so it can be matched to eBay sold comps.

Respond with ONLY valid JSON, no prose, in this exact shape:
{
  "brand": string | null,
  "model": string | null,
  "product": string,
  "category": "electronics" | "antiques" | "collectibles" | "power_tools" | "other",
  "ebay_search_query": string,
  "confidence": number
}

Rules:
- "ebay_search_query" should be a short search string (3–7 words) that will return matching listings on eBay. Include brand and model if known.
- "confidence" is 0–1.
- If the listing is a junk/lot/garage-sale-mixed item, set product to a brief description and confidence < 0.3.
- Output JSON only.`;

export interface ProductIdentification {
  brand: string | null;
  model: string | null;
  product: string;
  category: "electronics" | "antiques" | "collectibles" | "power_tools" | "other";
  ebay_search_query: string;
  confidence: number;
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (client) return client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY missing");
  client = new Anthropic({ apiKey });
  return client;
}

export async function identifyProduct(opts: {
  title: string;
  description?: string | null;
  askingPrice: number;
}): Promise<ProductIdentification> {
  const c = getClient();
  const userContent = [
    `Title: ${opts.title}`,
    `Asking Price: $${opts.askingPrice}`,
    opts.description ? `Description: ${opts.description}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const res = await c.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 400,
    system: IDENTIFICATION_PROMPT,
    messages: [{ role: "user", content: userContent }],
  });

  const block = res.content.find((b) => b.type === "text");
  const text = block && block.type === "text" ? block.text.trim() : "";
  // Strip code fences if the model added them
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");

  try {
    const parsed = JSON.parse(cleaned) as ProductIdentification;
    return {
      brand: parsed.brand ?? null,
      model: parsed.model ?? null,
      product: parsed.product ?? opts.title,
      category: parsed.category ?? "other",
      ebay_search_query: parsed.ebay_search_query ?? opts.title,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
    };
  } catch {
    return {
      brand: null,
      model: null,
      product: opts.title,
      category: "other",
      ebay_search_query: opts.title,
      confidence: 0,
    };
  }
}
