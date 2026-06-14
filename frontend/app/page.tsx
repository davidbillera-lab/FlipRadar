"use client";

import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { CompBadge } from "@/components/CompBadge";

type DealRow = {
  deal: {
    id: number;
    uuid: string;
    title: string;
    askingPrice: number | null;
    category: string | null;
    platform: string | null;
    imageUrl: string | null;
    listingUrl: string | null;
    flaggedHighRoi: number | null;
    city: string | null;
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
} | null;

type Stats = {
  totalDeals: number;
  avgScore: number | null;
  highRoiDeals: number;
  totalProjectedProfit: number | null;
};

const CATEGORIES = ["all", "electronics", "antiques", "collectibles", "power_tools"] as const;

function fmt(n: number | null | undefined, prefix = "") {
  if (n == null) return "—";
  return `${prefix}${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function ScorePill({ score }: { score: number | null }) {
  if (score == null) return <span className="text-xs text-zinc-400">—</span>;
  const color =
    score >= 70 ? "bg-green-100 text-green-800" :
    score >= 40 ? "bg-yellow-100 text-yellow-800" :
    "bg-red-100 text-red-800";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>
      {score}
    </span>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [deals, setDeals] = useState<DealRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<string>("all");
  const [highRoiOnly, setHighRoiOnly] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [s, d] = await Promise.all([
          trpc.stats.summary.query(),
          trpc.deals.list.query({ limit: 50 }),
        ]);
        setStats(s as unknown as Stats);
        setDeals((d.rows as unknown as DealRow[]).filter(Boolean));
      } catch (e) {
        console.error("Failed to load dashboard:", e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const filtered = deals.filter((row) => {
    if (!row) return false;
    if (category !== "all" && row.deal.category !== category) return false;
    if (highRoiOnly && !row.deal.flaggedHighRoi) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Stats row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total Deals" value={loading ? "…" : String(stats?.totalDeals ?? 0)} />
        <StatCard label="Avg Score" value={loading ? "…" : fmt(stats?.avgScore)} />
        <StatCard label="High ROI" value={loading ? "…" : String(stats?.highRoiDeals ?? 0)} />
        <StatCard label="Projected Profit" value={loading ? "…" : fmt(stats?.totalProjectedProfit, "$")} />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setCategory(cat)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              category === cat
                ? "bg-zinc-900 text-white"
                : "bg-white border border-zinc-200 text-zinc-600 hover:border-zinc-400"
            }`}
          >
            {cat === "all" ? "All" : cat.replace(/_/g, " ")}
          </button>
        ))}
        <button
          onClick={() => setHighRoiOnly((v) => !v)}
          className={`ml-2 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            highRoiOnly
              ? "bg-green-700 text-white"
              : "bg-white border border-zinc-200 text-zinc-600 hover:border-zinc-400"
          }`}
        >
          High ROI only
        </button>
        <span className="ml-auto text-xs text-zinc-400">{filtered.length} deals</span>
      </div>

      {/* Deal cards */}
      {loading ? (
        <p className="text-sm text-zinc-400">Loading deals…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-zinc-400">No deals match the current filter.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((row) => row && <DealCard key={row.deal.uuid} row={row} />)}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-0.5 text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function DealCard({ row }: { row: NonNullable<DealRow> }) {
  const { deal, score, valuation } = row;
  return (
    <a
      href={`/deal/${deal.id}`}
      className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-4 transition-shadow hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="line-clamp-2 text-sm font-medium leading-snug">{deal.title ?? "Untitled"}</p>
        <ScorePill score={score.score} />
      </div>

      <div className="flex items-center gap-3 text-xs text-zinc-500">
        <span>{deal.platform ?? "unknown"}</span>
        {deal.city && <span>· {deal.city}</span>}
        {score.exitChannel && <span>· {score.exitChannel}</span>}
      </div>

      <div className="flex items-center justify-between text-xs">
        <span className="text-zinc-500">
          Ask <span className="font-medium text-zinc-800">{fmt(deal.askingPrice, "$")}</span>
          {score.netProfit != null && (
            <span className={`ml-2 font-medium ${score.netProfit >= 0 ? "text-green-700" : "text-red-600"}`}>
              {score.netProfit >= 0 ? "+" : ""}{fmt(score.netProfit, "$")} net
            </span>
          )}
        </span>
        <CompBadge count={valuation.ebayCompCount ?? 0} />
      </div>
    </a>
  );
}
