"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

const ADMIN_CODE = process.env.NEXT_PUBLIC_ADMIN_CODE ?? "NWC36481";
const MAIN_URL = process.env.NEXT_PUBLIC_MAIN_SITE_URL || "http://localhost:3000";

interface Prize {
  rank: number;
  label: string;
  imageUrl: string | null;
  businessId: string | null;
}

interface Business {
  id: string;
  name: string;
  slug: string;
}

export default function Top5AdminPage() {
  const router = useRouter();
  const [enabled, setEnabled] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [prizes, setPrizes] = useState<Prize[]>([
    { rank: 1, label: "", imageUrl: null, businessId: null },
    { rank: 2, label: "", imageUrl: null, businessId: null },
    { rank: 3, label: "", imageUrl: null, businessId: null },
    { rank: 4, label: "", imageUrl: null, businessId: null },
    { rank: 5, label: "", imageUrl: null, businessId: null },
  ]);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      fetch(`${MAIN_URL}/api/admin/top5`, { headers: { "x-admin-code": ADMIN_CODE } }),
      fetch(`${MAIN_URL}/api/admin/businesses`, { headers: { "x-admin-code": ADMIN_CODE } }),
    ])
      .then(async ([top5Res, bizRes]) => {
        const top5 = await top5Res.json();
        const bizList = await bizRes.json();
        if (Array.isArray(bizList)) setBusinesses(bizList);
        if (top5.enabled !== undefined) setEnabled(top5.enabled);
        if (top5.startDate) setStartDate(top5.startDate);
        if (top5.endDate) setEndDate(top5.endDate);
        if (Array.isArray(top5.prizes) && top5.prizes.length >= 5) {
          setPrizes(
            [1, 2, 3, 4, 5].map((rank) => {
              const p = top5.prizes.find((x: Prize) => x.rank === rank);
              return p ?? { rank, label: "", imageUrl: null, businessId: null };
            })
          );
        }
      })
      .catch(() => setError("Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setError("");
    setSaving(true);
    try {
      const res = await fetch(`${MAIN_URL}/api/admin/top5`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-admin-code": ADMIN_CODE },
        body: JSON.stringify({
          enabled,
          startDate: startDate || undefined,
          endDate: endDate || undefined,
          prizes,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Failed to save");
        return;
      }
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  function updatePrize(rank: number, field: keyof Prize, value: string | null) {
    setPrizes((prev) =>
      prev.map((p) => (p.rank === rank ? { ...p, [field]: value } : p))
    );
  }

  if (loading) return <p className="text-gray-500">Loading…</p>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Top 5 Supporters&apos; Rewards</h1>
      <p className="text-gray-600 mb-6">
        Control the Top 5 Supporters competition. When enabled, the top 5 point-earners win these prizes at the end of the period.
      </p>

      <div className="space-y-6 max-w-2xl">
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="rounded"
            />
            <span className="font-medium">Enable Top 5 Supporters competition</span>
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Start date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full border rounded px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">End date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full border rounded px-3 py-2"
            />
          </div>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-4">Prizes (Top 5)</h2>
          <div className="space-y-4">
            {prizes.map((prize) => (
              <div key={prize.rank} className="border rounded-lg p-4 bg-gray-50">
                <h3 className="font-medium mb-3">#{prize.rank} Prize</h3>
                <div className="space-y-2">
                  <div>
                    <label className="block text-sm font-medium mb-1">Label</label>
                    <input
                      type="text"
                      value={prize.label}
                      onChange={(e) => updatePrize(prize.rank, "label", e.target.value)}
                      placeholder="e.g. $50 gift card"
                      className="w-full border rounded px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Photo URL</label>
                    <input
                      type="url"
                      value={prize.imageUrl ?? ""}
                      onChange={(e) => updatePrize(prize.rank, "imageUrl", e.target.value || null)}
                      placeholder="https://..."
                      className="w-full border rounded px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Business (tag)</label>
                    <select
                      value={prize.businessId ?? ""}
                      onChange={(e) => updatePrize(prize.rank, "businessId", e.target.value || null)}
                      className="w-full border rounded px-3 py-2"
                    >
                      <option value="">— None —</option>
                      {businesses.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {error && <p className="text-red-600 text-sm">{error}</p>}
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
    </div>
  );
}
