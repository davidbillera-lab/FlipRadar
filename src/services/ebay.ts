// Re-export the real eBay Browse API client from the server module.
export { lookupEbayComps, estimateEbayFees } from "../../server/services/ebay.js";
export type { EbayComp, EbayCompResult } from "../../server/services/ebay.js";
