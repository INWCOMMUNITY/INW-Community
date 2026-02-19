"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface Business {
  id: string;
  name: string;
  slug: string;
  memberId: string;
  nameApprovalStatus: string;
}

export default function AdminBusinessesPage() {
  const router = useRouter();
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/businesses")
      .then((r) => r.json())
      .then((data) => setBusinesses(Array.isArray(data) ? data : []))
      .catch(() => setBusinesses([]))
      .finally(() => setLoading(false));
  }, []);

  async function handleDelete(businessId: string) {
    if (!confirm("Delete this business? This cannot be undone.")) return;
    setDeleting(businessId);
    try {
      const res = await fetch(`/api/admin/businesses/${businessId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setBusinesses((prev) => prev.filter((b) => b.id !== businessId));
        router.refresh();
      }
    } finally {
      setDeleting(null);
    }
  }

  if (loading) return <p className="text-gray-500">Loading…</p>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Businesses</h1>
      {businesses.length === 0 ? (
        <p className="text-gray-500">No businesses yet.</p>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Slug</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {businesses.map((b) => (
                <tr key={b.id}>
                  <td className="px-4 py-2 font-medium">{b.name}</td>
                  <td className="px-4 py-2 text-sm text-gray-600">{b.slug}</td>
                  <td className="px-4 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => handleDelete(b.id)}
                      disabled={deleting === b.id}
                      className="text-red-600 hover:underline text-sm disabled:opacity-50"
                    >
                      {deleting === b.id ? "…" : "Delete"}
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
