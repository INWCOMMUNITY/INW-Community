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

export default function PendingBusinessNamesPage() {
  const router = useRouter();
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/admin/businesses?pending=1")
      .then((r) => r.json())
      .then((data) => setBusinesses(Array.isArray(data) ? data : []))
      .catch(() => setError("Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  async function handleAction(id: string, status: "approved" | "rejected") {
    setError("");
    try {
const res = await fetch(`/api/admin/businesses/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nameApprovalStatus: status }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed");
        return;
      }
      setBusinesses((prev) => prev.filter((b) => b.id !== id));
      router.refresh();
    } catch {
      setError("Failed");
    }
  }

  if (loading) return <p className="text-gray-500">Loading…</p>;
  if (error) return <p className="text-red-600">{error}</p>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Pending Business Names</h1>
      <p className="text-gray-600 mb-6">
        Businesses with profanity in their name require admin approval before they appear publicly.
      </p>
      {businesses.length === 0 ? (
        <p className="text-gray-500">No pending business names.</p>
      ) : (
        <ul className="space-y-4">
          {businesses.map((b) => (
            <li
              key={b.id}
              className="flex items-center justify-between border rounded-lg p-4 bg-gray-50"
            >
              <div>
                <p className="font-medium">{b.name}</p>
                <p className="text-sm text-gray-500">{b.slug}</p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => handleAction(b.id, "approved")}
                  className="px-3 py-1 rounded bg-green-600 text-white text-sm font-medium hover:bg-green-700"
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => handleAction(b.id, "rejected")}
                  className="px-3 py-1 rounded bg-red-600 text-white text-sm font-medium hover:bg-red-700"
                >
                  Reject
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
