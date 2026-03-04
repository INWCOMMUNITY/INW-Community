"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface MePoints {
  points?: number;
  allTimePointsEarned?: number;
  seasonPointsEarned?: number;
  currentSeason?: { id: string; name: string };
}

interface RedemptionItem {
  id: string;
  createdAt: string;
  pointsSpent: number;
  reward: {
    id: string;
    title: string;
    imageUrl: string | null;
    pointsRequired: number;
    business: { name: string; slug: string };
  } | null;
}

interface Reward {
  id: string;
  title: string;
  description: string | null;
  pointsRequired: number;
  imageUrl: string | null;
  business: { id: string; name: string; slug: string; logoUrl: string | null };
}

export default function MyRewardsPage() {
  const [pointsSummary, setPointsSummary] = useState<MePoints | null>(null);
  const [redemptions, setRedemptions] = useState<RedemptionItem[]>([]);
  const [likedRewards, setLikedRewards] = useState<Reward[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const [meRes, redRes, savedRes, rewardsRes] = await Promise.all([
          fetch("/api/me"),
          fetch("/api/rewards/redemptions"),
          fetch("/api/saved?type=reward"),
          fetch("/api/rewards"),
        ]);
        const me = meRes.ok ? await meRes.json() : null;
        const redData = redRes.ok ? await redRes.json() : { redemptions: [] };
        const saved = savedRes.ok ? await savedRes.json() : [];
        const rewardsList = rewardsRes.ok ? await rewardsRes.json() : [];

        if (me && !me.error) {
          setPointsSummary({
            points: me.points ?? 0,
            allTimePointsEarned: me.allTimePointsEarned ?? 0,
            seasonPointsEarned: me.seasonPointsEarned ?? 0,
            currentSeason: me.currentSeason ?? undefined,
          });
        } else {
          setPointsSummary(null);
        }

        setRedemptions(Array.isArray(redData?.redemptions) ? redData.redemptions : []);
        const savedIds = new Set(Array.isArray(saved) ? saved.map((i: { referenceId: string }) => i.referenceId) : []);
        setLikedRewards(Array.isArray(rewardsList) ? rewardsList.filter((r: Reward) => savedIds.has(r.id)) : []);
      } catch {
        setPointsSummary(null);
        setRedemptions([]);
        setLikedRewards([]);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  if (loading) {
    return <p className="text-gray-500">Loading…</p>;
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">My Rewards</h1>

      {pointsSummary != null && (
        <section className="mb-8 border-2 rounded-lg p-6" style={{ borderColor: "var(--color-primary)" }}>
          <h2 className="text-lg font-semibold mb-4">Points summary</h2>
          <dl className="space-y-2">
            <div className="flex justify-between">
              <dt className="text-gray-600">All Time Total</dt>
              <dd className="font-semibold" style={{ color: "var(--color-primary)" }}>{pointsSummary.allTimePointsEarned ?? 0} points</dd>
            </div>
            {pointsSummary.currentSeason && (
              <div className="flex justify-between">
                <dt className="text-gray-600">{pointsSummary.currentSeason.name} (Season)</dt>
                <dd className="font-semibold" style={{ color: "var(--color-primary)" }}>{pointsSummary.seasonPointsEarned ?? 0} points</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-gray-600">My Community Points (balance)</dt>
              <dd className="font-semibold" style={{ color: "var(--color-primary)" }}>{pointsSummary.points ?? 0} points</dd>
            </div>
          </dl>
          <Link href="/rewards" className="btn inline-block mt-4">Redeem with Points</Link>
        </section>
      )}

      <section className="mb-8">
        <h2 className="text-xl font-bold mb-4">Rewards you&apos;ve redeemed</h2>
        {redemptions.length === 0 ? (
          <p className="text-gray-500">No redemptions yet.</p>
        ) : (
          <ul className="space-y-3 divide-y divide-gray-100">
            {redemptions.map((item) => (
              <li key={item.id} className="flex items-center gap-4 py-3">
                {item.reward?.imageUrl ? (
                  <img src={item.reward.imageUrl} alt="" className="w-14 h-14 rounded object-cover shrink-0" />
                ) : (
                  <div className="w-14 h-14 rounded bg-gray-100 shrink-0 flex items-center justify-center text-gray-400 text-xs">No image</div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{item.reward?.title ?? "Reward"}</p>
                  {item.reward?.business && (
                    <Link href={`/support-local/${item.reward.business.slug}`} className="text-sm hover:underline" style={{ color: "var(--color-primary)" }}>
                      {item.reward.business.name}
                    </Link>
                  )}
                  <p className="text-sm text-gray-500 mt-0.5">
                    {new Date(item.createdAt).toLocaleDateString()} · {item.pointsSpent} points
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-xl font-bold mb-4">Liked rewards</h2>
        {likedRewards.length === 0 ? (
          <p className="text-gray-500">No saved rewards. Like rewards on the <Link href="/rewards" className="underline" style={{ color: "var(--color-primary)" }}>Rewards</Link> page to see them here.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {likedRewards.map((r) => (
              <div key={r.id} className="border-2 rounded-lg p-4" style={{ borderColor: "var(--color-primary)" }}>
                {r.imageUrl ? (
                  <img src={r.imageUrl} alt={r.title} className="w-full aspect-square object-cover rounded mb-2" />
                ) : (
                  <div className="w-full aspect-square bg-gray-100 rounded flex items-center justify-center text-gray-400 text-sm mb-2">No image</div>
                )}
                <h3 className="font-semibold">{r.title}</h3>
                <Link href={`/support-local/${r.business.slug}`} className="text-sm hover:underline" style={{ color: "var(--color-primary)" }}>{r.business.name}</Link>
                <p className="text-sm text-gray-600 mt-1">{r.pointsRequired} points</p>
                <Link href="/rewards" className="btn inline-block mt-2 w-full text-center text-sm py-2">View on Rewards</Link>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
