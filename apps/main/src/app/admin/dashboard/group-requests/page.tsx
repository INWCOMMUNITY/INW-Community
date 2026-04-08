"use client";

import { useState, useEffect, useCallback } from "react";

interface RequestRow {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  coverImageUrl: string | null;
  rules: string | null;
  allowBusinessPosts: boolean;
  status: string;
  denialReason: string | null;
  createdAt: string;
  requester: { id: string; email: string; firstName: string; lastName: string };
  resultingGroup: { id: string; slug: string; name: string } | null;
}

export default function GroupCreationRequestsPage() {
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [denyForId, setDenyForId] = useState<string | null>(null);
  const [denyReason, setDenyReason] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    fetch("/api/admin/group-creation-requests?status=pending")
      .then((r) => r.json())
      .then((data) => setRequests(Array.isArray(data.requests) ? data.requests : []))
      .catch(() => setError("Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function approve(id: string) {
    setError("");
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/group-creation-requests/${id}/approve`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Approve failed");
        return;
      }
      setRequests((prev) => prev.filter((r) => r.id !== id));
    } catch {
      setError("Approve failed");
    } finally {
      setBusyId(null);
    }
  }

  async function deny(id: string) {
    const reason = denyReason.trim();
    if (reason.length < 20) {
      setError("Denial reason must be at least 20 characters (sent to the member by email).");
      return;
    }
    setError("");
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/group-creation-requests/${id}/deny`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Deny failed");
        return;
      }
      setDenyForId(null);
      setDenyReason("");
      setRequests((prev) => prev.filter((r) => r.id !== id));
    } catch {
      setError("Deny failed");
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <p className="text-gray-500">Loading…</p>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Group requests</h1>
      <p className="text-gray-600 mb-6">
        Pending requests to create a new community group. Approve to create the group and make the requester an admin. Deny
        to reject and email them your explanation (required, min 20 characters).
      </p>
      {error ? <p className="text-red-600 mb-4">{error}</p> : null}
      <button type="button" onClick={() => load()} className="mb-6 text-sm text-blue-600 hover:underline">
        Refresh
      </button>
      {requests.length === 0 ? (
        <p className="text-gray-500">No pending requests.</p>
      ) : (
        <ul className="space-y-6">
          {requests.map((r) => (
            <li key={r.id} className="border rounded-lg p-4 bg-gray-50 space-y-2">
              <p className="font-semibold text-lg">{r.name}</p>
              <p className="text-sm text-gray-600">
                Requested by {r.requester.firstName} {r.requester.lastName} ({r.requester.email})
              </p>
              {r.category ? (
                <p className="text-sm">
                  <span className="font-medium">Category:</span> {r.category}
                </p>
              ) : null}
              {r.description ? (
                <p className="text-sm whitespace-pre-wrap">
                  <span className="font-medium">Description:</span> {r.description}
                </p>
              ) : null}
              {r.rules ? (
                <p className="text-sm whitespace-pre-wrap">
                  <span className="font-medium">Rules:</span> {r.rules}
                </p>
              ) : null}
              <p className="text-sm">
                <span className="font-medium">Allow business posts:</span> {r.allowBusinessPosts ? "Yes" : "No"}
              </p>
              {r.coverImageUrl ? (
                <a href={r.coverImageUrl} target="_blank" rel="noreferrer" className="text-sm text-blue-600 break-all">
                  Cover image
                </a>
              ) : null}
              {denyForId === r.id ? (
                <div className="pt-2 space-y-2">
                  <label className="block text-sm font-medium">Reason for denial (emailed to member)</label>
                  <textarea
                    value={denyReason}
                    onChange={(e) => setDenyReason(e.target.value)}
                    rows={4}
                    className="w-full border rounded px-3 py-2 text-sm"
                    placeholder="At least 20 characters explaining why the request was not approved."
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={busyId === r.id}
                      onClick={() => deny(r.id)}
                      className="px-3 py-1 rounded bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50"
                    >
                      Send denial email
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDenyForId(null);
                        setDenyReason("");
                      }}
                      className="px-3 py-1 rounded border text-sm"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2 pt-2">
                  <button
                    type="button"
                    disabled={busyId === r.id}
                    onClick={() => approve(r.id)}
                    className="px-3 py-1 rounded bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    disabled={busyId === r.id}
                    onClick={() => {
                      setDenyForId(r.id);
                      setDenyReason("");
                    }}
                    className="px-3 py-1 rounded bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50"
                  >
                    Deny…
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
