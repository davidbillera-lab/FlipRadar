import { estimateEbayFees } from "./services/ebay.js";

export interface ScoreInput {
  askingPrice: number;
  ebayAvgSold: number | null;
  category: string | null;
  llmConfidence: number;
  /** Number of sold comps behind ebayAvgSold (from the shared sold-comps service). */
  compCount?: number;
  /** Median sold price, used with avg to gauge price spread/agreement. */
  ebayMedianSold?: number | null;
}

/** How much to trust the comp-derived ROI, based on sample size + price agreement. */
export type CompConfidence = "high" | "medium" | "low";

export interface ScoreOutput {
  ebayFees: number | null;
  netProfit: number | null;
  roiPct: number | null;
  score: number; // 0-100
  exitChannel: "ebay" | "facebook" | "local";
  compConfidence: CompConfidence;
  compCount: number;
}

const SHIPPING_RESERVE = 12; // average ship+pack cost
const PAYMENT_FEE_RATE = 0.029;

/**
 * Rate how trustworthy the sold-comp signal is.
 *   - low:    fewer than 3 comps (too thin to mean anything)
 *   - high:   8+ comps AND avg/median within 15% (tight, well-sampled)
 *   - medium: everything in between
 * Spread is the relative gap between avg and median; a large gap means
 * outliers/bimodal pricing, so the average is less meaningful.
 */
function rateCompConfidence(
  count: number,
  avg: number,
  median: number | null | undefined,
): CompConfidence {
  if (count < 3) return "low";
  const spread =
    median && median > 0 ? Math.abs(avg - median) / median : 1;
  if (count >= 8 && spread <= 0.15) return "high";
  if (count >= 5 && spread <= 0.3) return "medium";
  return count >= 5 ? "medium" : "low";
}

/**
 * Heuristic deal score:
 *   - 0 if asking price >= eBay avg or no comps
 *   - scales with ROI%, capped at 100 around 200% ROI
 *   - penalized by low LLM confidence and by thin/uncertain comps
 */
export function scoreDeal(input: ScoreInput): ScoreOutput {
  const compCount = input.compCount ?? 0;

  if (!input.ebayAvgSold || input.ebayAvgSold <= 0) {
    return {
      ebayFees: null,
      netProfit: null,
      roiPct: null,
      score: 0,
      exitChannel: "local",
      compConfidence: "low",
      compCount,
    };
  }

  const compConfidence = rateCompConfidence(
    compCount,
    input.ebayAvgSold,
    input.ebayMedianSold,
  );

  const fees = estimateEbayFees(input.ebayAvgSold, input.category);
  const paymentFee = input.ebayAvgSold * PAYMENT_FEE_RATE;
  const netProfit = input.ebayAvgSold - input.askingPrice - fees - paymentFee - SHIPPING_RESERVE;
  const roi = (netProfit / Math.max(input.askingPrice, 1)) * 100;

  // Score curve: 0 at 0% ROI, 100 at 200% ROI, capped
  let raw = Math.min(100, Math.max(0, (roi / 2) * 1));
  // Penalize low LLM confidence (<0.5 halves the score)
  if (input.llmConfidence < 0.5) raw *= input.llmConfidence * 2;
  // Discount the score when the comp signal itself is shaky.
  if (compConfidence === "low") raw *= 0.6;
  else if (compConfidence === "medium") raw *= 0.85;

  // Pick exit channel: small/cheap items eBay; bulky/heavy local
  const exitChannel: "ebay" | "facebook" | "local" =
    input.ebayAvgSold < 50 ? "local" : input.ebayAvgSold > 400 ? "facebook" : "ebay";

  return {
    ebayFees: Number(fees.toFixed(2)),
    netProfit: Number(netProfit.toFixed(2)),
    roiPct: Number(roi.toFixed(1)),
    score: Math.round(raw),
    exitChannel,
    compConfidence,
    compCount,
  };
}
