"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

const MAIN_URL = process.env.NEXT_PUBLIC_MAIN_SITE_URL || "http://localhost:3000";
const ADMIN_CODE = process.env.NEXT_PUBLIC_ADMIN_CODE ?? "NWC36481";

interface FlaggedItem {
  id: string;
  contentType: string;
  contentId: string | null;
  reason: string;
  snippet: string | null;
  authorId: string | null;
  status: string;
  createdAt: string;
}

export default function FlaggedPage() {
  const router = useRouter();
  const [items, setItems] = useState<FlaggedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("pending");

  useEffect(() => {
    const url = statusFilter
      ? `${MAIN_URL}/api/admin/flagged?status=${statusFilter}`
      : `${MAIN_URL}/api/admin/flagged`;
    fetch(url, { headers: { "x-admin-code": ADMIN_CODE } })
      .then((r) => r.json())
      .then((data) => setItems(Array.isArray(data) ? data : []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [statusFilter]);

  async function updateStatus(id: string, status: string) {
    try {
      const res = await fetch(`${MAIN_URL}/api/admin/flagged`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-admin-code": ADMIN_CODE,
        },
        body: JSON.stringify({ id, status }),
      });
      if (res.ok) {
        setItems((prev) => prev.map((i) => (i.id === id ? { ...i, status } : i)));
        router.refresh();
      }
    } catch {
      // Ignore
    }
  }

  if (loading) return <p className="text-gray-500">Loading…</p>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
        <h1 className="text-2xl font-bold">Flagged Content</h1>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Filter:</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border rounded px-3 py-2 text-sm"
          >
            <option value="pending">Pending</option>
            <option value="reviewed">Reviewed</option>
            <option value="removed">Removed</option>
          </select>
        </div>
      </div>
      <p className="text-gray-600 mb-6">
        Content that triggered restricted content rules (slurs, prohibited categories, profanity). Review and mark as reviewed or removed.
      </p>
      {items.length === 0 ? (
        <p className="text-gray-500">No flagged content.</p>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Reason</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Snippet</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-2 text-sm font-medium">{item.contentType}</td>
                  <td className="px-4 py-2 text-sm">{item.reason}</td>
                  <td className="px-4 py-2 text-sm text-gray-600 max-w-xs truncate" title={item.snippet ?? ""}>
                    {item.snippet ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-500">
                    {new Date(item.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded ${
                        item.status === "pending"
                          ? "bg-amber-100 text-amber-800"
                          : item.status === "reviewed"
                          ? "bg-green-100 text-green-800"
                          : "bg-gray-100 text-gray-800"
                      }`}
                    >
                      {item.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    {item.status === "pending" && (
                      <>
                        <button
                          type="button"
                          onClick={() => updateStatus(item.id, "reviewed")}
                          className="text-green-600 hover:underline text-sm mr-2"
                        >
                          Mark reviewed
                        </button>
                        <button
                          type="button"
                          onClick={() => updateStatus(item.id, "removed")}
                          className="text-red-600 hover:underline text-sm"
                        >
                          Mark removed
                        </button>
                      </>
                    )}
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
