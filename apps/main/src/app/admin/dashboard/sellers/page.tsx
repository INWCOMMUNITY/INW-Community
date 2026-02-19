"use client";

import { useState, useEffect } from "react";

interface StoreItem {
  id: string;
  title: string;
  priceCents: number;
  quantity: number;
  status: string;
}

interface Seller {
  subscriptionId: string;
  memberId: string;
  email: string;
  firstName: string;
  lastName: string;
  storeItems: StoreItem[];
  salesCents: number;
  shippingCents: number;
  orderCount: number;
}

export default function AdminSellersPage() {
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);

  function refetch() {
    return fetch("/api/admin/sellers")
      .then((r) => r.json())
      .then((data) => setSellers(Array.isArray(data) ? data : []))
      .catch(() => setSellers([]));
  }

  useEffect(() => {
    refetch().finally(() => setLoading(false));
  }, []);

  const filtered = sellers.filter((s) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      s.firstName.toLowerCase().includes(q) ||
      s.lastName.toLowerCase().includes(q) ||
      s.email.toLowerCase().includes(q) ||
      s.storeItems.some((i) => i.title.toLowerCase().includes(q))
    );
  });

  async function handleDeleteItem(itemId: string) {
    if (!confirm("Delete this store item? This cannot be undone.")) return;
    setDeleting(itemId);
    try {
      const res = await fetch(`/api/admin/store-items/${itemId}`, {
        method: "DELETE",
      });
      if (res.ok) refetch();
    } finally {
      setDeleting(null);
    }
  }

  if (loading) return <p className="text-gray-500">Loading…</p>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Sellers</h1>
      <div className="mb-4">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, email, or item…"
          className="w-full max-w-md border rounded px-3 py-2 text-sm"
        />
      </div>
      <div className="space-y-6">
        {filtered.map((s) => (
          <div key={s.subscriptionId} className="bg-white rounded-lg shadow p-4">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
              <div>
                <h2 className="font-semibold text-lg">
                  {s.firstName} {s.lastName}
                </h2>
                <p className="text-sm text-gray-600">{s.email}</p>
              </div>
              <div className="flex gap-6 text-sm">
                <span>
                  <strong>Sales:</strong> ${(s.salesCents / 100).toFixed(2)}
                </span>
                <span>
                  <strong>Shipping:</strong> ${(s.shippingCents / 100).toFixed(2)}
                </span>
                <span>
                  <strong>Orders:</strong> {s.orderCount}
                </span>
              </div>
            </div>
            {s.storeItems.length === 0 ? (
              <p className="text-gray-500 text-sm">No store items</p>
            ) : (
              <table className="min-w-full divide-y divide-gray-200">
                <thead>
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Item</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Price</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Qty</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {s.storeItems.map((item) => (
                    <tr key={item.id}>
                      <td className="px-4 py-2 font-medium">{item.title}</td>
                      <td className="px-4 py-2">${(item.priceCents / 100).toFixed(2)}</td>
                      <td className="px-4 py-2">{item.quantity}</td>
                      <td className="px-4 py-2">{item.status}</td>
                      <td className="px-4 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => handleDeleteItem(item.id)}
                          disabled={deleting === item.id}
                          className="text-red-600 hover:underline text-sm disabled:opacity-50"
                        >
                          {deleting === item.id ? "…" : "Delete"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ))}
      </div>
      {sellers.length === 0 && (
        <p className="text-gray-500 mt-4">No sellers yet. Members need an active seller subscription to appear here.</p>
      )}
    </div>
  );
}
