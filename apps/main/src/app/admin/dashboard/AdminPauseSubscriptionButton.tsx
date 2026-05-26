"use client";

import { useState } from "react";

const PAUSE_CONFIRM =
  "Pause this subscription and stop billing immediately? Their business profile and Business Hub access will remain (admin-granted). This cannot be undone from here—they can subscribe again later.";

export function AdminPauseSubscriptionButton({
  memberId,
  onSuccess,
  className = "text-sm text-amber-700 hover:underline",
}: {
  memberId: string;
  onSuccess?: () => void;
  className?: string;
}) {
  const [loading, setLoading] = useState(false);

  async function handlePause() {
    if (!confirm(PAUSE_CONFIRM)) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/members/${memberId}/pause-subscription`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        onSuccess?.();
      } else {
        alert(data.error ?? "Failed to pause subscription");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <button type="button" onClick={handlePause} disabled={loading} className={className}>
      {loading ? "Pausing…" : "Pause & keep profile"}
    </button>
  );
}
