"use client";

import { useState, useEffect } from "react";

const ADMIN_CODE = process.env.NEXT_PUBLIC_ADMIN_CODE ?? "NWC36481";
const MAIN_URL = process.env.NEXT_PUBLIC_MAIN_SITE_URL || "http://localhost:3000";

interface SeasonOption {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
}

interface RewardRow {
  id: string;
  title: string;
  pointsRequired: number;
  redemptionLimit: number;
  timesRedeemed: number;
  status: string;
  seasonId: string | null;
  season: { id: string; name: string; startDate: string; endDate: string } | null;
  business: { id: string; name: string; slug: string };
}

export default function AdminRewardsPage() {
  const [rewards, setRewards] = useState<RewardRow[]>([]);
  const [seasons, setSeasons] = useState<SeasonOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const headers = { "x-admin-code": ADMIN_CODE };

  const loadRewards = () => {
    fetch(`${MAIN_URL}/api/admin/rewards`, { headers })
      .then((r) => r.json())
      .then((data) => (Array.isArray(data) ? setRewards(data) : setRewards([])))
      .catch(() => setRewards([]));
  };

  const loadSeasons = () => {
    fetch(`${MAIN_URL}/api/admin/seasons`, { headers })
      .then((r) => r.json())
      .then((data) => (Array.isArray(data) ? setSeasons(data) : setSeasons([])))
      .catch(() => setSeasons([]));
  };

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch(`${MAIN_URL}/api/admin/rewards`, { headers }).then((r) => r.json()),
      fetch(`${MAIN_URL}/api/admin/seasons`, { headers }).then((r) => r.json()),
    ])
      .then(([rewardsData, seasonsData]) => {
        setRewards(Array.isArray(rewardsData) ? rewardsData : []);
        setSeasons(Array.isArray(seasonsData) ? seasonsData : []);
      })
      .catch(() => setError("Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  async function handleSeasonChange(rewardId: string, seasonId: string | null) {
    setError("");
    setSavingId(rewardId);
    try {
      const res = await fetch(`${MAIN_URL}/api/admin/rewards/${rewardId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ seasonId: seasonId || null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to update");
        return;
      }
      loadRewards();
    } finally {
      setSavingId(null);
    }
  }

  const filtered = rewards.filter((r) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      r.title.toLowerCase().includes(q) ||
      (r.business?.name ?? "").toLowerCase().includes(q) ||
      (r.season?.name ?? "").toLowerCase().includes(q)
    );
  });

  if (loading) return <p className="text-gray-500">Loading…</p>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Rewards &amp; Seasons</h1>
      <p className="text-gray-600 mb-6">
        Assign rewards to a season so they only appear on the site when that season is active (start date ≤ today ≤ end date).
        Rewards with &quot;All seasons&quot; always show. Plan ahead by creating seasons and assigning rewards before the season starts.
      </p>
      <div className="mb-4">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by title, business, or season…"
          className="w-full max-w-md border rounded px-3 py-2 text-sm"
        />
      </div>
      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
      <div className="bg-white rounded-lg border overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Reward</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Business</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Points</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Season</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Usage</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-500">
                  No rewards found.
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2 font-medium">{r.title}</td>
                  <td className="px-4 py-2">{r.business?.name ?? "—"}</td>
                  <td className="px-4 py-2">{r.pointsRequired} pts</td>
                  <td className="px-4 py-2">
                    <select
                      value={r.seasonId ?? ""}
                      onChange={(e) => handleSeasonChange(r.id, e.target.value || null)}
                      disabled={savingId === r.id}
                      className="border rounded px-2 py-1 text-sm min-w-[140px]"
                    >
                      <option value="">All seasons</option>
                      {seasons.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({s.startDate} – {s.endDate})
                        </option>
                      ))}
                    </select>
                    {savingId === r.id && (
                      <span className="ml-2 text-xs text-gray-500">Saving…</span>
                    )}
                  </td>
                  <td className="px-4 py-2">{r.timesRedeemed} / {r.redemptionLimit}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
