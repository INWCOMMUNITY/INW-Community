"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function FollowButton({
  memberId,
  initialFollowing,
}: {
  memberId: string;
  initialFollowing: boolean;
}) {
  const router = useRouter();
  const [following, setFollowing] = useState(initialFollowing);
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    try {
      const res = await fetch("/api/follow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memberId,
          action: following ? "unfollow" : "follow",
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setFollowing(data?.following ?? !following);
      } else {
        alert(data?.error ?? "Failed");
      }
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className="btn text-sm"
    >
      {loading ? "…" : following ? "Unfollow" : "Follow"}
    </button>
  );
}
