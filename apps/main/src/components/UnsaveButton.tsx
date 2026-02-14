"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface UnsaveButtonProps {
  type: "event" | "business" | "coupon";
  referenceId: string;
  label?: string;
}

export function UnsaveButton({ type, referenceId, label = "Remove" }: UnsaveButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleRemove() {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/saved?type=${encodeURIComponent(type)}&referenceId=${encodeURIComponent(referenceId)}`,
        { method: "DELETE" }
      );
      if (res.ok) setTimeout(() => router.refresh(), 100);
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleRemove}
      disabled={loading}
      className="text-sm text-gray-500 hover:text-red-600 hover:underline disabled:opacity-50"
    >
      {loading ? "Removing…" : label}
    </button>
  );
}
