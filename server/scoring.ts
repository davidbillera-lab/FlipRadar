import { estimateEbayFees } from "./services/ebay.js";

export interface ScoreInput {
  askingPrice: number;
  ebayAvgSold: number | null;
  category: string | null;
  llmConfidence: number;
}

export interface ScoreOutput {
  ebayFees: number | null;
  netProfit: number | null;
  roiPct: number | null;
  score: number; // 0-100
  exitChannel: "ebay" | "facebook" | "local";
}

const SHIPPING_RESERVE = 12; // average ship+pack cost
const PAYMENT_FEE_RATE = 0.029;

/**
 * Heuristic deal score:
 *   - 0 if asking price >= eBay avg or no comps
 *   - scales with ROI%, capped at 100 around 200% ROI
 *   - penalized by low LLM confidence
 */
export function scoreDeal(input: ScoreInput): ScoreOutput {
  if (!input.ebayAvgSold || input.ebayAvgSold <= 0) {
    return {
      ebayFees: null,
      netProfit: null,
      roiPct: null,
      score: 0,
      exitChannel: "local",
    };
  }

  const fees = estimateEbayFees(input.ebayAvgSold, input.category);
  const paymentFee = input.ebayAvgSold * PAYMENT_FEE_RATE;
  const netProfit = input.ebayAvgSold - input.askingPrice - fees - paymentFee - SHIPPING_RESERVE;
  const roi = (netProfit / Math.max(input.askingPrice, 1)) * 100;

  // Score curve: 0 at 0% ROI, 100 at 200% ROI, capped
  let raw = Math.min(100, Math.max(0, (roi / 2) * 1));
  // Penalize low LLM confidence (<0.5 halves the score)
  if (input.llmConfidence < 0.5) raw *= input.llmConfidence * 2;

  // Pick exit channel: small/cheap items eBay; bulky/heavy local
  const exitChannel: "ebay" | "facebook" | "local" =
    input.ebayAvgSold < 50 ? "local" : input.ebayAvgSold > 400 ? "facebook" : "ebay";

  return {
    ebayFees: Number(fees.toFixed(2)),
    netProfit: Number(netProfit.toFixed(2)),
    roiPct: Number(roi.toFixed(1)),
    score: Math.round(raw),
    exitChannel,
  };
}
