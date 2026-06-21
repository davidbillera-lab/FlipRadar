import { db, schema } from "../db/index.js";
import { eq } from "drizzle-orm";

/**
 * Determine which cities to scrape for the deal feed. Priority:
 *   1. cities[] passed as inputCities
 *   2. city (single) passed as inputCity
 *   3. settings.scraper_cities (JSON array, e.g. ["Denver","Boulder"])
 *   4. settings.scraper_city (single string)
 *   5. process.env.SCRAPER_CITY (comma-separated allowed)
 *   6. fallback: ["denver"]
 */
export async function resolveScraperCities(
  inputCity?: string,
  inputCities?: string[],
): Promise<string[]> {
  if (inputCities?.length) return inputCities;
  if (inputCity) return [inputCity];

  const arrRows = await db
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, "scraper_cities"));
  const arrRow = arrRows[0];
  if (arrRow) {
    try {
      const parsed = JSON.parse(arrRow.value);
      if (Array.isArray(parsed) && parsed.length) return parsed.map(String);
      if (typeof parsed === "string" && parsed.trim()) return [parsed];
    } catch {}
  }

  const singleRows = await db
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, "scraper_city"));
  const singleRow = singleRows[0];
  if (singleRow) {
    try {
      const v = JSON.parse(singleRow.value);
      if (typeof v === "string" && v.trim()) return [v];
    } catch {
      if (singleRow.value) return [singleRow.value];
    }
  }

  const envCity = process.env.SCRAPER_CITY;
  if (envCity?.trim()) {
    return envCity.split(",").map((s) => s.trim()).filter(Boolean);
  }

  return ["denver"];
}
