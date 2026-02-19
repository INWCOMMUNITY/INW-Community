"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AdminMemberActions({
  memberId,
  status,
}: {
  memberId: string;
  status: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [showGift, setShowGift] = useState(false);
  const [giftPoints, setGiftPoints] = useState("");
  const [giftError, setGiftError] = useState("");
  const isSuspended = status === "suspended";

  async function handleGiftPoints(e: React.FormEvent) {
    e.preventDefault();
    const pts = parseInt(giftPoints, 10);
    if (!Number.isInteger(pts) || pts < 1) {
      setGiftError("Enter a positive number");
      return;
    }
    setLoading(true);
    setGiftError("");
    try {
      const res = await fetch(`/api/admin/members/${memberId}/points`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ points: pts }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setShowGift(false);
        setGiftPoints("");
        router.refresh();
      } else {
        setGiftError(data.error ?? "Failed");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleSuspend() {
    if (!confirm(isSuspended ? "Unsuspend this member?" : "Suspend this member? They will not be able to sign in."))
      return;
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/members/${memberId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
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
      const res = await fetch(`/api/admin/members/${memberId}`, {
        method: "DELETE",
      });
      if (res.ok) router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-2 justify-end flex-wrap">
      {showGift ? (
        <form onSubmit={handleGiftPoints} className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            value={giftPoints}
            onChange={(e) => setGiftPoints(e.target.value)}
            placeholder="Points"
            className="w-20 border rounded px-2 py-1 text-sm"
            autoFocus
          />
          <button type="submit" disabled={loading} className="text-sm text-green-600 hover:underline">
            {loading ? "…" : "Send"}
          </button>
          <button type="button" onClick={() => { setShowGift(false); setGiftPoints(""); setGiftError(""); }} className="text-sm text-gray-500 hover:underline">
            Cancel
          </button>
          {giftError && <span className="text-red-600 text-xs">{giftError}</span>}
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setShowGift(true)}
          disabled={loading}
          className="text-sm text-green-600 hover:underline"
        >
          Gift Points
        </button>
      )}
      <button
        type="button"
        onClick={handleSuspend}
        disabled={loading}
        className={`text-sm hover:underline ${isSuspended ? "text-green-600" : "text-amber-600"}`}
      >
        {loading && !showGift ? "…" : isSuspended ? "Unsuspend" : "Suspend"}
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
