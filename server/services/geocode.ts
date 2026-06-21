import { request } from "undici";
import { db, schema } from "../db/index.js";
import { eq } from "drizzle-orm";

export interface GeocodeResult {
  lat: number;
  lng: number;
  formatted?: string;
}

export async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  const trimmed = address.trim();
  if (!trimmed) return null;

  // Check cache first
  try {
    const rows = await db
      .select()
      .from(schema.geocodeCache)
      .where(eq(schema.geocodeCache.address, trimmed));
    const hit = rows[0];
    if (hit) {
      return { lat: hit.lat, lng: hit.lng, formatted: hit.formatted ?? undefined };
    }
  } catch (e) {
    // Table missing or DB error — fall through to API call (no cache)
    console.warn(`[geocode] cache read failed (continuing): ${(e as Error).message}`);
  }

  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    console.warn(`[geocode] GOOGLE_MAPS_API_KEY missing — cannot geocode "${trimmed}"`);
    return null;
  }

  const url =
    `https://maps.googleapis.com/maps/api/geocode/json?address=` +
    encodeURIComponent(trimmed) +
    `&key=${key}`;

  try {
    const res = await request(url, { method: "GET" });
    if (res.statusCode !== 200) {
      const txt = await res.body.text();
      console.error(`[geocode] HTTP ${res.statusCode}: ${txt.slice(0, 200)}`);
      return null;
    }
    const data: any = await res.body.json();
    if (data.status !== "OK" || !data.results?.length) {
      console.warn(`[geocode] "${trimmed}" → ${data.status}`);
      return null;
    }
    const r = data.results[0];
    const result: GeocodeResult = {
      lat: r.geometry.location.lat,
      lng: r.geometry.location.lng,
      formatted: r.formatted_address,
    };
    try {
      await db
        .insert(schema.geocodeCache)
        .values({
          address: trimmed,
          lat: result.lat,
          lng: result.lng,
          formatted: result.formatted ?? null,
          createdAt: new Date(),
        })
        .onConflictDoUpdate({
          target: schema.geocodeCache.address,
          set: {
            lat: result.lat,
            lng: result.lng,
            formatted: result.formatted ?? null,
            createdAt: new Date(),
          },
        });
    } catch (e) {
      console.warn(`[geocode] cache write failed (continuing): ${(e as Error).message}`);
    }
    return result;
  } catch (e) {
    console.error(`[geocode] error for "${trimmed}":`, (e as Error).message);
    return null;
  }
}
