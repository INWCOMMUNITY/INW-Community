"use client";

import { useState, useEffect, useCallback } from "react";

interface RequestRow {
  id: string;
  groupId: string;
  status: string;
  createdAt: string;
  group: { id: string; name: string; slug: string };
  requester: { id: string; email: string; firstName: string; lastName: string };
}

export default function GroupDeletionRequestsPage() {
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [denyForId, setDenyForId] = useState<string | null>(null);
  const [denyReason, setDenyReason] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    fetch("/api/admin/group-deletion-requests?status=pending")
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
      const res = await fetch(`/api/admin/group-deletion-requests/${id}/approve`, { method: "POST" });
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
      setError("Denial reason must be at least 20 characters.");
      return;
    }
    setError("");
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/group-deletion-requests/${id}/deny`, {
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
      <h1 className="text-2xl font-bold mb-2">Group deletion requests</h1>
      <p className="text-gray-600 mb-6">
        A group creator asked to delete their group. Approving permanently removes the group and its feed posts. Denying
        requires a reason (min 20 characters); the creator is emailed.
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
              <p className="font-semibold text-lg">{r.group.name}</p>
              <p className="text-sm text-gray-500">/{r.group.slug}</p>
              <p className="text-sm text-gray-600">
                Requested by {r.requester.firstName} {r.requester.lastName} ({r.requester.email})
              </p>
              <p className="text-xs text-gray-500">Submitted {new Date(r.createdAt).toLocaleString()}</p>
              {denyForId === r.id ? (
                <div className="space-y-2 pt-2">
                  <textarea
                    className="w-full border rounded p-2 text-sm"
                    rows={4}
                    placeholder="Explain why the group will stay (min 20 characters)…"
                    value={denyReason}
                    onChange={(e) => setDenyReason(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="px-3 py-1 bg-gray-200 rounded text-sm"
                      onClick={() => {
                        setDenyForId(null);
                        setDenyReason("");
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="px-3 py-1 bg-red-600 text-white rounded text-sm disabled:opacity-50"
                      disabled={busyId === r.id}
                      onClick={() => deny(r.id)}
                    >
                      {busyId === r.id ? "Sending…" : "Submit denial"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2 pt-2">
                  <button
                    type="button"
                    className="px-4 py-2 bg-green-600 text-white rounded text-sm font-medium disabled:opacity-50"
                    disabled={busyId === r.id}
                    onClick={() => approve(r.id)}
                  >
                    {busyId === r.id ? "Working…" : "Approve deletion"}
                  </button>
                  <button
                    type="button"
                    className="px-4 py-2 border border-gray-400 rounded text-sm font-medium"
                    disabled={busyId === r.id}
                    onClick={() => setDenyForId(r.id)}
                  >
                    Deny
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
