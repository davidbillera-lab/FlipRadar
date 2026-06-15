// Re-export the real Anthropic Claude product identifier from the server module.
export { identifyProduct, IDENTIFICATION_PROMPT } from "../../server/services/llm.js";
export type { ProductIdentification } from "../../server/services/llm.js";
