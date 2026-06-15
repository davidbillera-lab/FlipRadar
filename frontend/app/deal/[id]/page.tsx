"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { CompBadge } from "@/components/CompBadge";

type DealDetail = {
  deal: {
    id: number;
    uuid: string;
    title: string | null;
    askingPrice: number | null;
    category: string | null;
    platform: string | null;
    imageUrl: string | null;
    listingUrl: string | null;
    city: string | null;
  } | null;
  score: {
    score: number | null;
    netProfit: number | null;
    roiPct: number | null;
    exitChannel: string | null;
    ebayFees: number | null;
  } | null;
  valuation: {
    ebayAvgSold: number | null;
    ebayCompCount: number | null;
    ebayCompsUrl: string | null;
  } | null;
  tracking: {
    purchasePrice: number | null;
    soldPrice: number | null;
    actualRoi: number | null;
    notes: string | null;
  } | null;
};

function fmt(n: number | null | undefined, prefix = "") {
  if (n == null) return "—";
  return `${prefix}${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function fmtPct(n: number | null | undefined) {
  if (n == null) return "—";
  return `${n.toFixed(1)}%`;
}

export default function DealDetailPage() {
  const params = useParams();
  const id = params?.id as string;

  const [data, setData] = useState<DealDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  const [purchasePrice, setPurchasePrice] = useState("");
  const [soldPrice, setSoldPrice] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    trpc.deals.get.query({ id: Number(id) })
      .then((d) => {
        setData(d as unknown as DealDetail);
        if (d.tracking?.purchasePrice != null) setPurchasePrice(String(d.tracking.purchasePrice));
        if (d.tracking?.soldPrice != null) setSoldPrice(String(d.tracking.soldPrice));
        if (d.tracking?.notes) setNotes(d.tracking.notes);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!id) return;
    setSaving(true);
    setSaveMsg("");
    try {
      await trpc.deals.updateTracking.mutate({
        dealId: Number(id),
        purchasePrice: purchasePrice ? Number(purchasePrice) : null,
        soldPrice: soldPrice ? Number(soldPrice) : null,
        notes: notes || null,
      });
      setSaveMsg("Saved");
      setTimeout(() => setSaveMsg(""), 2000);
    } catch (e) {
      setSaveMsg("Error saving");
      console.error(e);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-sm text-zinc-400">Loading…</p>;
  if (!data?.deal) return <p className="text-sm text-zinc-400">Deal not found.</p>;

  const { deal, score, valuation, tracking } = data;

  return (
    <div className="space-y-6">
      <a href="/" className="text-xs text-zinc-500 hover:text-zinc-800">← Back to deals</a>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* Left: deal info */}
        <div className="space-y-4">
          {deal.imageUrl && (
            <img
              src={deal.imageUrl}
              alt={deal.title ?? "Deal image"}
              className="w-full max-h-72 rounded-xl object-cover border border-zinc-200"
            />
          )}

          <div className="rounded-xl border border-zinc-200 bg-white p-5 space-y-4">
            <div className="flex items-start gap-3">
              <h1 className="flex-1 text-lg font-semibold leading-snug">{deal.title ?? "Untitled"}</h1>
              {score?.score != null && (
                <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-sm font-semibold ${
                  score.score >= 70 ? "bg-green-100 text-green-800" :
                  score.score >= 40 ? "bg-yellow-100 text-yellow-800" :
                  "bg-red-100 text-red-800"
                }`}>
                  {score.score}
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              <MetaRow label="Platform" value={deal.platform} />
              <MetaRow label="Category" value={deal.category} />
              <MetaRow label="City" value={deal.city} />
              <MetaRow label="Asking" value={fmt(deal.askingPrice, "$")} />
              <MetaRow label="Exit channel" value={score?.exitChannel} />
              <MetaRow label="eBay fees" value={fmt(score?.ebayFees, "$")} />
            </div>

            {deal.listingUrl && (
              <a
                href={deal.listingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block text-xs text-blue-600 hover:underline"
              >
                View original listing →
              </a>
            )}
          </div>

          {/* Valuation */}
          <div className="rounded-xl border border-zinc-200 bg-white p-5 space-y-3">
            <h2 className="text-sm font-semibold">eBay Comps</h2>
            <div className="flex items-center gap-4">
              <div>
                <p className="text-xs text-zinc-500">Avg sold</p>
                <p className="text-xl font-semibold tabular-nums">{fmt(valuation?.ebayAvgSold, "$")}</p>
              </div>
              <div>
                <p className="text-xs text-zinc-500">Net profit</p>
                <p className={`text-xl font-semibold tabular-nums ${
                  (score?.netProfit ?? 0) >= 0 ? "text-green-700" : "text-red-600"
                }`}>
                  {score?.netProfit != null ? `${score.netProfit >= 0 ? "+" : ""}${fmt(score.netProfit, "$")}` : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs text-zinc-500">ROI</p>
                <p className="text-xl font-semibold tabular-nums">{fmtPct(score?.roiPct)}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <CompBadge count={valuation?.ebayCompCount ?? 0} />
              {valuation?.ebayCompsUrl && (
                <a
                  href={valuation.ebayCompsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-600 hover:underline"
                >
                  View sold listings →
                </a>
              )}
            </div>
          </div>
        </div>

        {/* Right: tracking form */}
        <div className="rounded-xl border border-zinc-200 bg-white p-5 space-y-4 h-fit">
          <h2 className="text-sm font-semibold">Tracking</h2>
          {tracking?.purchasePrice != null && (
            <div className="rounded-lg bg-zinc-50 p-3 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-zinc-500">Paid</span>
                <span className="font-medium">{fmt(tracking.purchasePrice, "$")}</span>
              </div>
              {tracking.soldPrice != null && (
                <>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Sold for</span>
                    <span className="font-medium">{fmt(tracking.soldPrice, "$")}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Actual ROI</span>
                    <span className={`font-medium ${(tracking.actualRoi ?? 0) >= 0 ? "text-green-700" : "text-red-600"}`}>
                      {fmtPct(tracking.actualRoi)}
                    </span>
                  </div>
                </>
              )}
            </div>
          )}

          <form onSubmit={handleSave} className="space-y-3">
            <label className="block space-y-1">
              <span className="text-xs text-zinc-500">Purchase price ($)</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={purchasePrice}
                onChange={(e) => setPurchasePrice(e.target.value)}
                placeholder="0.00"
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-zinc-500">Sold price ($)</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={soldPrice}
                onChange={(e) => setSoldPrice(e.target.value)}
                placeholder="0.00"
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-zinc-500">Notes</span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400 resize-none"
              />
            </label>
            <button
              type="submit"
              disabled={saving}
              className="w-full rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save tracking"}
            </button>
            {saveMsg && <p className="text-center text-xs text-green-700">{saveMsg}</p>}
          </form>
        </div>
      </div>
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="font-medium">{value ?? "—"}</p>
    </div>
  );
}
