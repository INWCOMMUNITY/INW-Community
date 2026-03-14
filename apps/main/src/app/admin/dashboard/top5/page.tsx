"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface Prize {
  rank: number;
  label: string;
  imageUrl: string | null;
  businessId: string | null;
  prizeValue: string | null;
  description: string | null;
}

interface Business {
  id: string;
  name: string;
  slug: string;
}

// Add more seasons when ready (e.g. "Season 2"); backend still uses start/end dates for the selected season.
const SEASON_OPTIONS = ["Season 1"] as const;

export default function Top5AdminPage() {
  const router = useRouter();
  const [enabled, setEnabled] = useState(false);
  const [season, setSeason] = useState<string>(SEASON_OPTIONS[0]);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [prizes, setPrizes] = useState<Prize[]>(
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((rank) => ({
      rank,
      label: "",
      imageUrl: null,
      businessId: null,
      prizeValue: null,
      description: null,
    }))
  );
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [uploadingRank, setUploadingRank] = useState<number | null>(null);

  async function uploadPrizePhoto(rank: number, file: File): Promise<string> {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch("/api/admin/upload", { method: "POST", body: formData });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? "Upload failed");
    if (typeof data.url !== "string") throw new Error("No URL returned");
    return data.url;
  }

  useEffect(() => {
    Promise.all([
      fetch("/api/admin/top5"),
      fetch("/api/admin/businesses"),
    ])
      .then(async ([top5Res, bizRes]) => {
        const top5 = await top5Res.json();
        const bizList = await bizRes.json();
        if (Array.isArray(bizList)) setBusinesses(bizList);
        if (top5.enabled !== undefined) setEnabled(top5.enabled);
        if (top5.startDate) setStartDate(top5.startDate);
        if (top5.endDate) setEndDate(top5.endDate);
        if (Array.isArray(top5.prizes) && top5.prizes.length >= 1) {
          setPrizes(
            [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((rank) => {
              const p = top5.prizes.find((x: Prize) => x.rank === rank);
              return p
                ? { ...p, prizeValue: p.prizeValue ?? null, description: p.description ?? null }
                : { rank, label: "", imageUrl: null, businessId: null, prizeValue: null, description: null };
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
      const res = await fetch("/api/admin/top5", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
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
      <h1 className="text-2xl font-bold mb-6">NWC Top 10 Prizes</h1>
      <p className="text-gray-600 mb-6">
        Control the NWC Top 10 competition. When enabled, the top 10 point-earners win these prizes at the end of the period. Leave slots blank if no prize.
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
            <span className="font-medium">Enable NWC Top 10 Prizes</span>
          </label>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Season</label>
            <select
              value={season}
              onChange={(e) => setSeason(e.target.value)}
              className="w-full max-w-xs border rounded px-3 py-2"
            >
              {SEASON_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Season start date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full border rounded px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Season end date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full border rounded px-3 py-2"
              />
            </div>
          </div>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-4">Prizes (Top 10)</h2>
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
                    <label className="block text-sm font-medium mb-1">Photo</label>
                    <div className="flex items-center gap-3 flex-wrap">
                      {prize.imageUrl && (
                        <img
                          src={prize.imageUrl}
                          alt=""
                          className="h-16 w-16 object-cover rounded border border-gray-200"
                        />
                      )}
                      <label className="inline-flex items-center gap-2">
                        <span
                          className="inline-block px-3 py-2 border rounded text-sm cursor-pointer hover:bg-gray-100 disabled:opacity-50"
                          style={{ borderColor: "#e5e3df" }}
                        >
                          {uploadingRank === prize.rank ? "Uploading…" : prize.imageUrl ? "Change photo" : "Upload photo"}
                        </span>
                        <input
                          type="file"
                          accept="image/*"
                          className="sr-only"
                          disabled={uploadingRank !== null}
                          onChange={async (e) => {
                            const f = e.target.files?.[0];
                            if (!f) return;
                            setUploadingRank(prize.rank);
                            setError("");
                            try {
                              const url = await uploadPrizePhoto(prize.rank, f);
                              updatePrize(prize.rank, "imageUrl", url);
                            } catch (err) {
                              setError(err instanceof Error ? err.message : "Upload failed");
                            } finally {
                              setUploadingRank(null);
                              e.target.value = "";
                            }
                          }}
                        />
                      </label>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Prize Value</label>
                    <input
                      type="text"
                      value={prize.prizeValue ?? ""}
                      onChange={(e) => updatePrize(prize.rank, "prizeValue", e.target.value || null)}
                      placeholder="e.g. $50"
                      className="w-full border rounded px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Description</label>
                    <input
                      type="text"
                      value={prize.description ?? ""}
                      onChange={(e) => updatePrize(prize.rank, "description", e.target.value || null)}
                      placeholder="Optional extra details"
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
