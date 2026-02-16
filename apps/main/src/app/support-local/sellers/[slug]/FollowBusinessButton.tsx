"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";

interface FollowBusinessButtonProps {
  businessId: string;
}

export function FollowBusinessButton({ businessId }: FollowBusinessButtonProps) {
  const { data: session, status } = useSession();
  const [followed, setFollowed] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!session?.user) return;
    fetch(`/api/follow-business/${businessId}/status`)
      .then((r) => r.json())
      .then((d) => setFollowed(d.followed ?? false))
      .catch(() => setFollowed(false));
  }, [session?.user, businessId]);

  const handleToggle = async () => {
    if (!session?.user || loading) return;
    setLoading(true);
    try {
      if (followed) {
        await fetch(`/api/follow-business/${businessId}`, { method: "DELETE" });
        setFollowed(false);
      } else {
        await fetch(`/api/follow-business/${businessId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        setFollowed(true);
      }
    } finally {
      setLoading(false);
    }
  };

  if (status !== "authenticated") return null;

  return (
    <button
      type="button"
      onClick={handleToggle}
      disabled={loading}
      className={`px-4 py-2 rounded border text-sm font-medium ${
        followed
          ? "border-gray-300 bg-gray-100 text-gray-700"
          : "border-[var(--color-primary)] bg-[var(--color-primary)] text-white hover:opacity-90"
      }`}
    >
      {loading ? "..." : followed ? "Following" : "Follow"}
    </button>
  );
}
