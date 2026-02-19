"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AdminBlogActions({ blogId, status }: { blogId: string; status: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const isPending = status === "pending";

  async function handleApprove() {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/blogs/${blogId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: "approved" }),
      });
      if (res.ok) router.refresh();
    } finally {
      setLoading(false);
    }
  }

  async function handleReject() {
    if (!confirm("Reject this blog? It will remain pending.")) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/blogs/${blogId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: "pending" }),
      });
      if (res.ok) router.refresh();
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    if (!confirm("Delete this blog?")) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/blogs/${blogId}`, {
        method: "DELETE",
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
