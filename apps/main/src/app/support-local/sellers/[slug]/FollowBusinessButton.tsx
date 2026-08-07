"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { IonIcon } from "@/components/IonIcon";

interface FollowBusinessButtonProps {
  businessId: string;
  variant?: "default" | "pill";
}

export function FollowBusinessButton({ businessId, variant = "default" }: FollowBusinessButtonProps) {
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

  const pillClass = followed
    ? "action-pill btn-pill-primary disabled:opacity-60"
    : "action-pill btn-pill-outline disabled:opacity-60";

  const defaultClass = followed
    ? "px-4 py-2 rounded border text-sm font-medium border-gray-300 bg-gray-100 text-gray-700"
    : "action-pill btn-pill-primary";

  if (status === "loading") {
    return variant === "pill" ? (
      <span className={pillClass} aria-hidden>
        …
      </span>
    ) : null;
  }

  if (status !== "authenticated") {
    const href = `/login?callbackUrl=${encodeURIComponent(typeof window !== "undefined" ? window.location.pathname : "/")}`;
    if (variant === "pill") {
      return (
        <Link href={href} className={pillClass}>
          <IonIcon name="heart-outline" size={18} />
          Follow
        </Link>
      );
    }
    return null;
  }

  if (variant === "pill") {
    return (
      <button type="button" onClick={handleToggle} disabled={loading} className={pillClass}>
        <IonIcon name={followed ? "heart" : "heart-outline"} size={18} />
        {loading ? "…" : followed ? "Following" : "Follow"}
      </button>
    );
  }

  return (
    <button type="button" onClick={handleToggle} disabled={loading} className={defaultClass}>
      {loading ? "..." : followed ? "Following" : "Follow"}
    </button>
  );
}
