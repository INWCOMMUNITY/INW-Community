"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const MAIN_URL = process.env.NEXT_PUBLIC_MAIN_SITE_URL || "http://localhost:3000";
const ADMIN_CODE = process.env.NEXT_PUBLIC_ADMIN_CODE ?? "NWC36481";

export function AdminEventActions({
  eventId,
  status,
}: {
  eventId: string;
  status: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const isPending = status === "pending";

  async function handleApprove() {
    setLoading(true);
    try {
      const res = await fetch(`${MAIN_URL}/api/admin/events/${eventId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-admin-code": ADMIN_CODE,
        },
        body: JSON.stringify({ status: "approved" }),
      });
      if (res.ok) router.refresh();
    } finally {
      setLoading(false);
    }
  }

  async function handleReject() {
    if (!confirm("Reject this event? It will remain pending.")) return;
    setLoading(true);
    try {
      const res = await fetch(`${MAIN_URL}/api/admin/events/${eventId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-admin-code": ADMIN_CODE,
        },
        body: JSON.stringify({ status: "pending" }),
      });
      if (res.ok) router.refresh();
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    if (!confirm("Delete this event?")) return;
    setLoading(true);
    try {
      const res = await fetch(`${MAIN_URL}/api/admin/events/${eventId}`, {
        method: "DELETE",
        headers: { "x-admin-code": ADMIN_CODE },
      });
      if (res.ok) router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-2 justify-end">
      {isPending && (
        <button
          type="button"
          onClick={handleApprove}
          disabled={loading}
          className="text-green-600 hover:underline text-sm"
        >
          {loading ? "…" : "Approve"}
        </button>
      )}
      {!isPending && (
        <button
          type="button"
          onClick={handleReject}
          disabled={loading}
          className="text-amber-600 hover:underline text-sm"
        >
          {loading ? "…" : "Reject"}
        </button>
      )}
      <button
        type="button"
        onClick={handleDelete}
        disabled={loading}
        className="text-red-600 hover:underline text-sm"
      >
        Delete
      </button>
    </div>
  );
}
