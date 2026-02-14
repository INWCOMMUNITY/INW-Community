"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Status = "none" | "friends" | "pending_outgoing" | "pending_incoming";

export function AddFriendButton({
  memberId,
  initialStatus,
  onSuccess,
}: {
  memberId: string;
  initialStatus: Status;
  onSuccess?: () => void;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>(initialStatus);
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    if (status !== "none" && status !== "pending_incoming") return;
    setLoading(true);
    try {
      if (status === "pending_incoming") {
        const res = await fetch(`/api/friend-requests`, {
          method: "GET",
        });
        const data = await res.json();
        const incoming = data?.incoming ?? [];
        const req = incoming.find(
          (r: { requester: { id: string }; id: string; status?: string }) => r.requester?.id === memberId
        );
        if (req) {
          const patchRes = await fetch(`/api/friend-requests/${req.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "accepted" }),
          });
          if (patchRes.ok) {
            setStatus("friends");
            onSuccess?.();
          }
        }
      } else {
        const res = await fetch("/api/friend-requests", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ addresseeId: memberId }),
        });
        const data = await res.json();
        if (res.ok) {
          if (data?.accepted) setStatus("friends");
          else setStatus("pending_outgoing");
          onSuccess?.();
        } else {
          alert(data?.error ?? "Failed");
        }
      }
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  if (status === "friends") {
    return <span className="text-sm text-gray-500">Friends</span>;
  }
  if (status === "pending_outgoing") {
    return <span className="text-sm text-gray-500">Request sent</span>;
  }
  if (status === "pending_incoming") {
    return (
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className="btn text-sm bg-green-600 text-white hover:bg-green-700"
      >
        {loading ? "Accepting…" : "Accept request"}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className="btn text-sm"
    >
      {loading ? "Sending…" : "Add friend"}
    </button>
  );
}
