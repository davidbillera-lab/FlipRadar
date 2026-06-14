"use client";

import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";

type Sale = {
  id: number;
  uuid: string;
  title: string;
  platform: string;
  city: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  sourceUrl: string;
};

type Waypoint = {
  id: string | number;
  lat: number;
  lng: number;
  title?: string;
  address?: string;
  sourceUrl?: string;
};

type OptimizeResponse = {
  ok: boolean;
  error?: string;
  orderedWaypoints: Waypoint[];
  totalDistanceMeters: number;
  totalDurationSeconds: number;
  googleMapsUrl: string;
  startLat: number;
  startLng: number;
  startFormatted?: string;
};

declare global {
  interface Window {
    google?: any;
    initFlipRadarMap?: () => void;
  }
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export default function RoutePage() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [startAddress, setStartAddress] = useState("");
  const [optimizing, setOptimizing] = useState(false);
  const [error, setError] = useState("");
  const [optimized, setOptimized] = useState<OptimizeResponse | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const startMarkerRef = useRef<any>(null);
  const directionsRendererRef = useRef<any>(null);

  useEffect(() => {
    trpc.garageSales.list.query({})
      .then((d) => {
        const rows = (d.rows as unknown as Sale[]).filter(
          (s): s is Sale => s != null && s.lat != null && s.lng != null
        );
        setSales(rows);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem("fr_start_address");
    if (saved) setStartAddress(saved);
  }, []);

  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!apiKey) return;
    if (window.google?.maps) { setMapReady(true); return; }

    window.initFlipRadarMap = () => setMapReady(true);
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&callback=initFlipRadarMap`;
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);

    return () => { delete window.initFlipRadarMap; };
  }, []);

  useEffect(() => {
    if (!mapReady || !mapRef.current || mapInstanceRef.current) return;
    mapInstanceRef.current = new window.google.maps.Map(mapRef.current, {
      zoom: 11,
      center: { lat: 39.7392, lng: -104.9903 },
      mapTypeControl: false,
      streetViewControl: false,
    });
  }, [mapReady]);

  useEffect(() => {
    if (!mapInstanceRef.current) return;
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];

    const orderById = new Map<number, number>();
    if (optimized?.orderedWaypoints) {
      optimized.orderedWaypoints.forEach((w, i) => orderById.set(Number(w.id), i + 1));
    }

    const targets = selectedIds.size === 0
      ? sales
      : sales.filter((s) => selectedIds.has(s.id));

    const bounds = new window.google.maps.LatLngBounds();
    targets.forEach((s) => {
      const pos = { lat: Number(s.lat), lng: Number(s.lng) };
      const order = orderById.get(s.id);
      const marker = new window.google.maps.Marker({
        position: pos,
        map: mapInstanceRef.current,
        title: s.title,
        label: order
          ? { text: String(order), color: "#fff", fontWeight: "bold", fontSize: "12px" }
          : undefined,
      });
      marker.addListener("click", () => window.open(s.sourceUrl, "_blank"));
      markersRef.current.push(marker);
      bounds.extend(pos);
    });
    if (startMarkerRef.current) bounds.extend(startMarkerRef.current.getPosition());
    if (!bounds.isEmpty()) mapInstanceRef.current.fitBounds(bounds, 60);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sales, selectedIds, optimized, mapReady]);

  function toggleSale(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.size === 0) {
        sales.forEach((s) => next.add(s.id));
      }
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function runOptimize() {
    if (!startAddress.trim()) { setError("Enter a starting address first."); return; }
    setError("");
    setOptimizing(true);
    try {
      const saleIds = selectedIds.size === 0 ? undefined : [...selectedIds];
      const res = await fetch(`${API_URL}/api/route/optimize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startAddress: startAddress.trim(), saleIds }),
      });
      const j: OptimizeResponse = await res.json();
      if (!j.ok) { setError(j.error ?? "Optimization failed."); return; }
      setOptimized(j);
      localStorage.setItem("fr_start_address", startAddress.trim());
      drawRoute(j);
    } catch (e: any) {
      setError(e?.message ?? "Network error.");
    } finally {
      setOptimizing(false);
    }
  }

  function drawRoute(j: OptimizeResponse) {
    if (!mapInstanceRef.current) return;
    if (startMarkerRef.current) startMarkerRef.current.setMap(null);
    startMarkerRef.current = new window.google.maps.Marker({
      position: { lat: j.startLat, lng: j.startLng },
      map: mapInstanceRef.current,
      title: "Start: " + (j.startFormatted ?? startAddress),
      icon: {
        path: window.google.maps.SymbolPath.CIRCLE,
        scale: 9,
        fillColor: "#22c55e",
        fillOpacity: 1,
        strokeColor: "#ffffff",
        strokeWeight: 2,
      },
      zIndex: 999,
    });

    if (!directionsRendererRef.current) {
      directionsRendererRef.current = new window.google.maps.DirectionsRenderer({
        map: mapInstanceRef.current,
        suppressMarkers: false,
        polylineOptions: { strokeColor: "#3b82f6", strokeWeight: 4, strokeOpacity: 0.85 },
      });
    }

    const waypoints = j.orderedWaypoints.map((w) => ({
      location: { lat: w.lat, lng: w.lng },
      stopover: true,
    }));

    new window.google.maps.DirectionsService().route(
      {
        origin: { lat: j.startLat, lng: j.startLng },
        destination: { lat: j.startLat, lng: j.startLng },
        waypoints,
        optimizeWaypoints: false,
        travelMode: window.google.maps.TravelMode.DRIVING,
      },
      (resp: any, status: string) => {
        if (status === "OK") directionsRendererRef.current.setDirections(resp);
        else setError("Map render failed: " + status);
      },
    );
  }

  function handleReset() {
    setOptimized(null);
    setSelectedIds(new Set());
    setError("");
    if (directionsRendererRef.current) directionsRendererRef.current.set("directions", null);
    if (startMarkerRef.current) { startMarkerRef.current.setMap(null); startMarkerRef.current = null; }
  }

  const orderById = new Map<number, number>();
  if (optimized?.orderedWaypoints) {
    optimized.orderedWaypoints.forEach((w, i) => orderById.set(Number(w.id), i + 1));
  }

  const displaySales = optimized
    ? [...sales].sort((a, b) => (orderById.get(a.id) ?? 9999) - (orderById.get(b.id) ?? 9999))
    : sales;

  const miles = optimized ? (optimized.totalDistanceMeters / 1609.34).toFixed(1) : null;
  const mins = optimized ? Math.round(optimized.totalDurationSeconds / 60) : null;

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:h-[calc(100vh-9rem)]">
      {/* Sidebar */}
      <div className="w-full lg:w-96 shrink-0 space-y-3 lg:overflow-y-auto lg:pr-2">
        <h1 className="text-lg font-semibold">Route Planner</h1>

        <div className="rounded-xl border border-zinc-200 bg-white p-4 space-y-3">
          <label className="block space-y-1">
            <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">
              Starting Address
            </span>
            <input
              type="text"
              value={startAddress}
              onChange={(e) => setStartAddress(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") runOptimize(); }}
              placeholder="123 Main St, Denver, CO"
              className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400"
            />
          </label>
          <div className="flex gap-2">
            <button
              onClick={runOptimize}
              disabled={optimizing}
              className="flex-1 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50"
            >
              {optimizing ? "Optimizing…" : "Optimize Route"}
            </button>
            <button
              onClick={handleReset}
              className="rounded-lg border border-zinc-200 px-4 py-2 text-sm text-zinc-600 transition-colors hover:border-zinc-400"
            >
              Reset
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
            {error}
          </div>
        )}

        {optimized && (
          <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 space-y-2">
            <div className="flex gap-5 text-sm">
              <span>
                <span className="font-semibold text-zinc-900">{optimized.orderedWaypoints.length}</span>{" "}
                <span className="text-zinc-500">stops</span>
              </span>
              <span>
                <span className="font-semibold text-zinc-900">{miles}</span>{" "}
                <span className="text-zinc-500">mi</span>
              </span>
              <span>
                <span className="font-semibold text-zinc-900">{mins}</span>{" "}
                <span className="text-zinc-500">min driving</span>
              </span>
            </div>
            <a
              href={optimized.googleMapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-600 hover:underline"
            >
              Open turn-by-turn in Google Maps →
            </a>
          </div>
        )}

        {loading ? (
          <p className="text-sm text-zinc-400">Loading…</p>
        ) : sales.length === 0 ? (
          <div className="rounded-xl border border-zinc-200 bg-white p-6 text-center text-sm text-zinc-400">
            No geocoded garage sales yet. Run the scraper from the dashboard first.
          </div>
        ) : (
          <div className="space-y-2">
            {displaySales.map((sale) => {
              const isSelected = selectedIds.size === 0 || selectedIds.has(sale.id);
              const order = orderById.get(sale.id);
              return (
                <SaleItem
                  key={sale.uuid}
                  sale={sale}
                  selected={isSelected}
                  order={order}
                  onToggle={() => toggleSale(sale.id)}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Map */}
      <div className="flex-1 min-h-64">
        {process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ? (
          <div
            ref={mapRef}
            className="w-full h-64 lg:h-full rounded-xl border border-zinc-200 bg-zinc-100"
          />
        ) : (
          <div className="flex w-full h-64 lg:h-full items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50 text-sm text-zinc-400">
            Map unavailable — set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY to enable
          </div>
        )}
      </div>
    </div>
  );
}

function SaleItem({
  sale, selected, order, onToggle,
}: {
  sale: Sale;
  selected: boolean;
  order?: number;
  onToggle: () => void;
}) {
  return (
    <div
      onClick={onToggle}
      className={`relative rounded-xl border p-3 cursor-pointer transition-colors ${
        selected
          ? "border-zinc-300 bg-white hover:border-zinc-400"
          : "border-zinc-200 bg-zinc-50 hover:border-zinc-300"
      }`}
    >
      {order != null && (
        <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-900 text-[10px] font-bold text-white">
          {order}
        </span>
      )}
      <div className="flex items-start gap-2 pr-7">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          onClick={(e) => e.stopPropagation()}
          className="mt-0.5 shrink-0"
        />
        <div className="min-w-0">
          <p className="line-clamp-2 text-sm font-medium leading-snug">{sale.title}</p>
          {sale.address && (
            <p className="mt-0.5 line-clamp-1 text-xs text-zinc-500">{sale.address}</p>
          )}
          <a
            href={sale.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="mt-1 inline-block text-xs text-blue-600 hover:underline"
          >
            Open listing →
          </a>
        </div>
      </div>
    </div>
  );
}
