"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

const ADMIN_CODE = process.env.NEXT_PUBLIC_ADMIN_CODE ?? "NWC36481";
const MAIN_URL = process.env.NEXT_PUBLIC_MAIN_SITE_URL || "http://localhost:3000";

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

interface ContentPreview {
  type: "post" | "comment";
  content: string | null;
  author: { firstName: string; lastName: string };
  photo?: string | null;
}

export default function ReportsPage() {
  const router = useRouter();
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [previews, setPreviews] = useState<Record<string, ContentPreview | null>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    const url = statusFilter
      ? `${MAIN_URL}/api/admin/reports?status=${statusFilter}`
      : `${MAIN_URL}/api/admin/reports`;
    fetch(url, { headers: { "x-admin-code": ADMIN_CODE } })
      .then((r) => r.json())
      .then((data) => setReports(Array.isArray(data) ? data : []))
      .catch(() => setReports([]))
      .finally(() => setLoading(false));
  }, [statusFilter]);

  async function updateStatus(id: string, status: string) {
    try {
      const res = await fetch(`${MAIN_URL}/api/admin/reports/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-admin-code": ADMIN_CODE,
        },
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

  async function togglePreview(id: string) {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    if (previews[id] !== undefined) return;
    try {
      const res = await fetch(`${MAIN_URL}/api/admin/reports/${id}/content`, {
        headers: { "x-admin-code": ADMIN_CODE },
      });
      if (res.ok) {
        const data = await res.json();
        setPreviews((prev) => ({ ...prev, [id]: data }));
      } else {
        setPreviews((prev) => ({ ...prev, [id]: null }));
      }
    } catch {
      setPreviews((prev) => ({ ...prev, [id]: null }));
    }
  }

  async function deleteContent(id: string) {
    if (!confirm("Are you sure you want to delete this content? This cannot be undone.")) return;
    setDeleting(id);
    try {
      const res = await fetch(`${MAIN_URL}/api/admin/reports/${id}/content`, {
        method: "DELETE",
        headers: { "x-admin-code": ADMIN_CODE },
      });
      if (res.ok) {
        setReports((prev) => prev.map((r) => (r.id === id ? { ...r, status: "resolved" } : r)));
        setPreviews((prev) => ({ ...prev, [id]: null }));
        setExpandedId(null);
      }
    } catch {
      // Ignore
    } finally {
      setDeleting(null);
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
                  {(r.contentType === "post" || r.contentType === "comment") && (
                    <button
                      type="button"
                      onClick={() => togglePreview(r.id)}
                      className="text-sm text-indigo-600 hover:underline"
                    >
                      {expandedId === r.id ? "Hide preview" : "Preview content"}
                    </button>
                  )}
                </div>
              </div>
              {expandedId === r.id && (
                <div className="mt-3 border-t pt-3">
                  {previews[r.id] === undefined ? (
                    <p className="text-sm text-gray-400">Loading preview…</p>
                  ) : previews[r.id] === null ? (
                    <p className="text-sm text-gray-400">Content not found or already deleted.</p>
                  ) : (
                    <div className="bg-white rounded p-3 border">
                      <p className="text-xs text-gray-500 mb-1">
                        {previews[r.id]!.type === "post" ? "Post" : "Comment"} by{" "}
                        <span className="font-medium">
                          {previews[r.id]!.author.firstName} {previews[r.id]!.author.lastName}
                        </span>
                      </p>
                      {previews[r.id]!.photo && (
                        <img
                          src={previews[r.id]!.photo!}
                          alt="Post photo"
                          className="w-32 h-32 object-cover rounded mb-2"
                        />
                      )}
                      <p className="text-sm text-gray-800 whitespace-pre-wrap">
                        {previews[r.id]!.content || <span className="italic text-gray-400">No text content</span>}
                      </p>
                      <button
                        type="button"
                        onClick={() => deleteContent(r.id)}
                        disabled={deleting === r.id}
                        className="mt-3 px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
                      >
                        {deleting === r.id ? "Deleting…" : "Delete content"}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
