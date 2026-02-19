"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { AdminBusinessForm } from "../sponsors/AdminBusinessForm";

interface Business {
  id: string;
  name: string;
  slug: string;
  memberId: string;
  nameApprovalStatus: string;
}

interface SponsorOption {
  memberId: string;
  firstName: string;
  lastName: string;
  email: string;
  businessCount: number;
}

export default function AdminBusinessesPage() {
  const router = useRouter();
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [sponsors, setSponsors] = useState<Array<{
    memberId: string;
    firstName: string;
    lastName: string;
    email: string;
    businesses: { id: string }[];
  }>>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  function refetch() {
    return Promise.all([
      fetch("/api/admin/businesses").then((r) => r.json()),
      fetch("/api/admin/sponsors").then((r) => r.json()),
    ]).then(([bizData, sponsorData]) => {
      setBusinesses(Array.isArray(bizData) ? bizData : []);
      setSponsors(Array.isArray(sponsorData) ? sponsorData : []);
    }).catch(() => {
      setBusinesses([]);
      setSponsors([]);
    });
  }

  useEffect(() => {
    refetch().finally(() => setLoading(false));
  }, []);

  const sponsorOptions: SponsorOption[] = sponsors.map((s) => ({
    memberId: s.memberId,
    firstName: s.firstName,
    lastName: s.lastName,
    email: s.email,
    businessCount: s.businesses?.length ?? 0,
  }));

  const canAddBusiness = sponsorOptions.some((s) => s.businessCount < 2);

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
        refetch();
      }
    } finally {
      setDeleting(null);
    }
  }

  function closeForm() {
    setShowAddForm(false);
    refetch();
  }

  if (loading) return <p className="text-gray-500">Loading…</p>;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <h1 className="text-2xl font-bold">Businesses</h1>
        <button
          type="button"
          onClick={() => setShowAddForm(true)}
          disabled={!canAddBusiness}
          className="px-4 py-2 rounded disabled:opacity-50 disabled:cursor-not-allowed text-sm"
          style={{ backgroundColor: "#505542", color: "#fff" }}
        >
          Add business
        </button>
      </div>

      {showAddForm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={(e) => e.target === e.currentTarget && closeForm()}
        >
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b sticky top-0 bg-white">
              <h2 className="text-lg font-semibold">Add business</h2>
            </div>
            <AdminBusinessForm sponsors={sponsorOptions} onClose={closeForm} />
          </div>
        </div>
      )}

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
