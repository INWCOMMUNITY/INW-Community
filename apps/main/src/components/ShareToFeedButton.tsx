"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";

interface ShareToFeedButtonProps {
  type: "business" | "coupon" | "reward" | "store_item";
  id: string;
  className?: string;
}

const API_MAP = {
  business: "/api/businesses",
  coupon: "/api/coupons",
  reward: "/api/rewards",
  store_item: "/api/store-items",
};

export function ShareToFeedButton({ type, id, className = "" }: ShareToFeedButtonProps) {
  const { data: session, status } = useSession();
  const [loading, setLoading] = useState(false);
  const [shared, setShared] = useState(false);

  async function handleShare() {
    if (status !== "authenticated" || loading) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_MAP[type]}/${id}/share`, { method: "POST" });
      if (res.ok) {
        setShared(true);
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error ?? "Failed to share");
      }
    } finally {
      setLoading(false);
    }
  }

  if (status !== "authenticated") {
    return (
      <Link href={`/login?callbackUrl=${typeof window !== "undefined" ? window.location.pathname : "/"}`} className={className}>
        Share to feed
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={handleShare}
      disabled={loading || shared}
      className={className}
    >
      {loading ? "Sharing…" : shared ? "Shared!" : "Share to feed"}
    </button>
  );
}
