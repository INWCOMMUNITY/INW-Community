"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface MePoints {
  points?: number;
  allTimePointsEarned?: number;
  seasonPointsEarned?: number;
  currentSeason?: { id: string; name: string };
}

export function CommunityPointsContent() {
  const [data, setData] = useState<MePoints | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((d) => {
        if (d?.error) setData(null);
        else setData({ points: d?.points ?? 0, allTimePointsEarned: d?.allTimePointsEarned ?? 0, seasonPointsEarned: d?.seasonPointsEarned ?? 0, currentSeason: d?.currentSeason ?? undefined });
      })
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <p className="text-gray-500">Loading…</p>;
  }

  if (!data) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-4">Community Points</h1>
        <p className="text-gray-600">Sign in to view your Community Points.</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Community Points</h1>
      <p className="text-gray-600 mb-6">
        Earn points by supporting local—saving businesses, attending events, using coupons, and engaging with the community.
      </p>

      <div className="border-2 rounded-lg p-6 mb-6" style={{ borderColor: "var(--color-primary)" }}>
        <h2 className="text-lg font-semibold mb-4">Points summary</h2>
        <dl className="space-y-3">
          <div className="flex justify-between items-center">
            <dt className="text-gray-600">All Time Total</dt>
            <dd className="font-semibold" style={{ color: "var(--color-primary)" }}>{data.allTimePointsEarned ?? 0} points</dd>
          </div>
          {data.currentSeason && (
            <div className="flex justify-between items-center">
              <dt className="text-gray-600">{data.currentSeason.name} (Season)</dt>
              <dd className="font-semibold" style={{ color: "var(--color-primary)" }}>{data.seasonPointsEarned ?? 0} points</dd>
            </div>
          )}
          <div className="flex justify-between items-center">
            <dt className="text-gray-600">My Community Points (balance)</dt>
            <dd className="font-semibold" style={{ color: "var(--color-primary)" }}>{data.points ?? 0} points</dd>
          </div>
        </dl>
      </div>

      <div className="flex flex-wrap gap-3">
        <Link href="/my-community/my-rewards" className="btn inline-block">
          My Rewards
        </Link>
        <Link href="/rewards" className="btn inline-block border-2 bg-white hover:bg-gray-50" style={{ borderColor: "var(--color-primary)", color: "var(--color-primary)" }}>
          Redeem rewards
        </Link>
      </div>
    </div>
  );
}
