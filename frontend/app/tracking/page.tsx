"use client";

import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";

type TrackedDeal = {
  deal: {
    id: number;
    uuid: string;
    title: string | null;
    askingPrice: number | null;
    category: string | null;
    platform: string | null;
    city: string | null;
    listingUrl: string | null;
  };
  score: {
    score: number | null;
    netProfit: number | null;
    roiPct: number | null;
    exitChannel: string | null;
  };
  valuation: {
    ebayAvgSold: number | null;
    ebayCompCount: number | null;
  };
  tracking?: {
    purchasePrice: number | null;
    soldPrice: number | null;
    actualRoi: number | null;
    notes: string | null;
  };
} | null;

function fmt(n: number | null | undefined, prefix = "") {
  if (n == null) return "—";
  return `${prefix}${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function fmtPct(n: number | null | undefined) {
  if (n == null) return "—";
  return `${n.toFixed(1)}%`;
}

export default function TrackingPage() {
  const [deals, setDeals] = useState<TrackedDeal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    trpc.deals.list.query({ tracking: true, limit: 200 })
      .then((d) => setDeals((d.rows as unknown as TrackedDeal[]).filter(Boolean)))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const rows = deals.filter(Boolean) as NonNullable<TrackedDeal>[];

  const purchased = rows.filter((r) => r.tracking?.purchasePrice != null);
  const sold = rows.filter((r) => r.tracking?.soldPrice != null);

  const totalSpent = purchased.reduce((sum, r) => sum + (r.tracking?.purchasePrice ?? 0), 0);
  const totalRevenue = sold.reduce((sum, r) => sum + (r.tracking?.soldPrice ?? 0), 0);
  const totalRealized = totalRevenue - sold.reduce((sum, r) => sum + (r.tracking?.purchasePrice ?? 0), 0);
  const totalProjected = purchased
    .filter((r) => r.tracking?.soldPrice == null)
    .reduce((sum, r) => sum + (r.score?.netProfit ?? 0), 0);

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">Tracking</h1>

      {/* Summary stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Purchased" value={loading ? "…" : String(purchased.length)} />
        <StatCard label="Sold" value={loading ? "…" : String(sold.length)} />
        <StatCard label="Total Spent" value={loading ? "…" : fmt(totalSpent, "$")} />
        <StatCard label="Realized Profit" value={loading ? "…" : fmt(totalRealized, "$")} color={totalRealized >= 0 ? "text-green-700" : "text-red-600"} />
      </div>

      {loading ? (
        <p className="text-sm text-zinc-400">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center">
          <p className="text-sm text-zinc-500">No tracked deals yet.</p>
          <p className="mt-1 text-xs text-zinc-400">Open a deal and log your purchase price to start tracking.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Active (purchased, not yet sold) */}
          {purchased.filter((r) => r.tracking?.soldPrice == null).length > 0 && (
            <section className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                In inventory ({purchased.filter((r) => r.tracking?.soldPrice == null).length})
              </h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {purchased
                  .filter((r) => r.tracking?.soldPrice == null)
                  .map((r) => <TrackingCard key={r.deal.uuid} row={r} />)}
              </div>
            </section>
          )}

          {/* Sold */}
          {sold.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Sold ({sold.length}) · Realized: {fmt(totalRealized, "$")} · Projected remaining: {fmt(totalProjected, "$")}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {sold.map((r) => <TrackingCard key={r.deal.uuid} row={r} sold />)}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className={`mt-0.5 text-xl font-semibold tabular-nums ${color ?? ""}`}>{value}</p>
    </div>
  );
}

function TrackingCard({ row, sold }: { row: NonNullable<TrackedDeal>; sold?: boolean }) {
  const { deal, score, tracking } = row;
  const paid = tracking?.purchasePrice;
  const soldFor = tracking?.soldPrice;
  const actualRoi = tracking?.actualRoi;
  const projectedNet = score?.netProfit;

  return (
    <a
      href={`/deal/${deal.id}`}
      className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-4 transition-shadow hover:shadow-md"
    >
      <p className="line-clamp-2 text-sm font-medium leading-snug">{deal.title ?? "Untitled"}</p>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <Row label="Paid" value={fmt(paid, "$")} />
        {sold ? (
          <>
            <Row label="Sold for" value={fmt(soldFor, "$")} />
            <Row
              label="Actual ROI"
              value={fmtPct(actualRoi)}
              valueClass={(actualRoi ?? 0) >= 0 ? "text-green-700 font-semibold" : "text-red-600 font-semibold"}
            />
          </>
        ) : (
          <>
            <Row label="Projected net" value={fmt(projectedNet, "$")} valueClass="text-zinc-700" />
            <Row label="Projected ROI" value={fmtPct(score?.roiPct)} />
          </>
        )}
        <Row label="Exit" value={score?.exitChannel ?? "—"} />
      </div>

      {tracking?.notes && (
        <p className="text-xs text-zinc-400 line-clamp-1">{tracking.notes}</p>
      )}
    </a>
  );
}

function Row({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <>
      <span className="text-zinc-400">{label}</span>
      <span className={`font-medium text-zinc-800 ${valueClass ?? ""}`}>{value}</span>
    </>
  );
}
