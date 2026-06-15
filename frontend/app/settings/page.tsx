"use client";

import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";

type Settings = {
  roi_threshold_min?: number;
  min_profit_dollars?: number;
  scraper_cities?: string[];
  [key: string]: unknown;
};

type FmStatusRow = {
  city: string;
  lastScrapedAt: Date | null;
  status: string;
  listingsFound: number;
  errorMsg: string | null;
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  // FM scrape status
  const [fmStatus, setFmStatus] = useState<FmStatusRow[]>([]);
  const [fmLoading, setFmLoading] = useState(true);
  const [fmScraping, setFmScraping] = useState<Record<string, boolean>>({});

  // Form state
  const [roiThreshold, setRoiThreshold] = useState("");
  const [minProfit, setMinProfit] = useState("");
  const [cities, setCities] = useState("");

  useEffect(() => {
    trpc.settings.get.query()
      .then((s) => {
        const data = s as Settings;
        setSettings(data);
        if (data.roi_threshold_min != null) setRoiThreshold(String(data.roi_threshold_min));
        if (data.min_profit_dollars != null) setMinProfit(String(data.min_profit_dollars));
        if (Array.isArray(data.scraper_cities)) setCities(data.scraper_cities.join(", "));
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  async function loadFmStatus() {
    setFmLoading(true);
    try {
      const rows = await trpc.fm.scrapeStatus.query();
      setFmStatus(rows as FmStatusRow[]);
    } catch (e) {
      console.error("Failed to load FM status:", e);
    } finally {
      setFmLoading(false);
    }
  }

  useEffect(() => {
    loadFmStatus();
  }, []);

  async function handleFmScrape(city: string) {
    setFmScraping((prev) => ({ ...prev, [city]: true }));
    try {
      await trpc.fm.triggerScrape.mutate({ city });
      await loadFmStatus();
    } catch (e) {
      console.error("FM scrape failed:", e);
    } finally {
      setFmScraping((prev) => ({ ...prev, [city]: false }));
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveMsg("");
    try {
      const payload: Record<string, unknown> = {};
      if (roiThreshold) payload.roi_threshold_min = Number(roiThreshold);
      if (minProfit) payload.min_profit_dollars = Number(minProfit);
      const citiesArr = cities
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean);
      if (citiesArr.length) payload.scraper_cities = citiesArr;

      await trpc.settings.update.mutate(payload);
      setSaveMsg("Saved");
      setTimeout(() => setSaveMsg(""), 2500);
    } catch (e) {
      setSaveMsg("Error saving");
      console.error(e);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-sm text-zinc-400">Loading…</p>;

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">Settings</h1>

      <form onSubmit={handleSave} className="max-w-lg space-y-6">
        {/* Scoring */}
        <section className="rounded-xl border border-zinc-200 bg-white p-5 space-y-4">
          <h2 className="text-sm font-semibold">Deal Scoring</h2>

          <label className="block space-y-1">
            <span className="text-xs text-zinc-500">ROI threshold — min % to flag as High ROI (default: 40)</span>
            <input
              type="number"
              min="0"
              max="999"
              value={roiThreshold}
              onChange={(e) => setRoiThreshold(e.target.value)}
              placeholder="40"
              className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs text-zinc-500">Min net profit ($) to flag as High ROI (default: 25)</span>
            <input
              type="number"
              min="0"
              value={minProfit}
              onChange={(e) => setMinProfit(e.target.value)}
              placeholder="25"
              className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400"
            />
          </label>
        </section>

        {/* Scraper */}
        <section className="rounded-xl border border-zinc-200 bg-white p-5 space-y-4">
          <h2 className="text-sm font-semibold">Scraper</h2>

          <label className="block space-y-1">
            <span className="text-xs text-zinc-500">Cities to scrape — comma-separated (e.g. Denver, Boulder, Aurora)</span>
            <input
              type="text"
              value={cities}
              onChange={(e) => setCities(e.target.value)}
              placeholder="Denver, Boulder"
              className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400"
            />
          </label>
        </section>

        {/* Save */}
        <div className="flex items-center gap-4">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-zinc-900 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save settings"}
          </button>
          {saveMsg && (
            <span className={`text-sm ${saveMsg === "Saved" ? "text-green-700" : "text-red-600"}`}>
              {saveMsg}
            </span>
          )}
        </div>
      </form>

      {/* Raw dump for debug */}
      {Object.keys(settings).length > 0 && (
        <details className="text-xs text-zinc-400">
          <summary className="cursor-pointer select-none">Raw settings ({Object.keys(settings).length} keys)</summary>
          <pre className="mt-2 overflow-auto rounded-lg bg-zinc-50 p-3 text-xs">{JSON.stringify(settings, null, 2)}</pre>
        </details>
      )}

      {/* FM Scrape Status */}
      <section className="max-w-lg rounded-xl border border-zinc-200 bg-white p-5 space-y-4">
        <h2 className="text-sm font-semibold">FM Scrape Status</h2>
        {fmLoading ? (
          <p className="text-sm text-zinc-400">Loading…</p>
        ) : fmStatus.length === 0 ? (
          <p className="text-sm text-zinc-400">No Facebook Marketplace scrape jobs found.</p>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-100 text-left text-zinc-500">
                  <th className="pb-2 pr-4 font-medium">City</th>
                  <th className="pb-2 pr-4 font-medium">Status</th>
                  <th className="pb-2 pr-4 font-medium">Last Scraped</th>
                  <th className="pb-2 pr-4 font-medium">Listings Found</th>
                  <th className="pb-2 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {fmStatus.map((row) => (
                  <tr key={row.city} className="border-b border-zinc-50 last:border-0">
                    <td className="py-2 pr-4 font-medium text-zinc-800">{row.city}</td>
                    <td className="py-2 pr-4">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          row.status === "ok"
                            ? "bg-green-100 text-green-800"
                            : row.status === "error"
                            ? "bg-red-100 text-red-800"
                            : "bg-yellow-100 text-yellow-800"
                        }`}
                      >
                        {row.status}
                      </span>
                      {row.status === "error" && row.errorMsg && (
                        <p className="mt-1 text-red-600">{row.errorMsg}</p>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-zinc-500">
                      {row.lastScrapedAt
                        ? new Date(row.lastScrapedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
                        : "Never"}
                    </td>
                    <td className="py-2 pr-4 text-zinc-700">{row.listingsFound}</td>
                    <td className="py-2">
                      <button
                        onClick={() => handleFmScrape(row.city)}
                        disabled={!!fmScraping[row.city]}
                        className="rounded-lg bg-zinc-900 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50"
                      >
                        {fmScraping[row.city] ? "Scraping…" : "Scrape Now"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
