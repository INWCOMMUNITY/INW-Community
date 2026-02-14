"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const MAIN_URL = process.env.NEXT_PUBLIC_MAIN_SITE_URL || "http://localhost:3000";
const ADMIN_CODE = process.env.NEXT_PUBLIC_ADMIN_CODE ?? "NWC36481";

export function AdminMemberActions({
  memberId,
  status,
}: {
  memberId: string;
  status: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const isSuspended = status === "suspended";

  async function handleSuspend() {
    if (!confirm(isSuspended ? "Unsuspend this member?" : "Suspend this member? They will not be able to sign in."))
      return;
    setLoading(true);
    try {
      const res = await fetch(`${MAIN_URL}/api/admin/members/${memberId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-admin-code": ADMIN_CODE,
        },
        body: JSON.stringify({ status: isSuspended ? "active" : "suspended" }),
      });
      if (res.ok) router.refresh();
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    if (!confirm("Delete this member? This cannot be undone.")) return;
    setLoading(true);
    try {
      const res = await fetch(`${MAIN_URL}/api/admin/members/${memberId}`, {
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
      <button
        type="button"
        onClick={handleSuspend}
        disabled={loading}
        className={`text-sm hover:underline ${isSuspended ? "text-green-600" : "text-amber-600"}`}
      >
        {loading ? "…" : isSuspended ? "Unsuspend" : "Suspend"}
      </button>
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
