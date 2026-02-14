"use client";

import { useState, useEffect } from "react";
import { AdminBusinessForm } from "./AdminBusinessForm";

const MAIN_URL = process.env.NEXT_PUBLIC_MAIN_SITE_URL || "http://localhost:3000";
const ADMIN_CODE = process.env.NEXT_PUBLIC_ADMIN_CODE ?? "NWC36481";

interface Business {
  id: string;
  name: string;
  slug: string;
  city: string | null;
  categories: string[];
}

interface Sponsor {
  subscriptionId: string;
  memberId: string;
  email: string;
  firstName: string;
  lastName: string;
  businesses: Business[];
}

export default function AdminSponsorsPage() {
  const [sponsors, setSponsors] = useState<Sponsor[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingBusinessId, setEditingBusinessId] = useState<string | null>(null);
  const [editingBusiness, setEditingBusiness] = useState<Record<string, unknown> | null>(null);

  function refetch() {
    return fetch(`${MAIN_URL}/api/admin/sponsors`, {
      headers: { "x-admin-code": ADMIN_CODE },
    })
      .then((r) => r.json())
      .then((data) => setSponsors(Array.isArray(data) ? data : []))
      .catch(() => setSponsors([]));
  }

  useEffect(() => {
    refetch().finally(() => setLoading(false));
  }, []);

  const sponsorOptions = sponsors.map((s) => ({
    memberId: s.memberId,
    firstName: s.firstName,
    lastName: s.lastName,
    email: s.email,
    businessCount: s.businesses.length,
  }));

  const filtered = sponsors.filter((s) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const memberMatch =
      s.firstName.toLowerCase().includes(q) ||
      s.lastName.toLowerCase().includes(q) ||
      s.email.toLowerCase().includes(q);
    const businessMatch = s.businesses.some(
      (b) =>
        b.name.toLowerCase().includes(q) ||
        (b.city ?? "").toLowerCase().includes(q) ||
        b.categories.some((c) => c.toLowerCase().includes(q))
    );
    return memberMatch || businessMatch;
  });

  async function handleDelete(businessId: string) {
    if (!confirm("Delete this business? This cannot be undone.")) return;
    const res = await fetch(`${MAIN_URL}/api/admin/businesses/${businessId}`, {
      method: "DELETE",
      headers: { "x-admin-code": ADMIN_CODE },
    });
    if (res.ok) refetch();
  }

  async function openEdit(businessId: string) {
    setShowAddForm(false);
    const res = await fetch(`${MAIN_URL}/api/admin/businesses/${businessId}`, {
      headers: { "x-admin-code": ADMIN_CODE },
    });
    const data = await res.json().catch(() => null);
    if (data) {
      setEditingBusiness(data);
      setEditingBusinessId(businessId);
    }
  }

  function closeForm() {
    setShowAddForm(false);
    setEditingBusinessId(null);
    setEditingBusiness(null);
    refetch();
  }

  if (loading) return <p className="text-gray-500">Loading…</p>;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <h1 className="text-2xl font-bold">Sponsors</h1>
        <div className="flex items-center gap-4">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email, business…"
            className="w-full max-w-xs border rounded px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={() => {
              setEditingBusinessId(null);
              setEditingBusiness(null);
              setShowAddForm(true);
            }}
            disabled={sponsorOptions.filter((s) => s.businessCount < 2).length === 0}
            className="px-4 py-2 rounded disabled:opacity-50 disabled:cursor-not-allowed text-sm"
            style={{ backgroundColor: "#505542", color: "#fff" }}
          >
            Add business
          </button>
        </div>
      </div>

      {(showAddForm || editingBusinessId) && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={(e) => e.target === e.currentTarget && closeForm()}
        >
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b">
              <h2 className="text-lg font-semibold">
                {editingBusinessId ? "Edit business" : "Add business"}
              </h2>
            </div>
            {showAddForm && (
              <AdminBusinessForm sponsors={sponsorOptions} onClose={closeForm} />
            )}
            {editingBusinessId && editingBusiness && (
              <AdminBusinessForm
                sponsors={sponsorOptions}
                existing={editingBusiness as unknown as Parameters<typeof AdminBusinessForm>[0]["existing"]}
                onClose={closeForm}
              />
            )}
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Sponsor</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Business</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">City</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Categories</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {filtered.flatMap((s) =>
              s.businesses.length === 0 ? (
                <tr key={s.subscriptionId}>
                  <td className="px-4 py-2">
                    {s.firstName} {s.lastName}
                    <span className="text-gray-500 text-sm block">{s.email}</span>
                  </td>
                  <td className="px-4 py-2 text-gray-400">— No businesses —</td>
                  <td className="px-4 py-2">—</td>
                  <td className="px-4 py-2">—</td>
                  <td className="px-4 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => setShowAddForm(true)}
                      className="hover:underline text-sm"
                      style={{ color: "#505542" }}
                    >
                      Add
                    </button>
                  </td>
                </tr>
              ) : (
                s.businesses.map((b) => (
                  <tr key={b.id}>
                    <td className="px-4 py-2">
                      {s.firstName} {s.lastName}
                      <span className="text-gray-500 text-sm block">{s.email}</span>
                    </td>
                    <td className="px-4 py-2 font-medium">{b.name}</td>
                    <td className="px-4 py-2">{b.city ?? "—"}</td>
                    <td className="px-4 py-2 text-sm">{b.categories.join(", ") || "—"}</td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2 justify-end">
                        <button
                          type="button"
                          onClick={() => openEdit(b.id)}
                          className="hover:underline text-sm"
                          style={{ color: "#505542" }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(b.id)}
                          className="text-red-600 hover:underline text-sm"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )
            )}
          </tbody>
        </table>
      </div>

      {sponsors.length === 0 && (
        <p className="mt-4 text-gray-500">No sponsors yet. Members need an active sponsor subscription to appear here.</p>
      )}
    </div>
  );
}
