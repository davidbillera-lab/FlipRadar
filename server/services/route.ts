import { request } from "undici";
import { geocodeAddress } from "./geocode.js";

export interface RouteWaypoint {
  id: string;
  title: string;
  address?: string | null;
  lat: number;
  lng: number;
}

export interface OptimizedRoute {
  orderedWaypoints: RouteWaypoint[];
  totalDistanceMeters: number;
  totalDurationSeconds: number;
  googleMapsUrl: string;
  startLat: number;
  startLng: number;
  startFormatted?: string;
}

/**
 * Calls Google Directions API with optimize:true to find the best ordering
 * of `sales` to visit when starting (and ending) at `startAddress`.
 *
 * Limits:
 *   - Google's optimizable waypoint cap is 25. We slice and warn beyond that.
 *   - Sales must already have lat/lng (they do, via the geocoder).
 *   - Returns `null` if no key, no sales, or the API rejects the request.
 */
export async function optimizeRoute(opts: {
  startAddress: string;
  sales: RouteWaypoint[];
}): Promise<OptimizedRoute | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    console.warn("[route] GOOGLE_MAPS_API_KEY missing");
    return null;
  }
  if (!opts.sales.length) return null;

  const start = await geocodeAddress(opts.startAddress);
  if (!start) {
    console.warn(`[route] could not geocode start "${opts.startAddress}"`);
    return null;
  }

  const sales = opts.sales.slice(0, 25);
  const origin = `${start.lat},${start.lng}`;
  const waypoints =
    "optimize:true|" + sales.map((s) => `${s.lat},${s.lng}`).join("|");

  const url =
    `https://maps.googleapis.com/maps/api/directions/json?` +
    `origin=${encodeURIComponent(origin)}` +
    `&destination=${encodeURIComponent(origin)}` +
    `&waypoints=${encodeURIComponent(waypoints)}` +
    `&key=${key}`;

  try {
    const res = await request(url, { method: "GET" });
    if (res.statusCode !== 200) {
      const txt = await res.body.text();
      console.error(`[route] HTTP ${res.statusCode}: ${txt.slice(0, 200)}`);
      return null;
    }
    const data: any = await res.body.json();
    if (data.status !== "OK" || !data.routes?.length) {
      console.warn(`[route] Directions API status=${data.status} msg=${data.error_message ?? ""}`);
      return null;
    }
    const route = data.routes[0];
    const order: number[] = route.waypoint_order ?? sales.map((_, i) => i);
    const orderedWaypoints = order.map((i) => sales[i]).filter((s): s is NonNullable<typeof s> => s != null);

    let totalDistance = 0;
    let totalDuration = 0;
    for (const leg of route.legs ?? []) {
      totalDistance += leg.distance?.value ?? 0;
      totalDuration += leg.duration?.value ?? 0;
    }

    // User-facing Google Maps URL preserving the optimized order.
    const gmapsUrl =
      `https://www.google.com/maps/dir/?api=1` +
      `&origin=${encodeURIComponent(opts.startAddress)}` +
      `&destination=${encodeURIComponent(opts.startAddress)}` +
      `&waypoints=` +
      orderedWaypoints
        .map((s) => encodeURIComponent(`${s.lat},${s.lng}`))
        .join("%7C") +
      `&travelmode=driving`;

    return {
      orderedWaypoints,
      totalDistanceMeters: totalDistance,
      totalDurationSeconds: totalDuration,
      googleMapsUrl: gmapsUrl,
      startLat: start.lat,
      startLng: start.lng,
      startFormatted: start.formatted,
    };
  } catch (e) {
    console.error("[route] error:", (e as Error).message);
    return null;
  }
}
