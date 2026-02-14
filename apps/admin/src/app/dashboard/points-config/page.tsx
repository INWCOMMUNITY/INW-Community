"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

const ADMIN_CODE = process.env.NEXT_PUBLIC_ADMIN_CODE ?? "NWC36481";
const MAIN_URL = process.env.NEXT_PUBLIC_MAIN_SITE_URL || "http://localhost:3000";

interface Config {
  category: string;
  pointsPerScan: number;
}

interface TopEarner {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  points: number;
}

export default function PointsConfigPage() {
  const router = useRouter();
  const [configs, setConfigs] = useState<Config[]>([]);
  const [missingCategories, setMissingCategories] = useState<string[]>([]);
  const [defaultPoints, setDefaultPoints] = useState(5);
  const [topEarners, setTopEarners] = useState<TopEarner[]>([]);
  const [newCategory, setNewCategory] = useState("");
  const [newPoints, setNewPoints] = useState("5");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`${MAIN_URL}/api/admin/points-config`, {
      headers: { "x-admin-code": ADMIN_CODE },
    })
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.configs)) setConfigs(data.configs);
        if (Array.isArray(data.missingCategories)) setMissingCategories(data.missingCategories);
        if (typeof data.defaultPoints === "number") setDefaultPoints(data.defaultPoints);
        if (Array.isArray(data.topEarners)) setTopEarners(data.topEarners);
      })
      .catch(() => setError("Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  const allCategories = [
    ...configs.map((c) => c.category),
    ...missingCategories.filter((c) => !configs.some((cfg) => cfg.category === c)),
  ];
  const uniqueCategories = Array.from(new Set(allCategories)).sort();

  async function handleSave() {
    setError("");
    setSaving(true);
    try {
      const configsToSave = uniqueCategories.map((cat) => {
        const existing = configs.find((c) => c.category === cat);
        return {
          category: cat,
          pointsPerScan: existing?.pointsPerScan ?? defaultPoints,
        };
      });
      const res = await fetch(`${MAIN_URL}/api/admin/points-config`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-admin-code": ADMIN_CODE,
        },
        body: JSON.stringify({ configs: configsToSave }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(String(data.error?.message ?? data.error ?? "Failed to save"));
        return;
      }
      router.refresh();
      setConfigs(configsToSave);
    } finally {
      setSaving(false);
    }
  }

  function updatePoints(category: string, points: number) {
    setConfigs((prev) => {
      const existing = prev.find((c) => c.category === category);
      if (existing) {
        return prev.map((c) => (c.category === category ? { ...c, pointsPerScan: points } : c));
      }
      return [...prev, { category, pointsPerScan: points }];
    });
  }

  function addCategory() {
    const cat = newCategory.trim();
    const pts = parseInt(newPoints, 10) || defaultPoints;
    if (!cat) return;
    if (configs.some((c) => c.category === cat)) return;
    setConfigs((prev) => [...prev, { category: cat, pointsPerScan: pts }].sort((a, b) => a.category.localeCompare(b.category)));
    setNewCategory("");
    setNewPoints(String(defaultPoints));
  }

  if (loading) return <p className="text-gray-500">Loading…</p>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Points per Category (QR Scans)</h1>
      <p className="text-gray-600 mb-6">
        Set how many Community Points members earn when they scan a business&apos;s QR code. Points are awarded once per member per business per day.
      </p>

      <div className="space-y-4 max-w-2xl mb-8">
        {uniqueCategories.length === 0 ? (
          <p className="text-gray-500">No categories yet. Add categories from businesses or add manually below.</p>
        ) : (
          uniqueCategories.map((cat) => {
            const cfg = configs.find((c) => c.category === cat);
            const pts = cfg?.pointsPerScan ?? defaultPoints;
            return (
              <div key={cat} className="flex items-center gap-4 border rounded-lg p-4 bg-gray-50">
                <span className="font-medium flex-1">{cat}</span>
                <input
                  type="number"
                  min={0}
                  value={pts}
                  onChange={(e) => updatePoints(cat, parseInt(e.target.value, 10) || 0)}
                  className="w-24 border rounded px-3 py-2"
                />
                <span className="text-sm text-gray-500">points per scan</span>
              </div>
            );
          })
        )}
      </div>

      <div className="border rounded-lg p-4 bg-gray-50 mb-8 max-w-2xl">
        <h2 className="font-semibold mb-2">Add category</h2>
        <div className="flex gap-2">
          <input
            type="text"
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            placeholder="Category name"
            className="border rounded px-3 py-2 flex-1"
          />
          <input
            type="number"
            min={0}
            value={newPoints}
            onChange={(e) => setNewPoints(e.target.value)}
            className="w-20 border rounded px-3 py-2"
          />
          <button type="button" onClick={addCategory} className="rounded px-4 py-2" style={{ backgroundColor: "#505542", color: "#fff" }}>
            Add
          </button>
        </div>
      </div>

      <p className="text-sm text-gray-500 mb-4">
        Default for unlisted categories: {defaultPoints} points
      </p>

      {/* Top 20 Earners */}
      <div className="mt-8 mb-8">
        <h2 className="text-lg font-bold mb-4">Top 20 Points Earners</h2>
        {topEarners.length === 0 ? (
          <p className="text-gray-500 text-sm">No members with points yet.</p>
        ) : (
          <div className="bg-white rounded-lg shadow overflow-hidden max-w-2xl">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Rank</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Points</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {topEarners.map((m, i) => (
                  <tr key={m.id}>
                    <td className="px-4 py-2 text-sm">{i + 1}</td>
                    <td className="px-4 py-2 font-medium">{m.firstName} {m.lastName}</td>
                    <td className="px-4 py-2 text-sm text-gray-600">{m.email}</td>
                    <td className="px-4 py-2 text-right font-medium">{m.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Placeholder sections for coupons/events */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl mb-8">
        <div className="bg-white rounded-lg shadow p-4 border-l-4" style={{ borderColor: "#FDEDCC" }}>
          <h3 className="font-semibold mb-1">Coupon Points</h3>
          <p className="text-sm text-gray-500">Points for coupon redemptions – coming soon.</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4 border-l-4" style={{ borderColor: "#FDEDCC" }}>
          <h3 className="font-semibold mb-1">Event Points</h3>
          <p className="text-sm text-gray-500">Points for event attendance – coming soon.</p>
        </div>
      </div>

      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="rounded px-4 py-2 disabled:opacity-50"
        style={{ backgroundColor: "#505542", color: "#fff" }}
      >
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}
