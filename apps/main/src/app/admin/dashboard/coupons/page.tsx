"use client";

import { useState, useEffect } from "react";
import { AdminCouponActions } from "./AdminCouponActions";

interface Coupon {
  id: string;
  name: string;
  discount: string;
  code: string;
  business?: { name: string } | null;
  _count: { redemptions: number };
}

export default function AdminCouponsPage() {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch("/api/admin/coupons")
      .then((r) => r.json())
      .then((data) => setCoupons(Array.isArray(data) ? data : []))
      .catch(() => setCoupons([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = coupons.filter((c) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      c.discount.toLowerCase().includes(q) ||
      c.code.toLowerCase().includes(q) ||
      (c.business?.name ?? "").toLowerCase().includes(q)
    );
  });

  if (loading) return <p className="text-gray-500">Loading…</p>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Coupons</h1>
      <div className="mb-4">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, discount, code, or business…"
          className="w-full max-w-md border rounded px-3 py-2 text-sm"
        />
      </div>
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Discount</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Business</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Usage</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {filtered.map((c) => (
              <tr key={c.id}>
                <td className="px-4 py-2 font-medium">{c.name}</td>
                <td className="px-4 py-2">{c.discount}</td>
                <td className="px-4 py-2">{c.business?.name ?? "—"}</td>
                <td className="px-4 py-2">{c._count?.redemptions ?? 0}</td>
                <td className="px-4 py-2 text-right">
                  <AdminCouponActions couponId={c.id} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
