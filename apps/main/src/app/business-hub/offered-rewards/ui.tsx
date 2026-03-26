"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function OfferedRewardsClient({ initialRewards }: { initialRewards: any[] }) {
  const router = useRouter();
  const [rewards, setRewards] = useState(initialRewards);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function saveReward(id: string, patch: any) {
    setSavingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/rewards/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error?.formErrors?.[0] ?? data.error ?? "Failed to save");
      router.refresh();
    } catch (e: any) {
      setError(e?.message ?? "Failed to save.");
    } finally {
      setSavingId(null);
    }
  }

  async function removeReward(id: string) {
    if (!confirm("Remove this reward? It will be set to inactive.")) return;
    setDeletingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/rewards/${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to remove");
      setRewards((prev: any[]) => prev.filter((r) => r.id !== id));
      router.refresh();
    } catch (e: any) {
      setError(e?.message ?? "Failed to remove.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-red-600">{error}</p>}
      {rewards.length === 0 ? (
        <p className="text-gray-500">No rewards found.</p>
      ) : (
        <div className="overflow-x-auto border rounded-lg" style={{ borderColor: "var(--color-primary)" }}>
          <table className="w-full text-sm min-w-[760px]">
            <thead>
              <tr className="bg-[var(--color-section-alt)]">
                <th className="text-left p-3 font-semibold">Business</th>
                <th className="text-left p-3 font-semibold">Title</th>
                <th className="text-left p-3 font-semibold">Points</th>
                <th className="text-left p-3 font-semibold">Limit</th>
                <th className="text-left p-3 font-semibold">Status</th>
                <th className="text-left p-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rewards.map((r: any) => (
                <tr key={r.id} className="border-t border-gray-200 align-top">
                  <td className="p-3">{r.business?.name ?? "—"}</td>
                  <td className="p-3">
                    <input
                      className="w-full border rounded px-2 py-1"
                      defaultValue={r.title}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v && v !== r.title) {
                          setRewards((prev: any[]) =>
                            prev.map((x) => (x.id === r.id ? { ...x, title: v } : x))
                          );
                          saveReward(r.id, { title: v });
                        }
                      }}
                    />
                  </td>
                  <td className="p-3">
                    <input
                      type="number"
                      className="w-24 border rounded px-2 py-1"
                      defaultValue={r.pointsRequired}
                      min={1}
                      onBlur={(e) => {
                        const n = parseInt(e.target.value, 10);
                        if (!Number.isFinite(n) || n < 1) return;
                        if (n !== r.pointsRequired) {
                          setRewards((prev: any[]) =>
                            prev.map((x) => (x.id === r.id ? { ...x, pointsRequired: n } : x))
                          );
                          saveReward(r.id, { pointsRequired: n });
                        }
                      }}
                    />
                  </td>
                  <td className="p-3">
                    <input
                      type="number"
                      className="w-24 border rounded px-2 py-1"
                      defaultValue={r.redemptionLimit}
                      min={1}
                      onBlur={(e) => {
                        const n = parseInt(e.target.value, 10);
                        if (!Number.isFinite(n) || n < 1) return;
                        if (n !== r.redemptionLimit) {
                          setRewards((prev: any[]) =>
                            prev.map((x) => (x.id === r.id ? { ...x, redemptionLimit: n } : x))
                          );
                          saveReward(r.id, { redemptionLimit: n });
                        }
                      }}
                    />
                  </td>
                  <td className="p-3">
                    <select
                      className="border rounded px-2 py-1"
                      defaultValue={r.status ?? "active"}
                      onChange={(e) => {
                        const v = e.target.value;
                        setRewards((prev: any[]) =>
                          prev.map((x) => (x.id === r.id ? { ...x, status: v } : x))
                        );
                        saveReward(r.id, { status: v });
                      }}
                    >
                      <option value="active">active</option>
                      <option value="inactive">inactive</option>
                    </select>
                  </td>
                  <td className="p-3 whitespace-nowrap">
                    <button
                      type="button"
                      className="text-red-600 hover:underline font-medium disabled:opacity-50"
                      disabled={savingId === r.id || deletingId === r.id}
                      onClick={() => removeReward(r.id)}
                    >
                      {deletingId === r.id ? "Removing…" : "Remove"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

