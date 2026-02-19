"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { ShareButton } from "@/components/ShareButton";

interface Top5Prize {
  rank: number;
  label: string;
  imageUrl?: string | null;
  businessId?: string | null;
  business?: { id: string; name: string; slug: string; logoUrl: string | null } | null;
}

interface Top5Config {
  enabled: boolean;
  startDate?: string;
  endDate?: string;
  prizes?: Top5Prize[];
}

interface LeaderboardMember {
  id: string;
  firstName: string;
  lastName: string;
  profilePhotoUrl: string | null;
  points: number;
}

interface Reward {
  id: string;
  title: string;
  description: string | null;
  pointsRequired: number;
  redemptionLimit: number;
  timesRedeemed: number;
  imageUrl: string | null;
  business: { id: string; name: string; slug: string; logoUrl: string | null };
}

export function RewardsContent() {
  const { data: session, status } = useSession();
  const [top5, setTop5] = useState<Top5Config | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardMember[]>([]);
  const [top10Leaderboard, setTop10Leaderboard] = useState<LeaderboardMember[]>([]);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [points, setPoints] = useState<number | null>(null);
  const [redeeming, setRedeeming] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/rewards/top5")
      .then((r) => r.json())
      .then(setTop5)
      .catch(() => setTop5({ enabled: false }));
  }, []);

  useEffect(() => {
    if (top5?.enabled) {
      fetch("/api/rewards/leaderboard?limit=5")
        .then((r) => r.json())
        .then(setLeaderboard)
        .catch(() => setLeaderboard([]));
    }
  }, [top5?.enabled]);

  useEffect(() => {
    fetch("/api/rewards/leaderboard?limit=10")
      .then((r) => r.json())
      .then(setTop10Leaderboard)
      .catch(() => setTop10Leaderboard([]));
  }, []);

  useEffect(() => {
    fetch("/api/rewards")
      .then((r) => r.json())
      .then(setRewards)
      .catch(() => setRewards([]));
  }, []);

  useEffect(() => {
    if (session?.user?.id) {
      fetch("/api/me")
        .then((r) => r.json())
        .then((d) => setPoints(d?.points ?? 0))
        .catch(() => setPoints(null));
    } else {
      setPoints(null);
    }
  }, [session?.user?.id]);

  async function handleRedeem(rewardId: string) {
    setError("");
    setRedeeming(rewardId);
    try {
      const res = await fetch(`/api/rewards/${rewardId}/redeem`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Failed to redeem");
        return;
      }
      const reward = rewards.find((r) => r.id === rewardId);
      if (reward) {
        setPoints((p) => (p ?? 0) - reward.pointsRequired);
        if (reward.timesRedeemed + 1 >= reward.redemptionLimit) {
          setRewards((prev) => prev.filter((r) => r.id !== rewardId));
        } else {
          setRewards((prev) =>
            prev.map((r) =>
              r.id === rewardId ? { ...r, timesRedeemed: r.timesRedeemed + 1 } : r
            )
          );
        }
      }
    } finally {
      setRedeeming(null);
    }
  }

  if (status === "loading") {
    return <p className="text-gray-500">Loading…</p>;
  }

  return (
    <div>
      <p className="text-gray-600 mb-8">
        Redeem your Community Points for rewards offered by local businesses. Support local to earn more points!
      </p>

      {/* My Community Points + Top 10 Leaderboard + Top 10 Rewards - side by side */}
      <section className="mb-12 flex flex-col lg:flex-row gap-6 items-stretch">
        <div className="w-full lg:w-auto lg:max-w-[364px] shrink-0 flex flex-col gap-3">
          {session?.user && points !== null && (
            <div
              className="p-4 rounded-lg border-2 shadow-sm bg-white text-center"
              style={{ borderColor: "var(--color-primary)" }}
            >
              <p className="text-sm text-gray-600">My Community Points</p>
              <p className="text-2xl font-bold" style={{ color: "var(--color-primary)" }}>{points} points</p>
              <Link
                href="/my-community/points"
                className="text-sm font-medium hover:underline underline-offset-2"
                style={{ color: "var(--color-primary)" }}
              >
                View Community Points
              </Link>
            </div>
          )}
          <div
            className="rounded-lg overflow-hidden border-2 shadow-sm w-full flex-1 min-h-0"
            style={{ borderColor: "var(--color-primary)" }}
          >
            <div className="border-b px-3 py-2 text-center" style={{ borderColor: "var(--color-primary)", backgroundColor: "var(--color-primary)" }}>
              <h2 className="text-base font-bold text-white">Top 10 NWC Earners</h2>
              <p className="text-xs text-white/90 mt-0.5">Members supporting local businesses and earning the most Community Points.</p>
            </div>
            <ol className="divide-y text-sm bg-white" style={{ borderColor: "var(--color-primary)" }}>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => {
                const m = top10Leaderboard[num - 1];
                return (
                  <li
                    key={m?.id ?? `empty-${num}`}
                    className="flex items-center gap-2 px-3 py-2 border-t border-gray-100 first:border-t-0"
                  >
                    <span className="w-5 shrink-0 font-semibold tabular-nums" style={{ color: "var(--color-primary)" }}>
                      {num}.
                    </span>
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      {m ? (
                        <>
                          {m.profilePhotoUrl ? (
                            <img src={m.profilePhotoUrl} alt="" className="w-7 h-7 rounded-full object-cover shrink-0" />
                          ) : (
                            <div className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-gray-500 text-xs font-medium bg-gray-100" style={{ color: "var(--color-primary)" }}>
                              {(m.firstName?.[0] ?? "?") + (m.lastName?.[0] ?? "")}
                            </div>
                          )}
                          <span className="font-medium truncate text-gray-900">{m.firstName} {m.lastName}</span>
                        </>
                      ) : (
                        <>
                          <div className="w-7 h-7 rounded-full bg-gray-100 shrink-0" />
                          <span className="text-gray-400 truncate">—</span>
                        </>
                      )}
                    </div>
                    <span className="font-semibold tabular-nums shrink-0 min-w-[2rem] text-right" style={{ color: m ? "var(--color-primary)" : undefined }}>
                      {m ? m.points : "—"}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>

        {/* Top 10 Rewards - prizes for top 10 supporters */}
        <div
          className="rounded-lg overflow-hidden border-2 shadow-sm w-full lg:max-w-[364px] lg:flex-1 flex flex-col min-h-0"
          style={{ borderColor: "var(--color-primary)" }}
        >
          <div className="border-b px-3 py-2 text-center" style={{ borderColor: "var(--color-primary)", backgroundColor: "var(--color-primary)" }}>
            <h2 className="text-base font-bold text-white">Top 10 Rewards</h2>
            <p className="text-xs text-white/90 mt-0.5">The Top 10 prizes awarded to the top 10 supporters of locally owned businesses.</p>
          </div>
          <div className="flex-1 overflow-y-auto bg-white divide-y divide-gray-100">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((rank) => {
              const p = top5?.prizes?.find((x) => x.rank === rank);
              const hasContent = p && (p.label?.trim() || p.imageUrl);
              return (
                <div key={rank} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="w-6 shrink-0 font-semibold tabular-nums" style={{ color: "var(--color-primary)" }}>
                    #{rank}
                  </span>
                  {hasContent ? (
                    <>
                      {p!.imageUrl ? (
                        <img src={p!.imageUrl} alt="" className="w-10 h-10 rounded object-cover shrink-0" />
                      ) : (
                        <div className="w-10 h-10 rounded bg-gray-100 shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate">{p!.label?.trim() || "—"}</p>
                        {p!.business && (
                          <Link
                            href={`/support-local/${p!.business.slug}`}
                            className="text-xs truncate block"
                            style={{ color: "var(--color-primary)" }}
                          >
                            {p!.business.name}
                          </Link>
                        )}
                      </div>
                    </>
                  ) : (
                    <span className="text-gray-400 flex-1">—</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Top 5 Supporters section */}
      {top5?.enabled && (
        <section className="mb-12">
          <h2 className="text-xl font-bold mb-4">Top 5 Supporters&apos; Rewards</h2>
          <p className="text-gray-600 mb-4">
            Whoever collects the most Community Points by the end of the period wins these prizes. Support local to climb the leaderboard!
          </p>
          {top5.startDate && top5.endDate && (
            <p className="text-sm text-gray-500 mb-4">
              Period: {new Date(top5.startDate).toLocaleDateString()} – {new Date(top5.endDate).toLocaleDateString()}
            </p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
            {(top5.prizes ?? []).map((prize) => (
              <div key={prize.rank} className="border rounded-lg p-4 bg-white">
                <p className="text-xs font-semibold text-gray-500 mb-2">#{prize.rank} Prize</p>
                {prize.imageUrl ? (
                  <img src={prize.imageUrl} alt={prize.label} className="w-full h-24 object-cover rounded mb-2" />
                ) : (
                  <div className="w-full h-24 bg-gray-100 rounded flex items-center justify-center text-gray-400 text-sm mb-2">
                    No image
                  </div>
                )}
                <p className="font-medium">{prize.label || "TBD"}</p>
                {prize.business && (
                  <Link
                    href={`/support-local/${prize.business.slug}`}
                    className="text-sm text-primary-600 hover:underline"
                  >
                    {prize.business.name}
                  </Link>
                )}
              </div>
            ))}
          </div>
          <h3 className="text-lg font-semibold mb-3">Current leaderboard</h3>
          <ol className="list-decimal list-inside space-y-2 border rounded-lg p-4 bg-gray-50">
            {leaderboard.length === 0 ? (
              <li className="text-gray-500">No points yet. Start supporting local to earn points!</li>
            ) : (
              leaderboard.map((m) => (
                <li key={m.id} className="flex items-center gap-2">
                  <span className="font-medium">
                    {m.firstName} {m.lastName}
                  </span>
                  <span className="text-gray-600">— {m.points} points</span>
                </li>
              ))
            )}
          </ol>
        </section>
      )}

      {/* Redeemable rewards section */}
      <section>
        <h2 className="text-xl font-bold mb-4">Redeem with Points</h2>
        <p className="text-gray-600 mb-6">
          Local businesses offer these rewards. Redeem them with your Community Points.
        </p>
        {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
        {rewards.length === 0 ? (
          <p className="text-gray-500">No rewards available right now. Check back soon!</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {rewards.map((r) => {
              const canRedeem = session?.user && points !== null && points >= r.pointsRequired;
              const remaining = r.redemptionLimit - r.timesRedeemed;
              return (
                <div key={r.id} className="border-2 border-[var(--color-primary)] rounded-lg p-4 transition">
                  {r.imageUrl ? (
                    <img src={r.imageUrl} alt={r.title} className="w-full h-32 object-cover rounded mb-3" />
                  ) : (
                    <div className="w-full h-32 bg-gray-100 rounded flex items-center justify-center text-gray-400 text-sm mb-3">
                      No image
                    </div>
                  )}
                  <h3 className="font-bold text-lg">{r.title}</h3>
                  <Link href={`/support-local/${r.business.slug}`} className="text-sm text-primary-600 hover:underline">
                    {r.business.name}
                  </Link>
                  {r.description && <p className="text-sm text-gray-600 mt-2 line-clamp-2">{r.description}</p>}
                  <p className="text-sm font-medium mt-2">
                    {r.pointsRequired} points · {remaining} left
                  </p>
                  <div className="flex gap-2 mt-3">
                    {session?.user ? (
                      <>
                        <button
                          onClick={() => handleRedeem(r.id)}
                          disabled={!canRedeem || redeeming === r.id}
                          className="btn flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {redeeming === r.id ? "Redeeming…" : canRedeem ? "Redeem" : `Need ${r.pointsRequired - (points ?? 0)} more points`}
                        </button>
                        <ShareButton type="reward" id={r.id} title={r.title} className="inline-flex p-2 rounded border border-gray-300 bg-white hover:bg-gray-50 shrink-0" />
                      </>
                    ) : (
                      <Link href="/login?callbackUrl=/rewards" className="btn w-full inline-block text-center">
                        Sign in to redeem
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
