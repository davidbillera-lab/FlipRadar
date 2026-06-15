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
  saleDate: string | null;
  status: string | null;
  sourceUrl: string;
  description: string | null;
  images: string[];
};

const STATUSES = ["all", "upcoming", "ongoing", "past"] as const;

const STATUS_COLORS: Record<string, string> = {
  upcoming: "bg-blue-100 text-blue-800",
  ongoing: "bg-green-100 text-green-800",
  past: "bg-zinc-100 text-zinc-500",
};

declare global {
  interface Window {
    google?: any;
    initFlipRadarMap?: () => void;
  }
}

export default function GarageSalesPage() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string>("all");
  const [mapReady, setMapReady] = useState(false);
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);

  useEffect(() => {
    trpc.garageSales.list.query({})
      .then((d) => setSales((d.rows as unknown as Sale[]).filter(Boolean)))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // Load Google Maps script once
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

    return () => {
      delete window.initFlipRadarMap;
    };
  }, []);

  // Init map when ready
  useEffect(() => {
    if (!mapReady || !mapRef.current || mapInstanceRef.current) return;
    mapInstanceRef.current = new window.google.maps.Map(mapRef.current, {
      zoom: 11,
      center: { lat: 39.7392, lng: -104.9903 }, // Denver default
      mapTypeControl: false,
      streetViewControl: false,
    });
  }, [mapReady]);

  // Sync markers whenever sales or filter changes
  useEffect(() => {
    if (!mapInstanceRef.current) return;

    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];

    const filtered = applyFilter(sales, status);
    const bounds = new window.google.maps.LatLngBounds();
    let hasBounds = false;

    const esc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const safeHref = (url: string) => (/^https?:\/\//.test(url) ? url : "#");

    filtered.forEach((sale) => {
      if (sale.lat == null || sale.lng == null) return;
      const pos = { lat: sale.lat, lng: sale.lng };
      const marker = new window.google.maps.Marker({
        position: pos,
        map: mapInstanceRef.current,
        title: sale.title,
      });
      const infoWindow = new window.google.maps.InfoWindow({
        content: `<div style="max-width:220px"><strong>${esc(sale.title)}</strong><br/>${esc(sale.address ?? sale.city)}<br/><a href="${safeHref(sale.sourceUrl)}" target="_blank" rel="noopener">View listing →</a></div>`,
      });
      marker.addListener("click", () => {
        infoWindow.open(mapInstanceRef.current, marker);
      });
      markersRef.current.push(marker);
      bounds.extend(pos);
      hasBounds = true;
    });

    if (hasBounds) mapInstanceRef.current.fitBounds(bounds);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sales, status, mapReady]);

  function applyFilter(rows: Sale[], s: string) {
    if (s === "all") return rows;
    return rows.filter((r) => (r.status ?? "upcoming") === s);
  }

  const filtered = applyFilter(sales, status);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Garage Sales</h1>
        <span className="text-xs text-zinc-400">{filtered.length} sales</span>
      </div>

      {/* Status filter */}
      <div className="flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              status === s
                ? "bg-zinc-900 text-white"
                : "bg-white border border-zinc-200 text-zinc-600 hover:border-zinc-400"
            }`}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {/* Map */}
      {process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ? (
        <div
          ref={mapRef}
          className="w-full rounded-xl border border-zinc-200 bg-zinc-100"
          style={{ height: 360 }}
        />
      ) : (
        <div className="flex items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50 text-sm text-zinc-400" style={{ height: 360 }}>
          Map unavailable — set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY to enable
        </div>
      )}

      {/* List */}
      {loading ? (
        <p className="text-sm text-zinc-400">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-zinc-400">No sales found.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {filtered.map((sale) => (
            <SaleCard key={sale.uuid} sale={sale} />
          ))}
        </div>
      )}
    </div>
  );
}

function SaleCard({ sale }: { sale: Sale }) {
  const statusLabel = sale.status ?? "upcoming";
  const statusClass = STATUS_COLORS[statusLabel] ?? "bg-zinc-100 text-zinc-500";
  return (
    <a
      href={sale.sourceUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-4 transition-shadow hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="line-clamp-2 text-sm font-medium leading-snug">{sale.title}</p>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${statusClass}`}>
          {statusLabel}
        </span>
      </div>
      {sale.address && (
        <p className="text-xs text-zinc-500 line-clamp-1">{sale.address}</p>
      )}
      <div className="flex items-center gap-3 text-xs text-zinc-400">
        <span>{sale.city}</span>
        {sale.saleDate && <span>· {sale.saleDate}</span>}
        <span>· {sale.platform}</span>
      </div>
    </a>
  );
}
