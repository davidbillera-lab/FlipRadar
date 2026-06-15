"use client";

import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";

type Settings = {
  roi_threshold_min?: number;
  min_profit_dollars?: number;
  scraper_cities?: string[];
  [key: string]: unknown;
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

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
    </div>
  );
}
