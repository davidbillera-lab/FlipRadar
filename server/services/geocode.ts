import { request } from "undici";
import { rawDb } from "../db/index.js";

export interface GeocodeResult {
  lat: number;
  lng: number;
  formatted?: string;
}

const cache = rawDb.prepare(
  "SELECT lat, lng, formatted FROM geocode_cache WHERE address = ?",
);
const insert = rawDb.prepare(
  "INSERT OR REPLACE INTO geocode_cache (address, lat, lng, formatted, created_at) VALUES (?, ?, ?, ?, ?)",
);

/**
 * Geocode a free-form address using Google Geocoding API.
 * Cached forever (addresses don't move). Returns null on miss / error / no-key.
 */
export async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  const trimmed = address.trim();
  if (!trimmed) return null;

  const hit: any = cache.get(trimmed);
  if (hit) {
    return { lat: hit.lat, lng: hit.lng, formatted: hit.formatted ?? undefined };
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
    insert.run(trimmed, result.lat, result.lng, result.formatted ?? null, Date.now());
    return result;
  } catch (e) {
    console.error(`[geocode] error for "${trimmed}":`, (e as Error).message);
    return null;
  }
}
