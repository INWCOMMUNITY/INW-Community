"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function OfferedCouponsClient({ initialCoupons }: { initialCoupons: any[] }) {
  const router = useRouter();
  const [coupons, setCoupons] = useState(initialCoupons);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function saveCoupon(id: string, patch: any) {
    setSavingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/coupons/${encodeURIComponent(id)}`, {
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

  async function deleteCoupon(id: string) {
    if (!confirm("Delete this coupon? This cannot be undone.")) return;
    setDeletingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/coupons/${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to delete");
      setCoupons((prev: any[]) => prev.filter((c) => c.id !== id));
      router.refresh();
    } catch (e: any) {
      setError(e?.message ?? "Failed to delete.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-red-600">{error}</p>}
      {coupons.length === 0 ? (
        <p className="text-gray-500">No coupons found.</p>
      ) : (
        <div className="overflow-x-auto border rounded-lg" style={{ borderColor: "var(--color-primary)" }}>
          <table className="w-full text-sm min-w-[840px]">
            <thead>
              <tr className="bg-[var(--color-section-alt)]">
                <th className="text-left p-3 font-semibold">Business</th>
                <th className="text-left p-3 font-semibold">Name</th>
                <th className="text-left p-3 font-semibold">Discount</th>
                <th className="text-left p-3 font-semibold">Code</th>
                <th className="text-left p-3 font-semibold">Max Monthly Uses</th>
                <th className="text-left p-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {coupons.map((c: any) => (
                <tr key={c.id} className="border-t border-gray-200 align-top">
                  <td className="p-3">{c.business?.name ?? "—"}</td>
                  <td className="p-3">
                    <input
                      className="w-full border rounded px-2 py-1"
                      defaultValue={c.name}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v && v !== c.name) {
                          setCoupons((prev: any[]) => prev.map((x) => (x.id === c.id ? { ...x, name: v } : x)));
                          saveCoupon(c.id, { name: v });
                        }
                      }}
                    />
                  </td>
                  <td className="p-3">
                    <input
                      className="w-40 border rounded px-2 py-1"
                      defaultValue={c.discount}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v && v !== c.discount) {
                          setCoupons((prev: any[]) => prev.map((x) => (x.id === c.id ? { ...x, discount: v } : x)));
                          saveCoupon(c.id, { discount: v });
                        }
                      }}
                    />
                  </td>
                  <td className="p-3">
                    <input
                      className="w-40 border rounded px-2 py-1"
                      defaultValue={c.code}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v && v !== c.code) {
                          setCoupons((prev: any[]) => prev.map((x) => (x.id === c.id ? { ...x, code: v } : x)));
                          saveCoupon(c.id, { code: v });
                        }
                      }}
                    />
                  </td>
                  <td className="p-3">
                    <input
                      type="number"
                      className="w-24 border rounded px-2 py-1"
                      defaultValue={c.maxMonthlyUses ?? 1}
                      min={1}
                      onBlur={(e) => {
                        const n = parseInt(e.target.value, 10);
                        if (!Number.isFinite(n) || n < 1) return;
                        if (n !== c.maxMonthlyUses) {
                          setCoupons((prev: any[]) =>
                            prev.map((x) => (x.id === c.id ? { ...x, maxMonthlyUses: n } : x))
                          );
                          saveCoupon(c.id, { maxMonthlyUses: n });
                        }
                      }}
                    />
                  </td>
                  <td className="p-3 whitespace-nowrap">
                    <button
                      type="button"
                      className="text-red-600 hover:underline font-medium disabled:opacity-50"
                      disabled={savingId === c.id || deletingId === c.id}
                      onClick={() => deleteCoupon(c.id)}
                    >
                      {deletingId === c.id ? "Deleting…" : "Delete"}
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

