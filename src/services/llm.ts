export const IDENTIFICATION_PROMPT = `Analyze the following deal description and identify the specific product, brand, and model. Output the results in JSON format.`;

export async function identifyProduct(description: string) {
  // Logic to call LLM with IDENTIFICATION_PROMPT
  return { brand: "", model: "", product: "" };
}
