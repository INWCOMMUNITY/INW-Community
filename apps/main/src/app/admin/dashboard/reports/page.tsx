"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface Report {
  id: string;
  reporterId: string;
  contentType: string;
  contentId: string;
  reason: string;
  details: string | null;
  status: string;
  createdAt: string;
  reporter: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
}

export default function ReportsPage() {
  const router = useRouter();
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");

  useEffect(() => {
    const url = statusFilter
      ? `/api/admin/reports?status=${statusFilter}`
      : "/api/admin/reports";
    fetch(url)
      .then((r) => r.json())
      .then((data) => setReports(Array.isArray(data) ? data : []))
      .catch(() => setReports([]))
      .finally(() => setLoading(false));
  }, [statusFilter]);

  async function updateStatus(id: string, status: string) {
    try {
const res = await fetch(`/api/admin/reports/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        setReports((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
        router.refresh();
      }
    } catch {
      // Ignore
    }
  }

  if (loading) return <p className="text-gray-500">Loading…</p>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Reports</h1>
      <p className="text-gray-600 mb-6">
        User reports for political/hate content, nudity, CSAM, or other violations.
      </p>
      <div className="mb-6">
        <label className="block text-sm font-medium mb-2">Filter by status</label>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border rounded px-3 py-2"
        >
          <option value="">All</option>
          <option value="pending">Pending</option>
          <option value="reviewed">Reviewed</option>
          <option value="resolved">Resolved</option>
        </select>
      </div>
      {reports.length === 0 ? (
        <p className="text-gray-500">No reports.</p>
      ) : (
        <ul className="space-y-4">
          {reports.map((r) => (
            <li key={r.id} className="border rounded-lg p-4 bg-gray-50">
              <div className="flex justify-between items-start gap-4">
                <div>
                  <p className="font-medium">
                    {r.contentType} · {r.reason}
                  </p>
                  <p className="text-sm text-gray-500 mt-1">
                    Content ID: {r.contentId}
                  </p>
                  <p className="text-sm text-gray-500">
                    Reported by {r.reporter.firstName} {r.reporter.lastName} ({r.reporter.email})
                  </p>
                  {r.details && (
                    <p className="text-sm mt-2 text-gray-700">{r.details}</p>
                  )}
                  <p className="text-xs text-gray-400 mt-1">
                    {new Date(r.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex flex-col gap-1 shrink-0">
                  <span
                    className={`text-sm font-medium ${
                      r.status === "pending"
                        ? "text-amber-600"
                        : r.status === "resolved"
                          ? "text-green-600"
                          : "text-gray-600"
                    }`}
                  >
                    {r.status}
                  </span>
                  {r.status !== "reviewed" && (
                    <button
                      type="button"
                      onClick={() => updateStatus(r.id, "reviewed")}
                      className="text-sm text-blue-600 hover:underline"
                    >
                      Mark reviewed
                    </button>
                  )}
                  {r.status !== "resolved" && (
                    <button
                      type="button"
                      onClick={() => updateStatus(r.id, "resolved")}
                      className="text-sm text-green-600 hover:underline"
                    >
                      Mark resolved
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
