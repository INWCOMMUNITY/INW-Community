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
  prizeValue?: string | null;
  description?: string | null;
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
  const [seasonPointsEarned, setSeasonPointsEarned] = useState<number | null>(null);
  const [currentSeason, setCurrentSeason] = useState<{ id: string; name: string } | null>(null);
  const [savedRewardIds, setSavedRewardIds] = useState<Set<string>>(new Set());
  const [redeeming, setRedeeming] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [selectedRewardForModal, setSelectedRewardForModal] = useState<Reward | null>(null);

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
        .then((d) => {
          setPoints(d?.points ?? 0);
          setSeasonPointsEarned(d?.seasonPointsEarned ?? 0);
          setCurrentSeason(d?.currentSeason ?? null);
        })
        .catch(() => {
          setPoints(null);
          setSeasonPointsEarned(null);
          setCurrentSeason(null);
        });
      fetch("/api/saved?type=reward")
        .then((r) => r.json())
        .then((items: { referenceId: string }[]) => {
          setSavedRewardIds(new Set(Array.isArray(items) ? items.map((i) => i.referenceId) : []));
        })
        .catch(() => setSavedRewardIds(new Set()));
    } else {
      setPoints(null);
      setSeasonPointsEarned(null);
      setCurrentSeason(null);
      setSavedRewardIds(new Set());
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

  async function toggleSaved(rewardId: string, currentlySaved: boolean) {
    setSavedRewardIds((prev) => {
      const next = new Set(prev);
      if (currentlySaved) next.delete(rewardId);
      else next.add(rewardId);
      return next;
    });
    try {
      if (currentlySaved) {
        await fetch(`/api/saved?type=reward&referenceId=${encodeURIComponent(rewardId)}`, { method: "DELETE" });
      } else {
        await fetch("/api/saved", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "reward", referenceId: rewardId }),
        });
      }
    } catch {
      setSavedRewardIds((prev) => {
        const next = new Set(prev);
        if (currentlySaved) next.add(rewardId);
        else next.delete(rewardId);
        return next;
      });
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
      <section className="mb-12 grid grid-cols-1 lg:grid-cols-[364px_1fr] gap-6">
        {/* Row 1 - Top boxes: same design and height */}
        <div
          className="p-4 rounded-lg border-2 shadow-sm bg-white text-center min-h-[7rem] flex flex-col justify-center order-1"
          style={{ borderColor: "var(--color-primary)" }}
        >
          {session?.user && points !== null ? (
            <>
              <p className="text-sm text-gray-600">My Community Points</p>
              <p className="text-2xl font-bold" style={{ color: "var(--color-primary)" }}>{points} points</p>
              {currentSeason != null && seasonPointsEarned != null && (
                <p className="text-sm text-gray-600 mt-1">{currentSeason.name}: {seasonPointsEarned} Points</p>
              )}
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
                <Link
                  href="/my-community/points"
                  className="text-sm font-medium hover:underline underline-offset-2"
                  style={{ color: "var(--color-primary)" }}
                >
                  View Community Points
                </Link>
                <Link
                  href="/my-community/my-rewards"
                  className="text-sm font-medium hover:underline underline-offset-2"
                  style={{ color: "var(--color-primary)" }}
                >
                  My Rewards
                </Link>
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-600">Sign in to see your Community Points</p>
          )}
        </div>
        <div
          className="p-4 rounded-lg border-2 shadow-sm bg-white text-center min-h-[7rem] flex flex-col justify-center order-3 lg:order-2"
          style={{ borderColor: "var(--color-primary)" }}
        >
          <h2 className="text-base font-bold" style={{ color: "var(--color-primary)" }}>Top 10 Rewards</h2>
          <p className="text-xs text-gray-600 mt-0.5">The Top 10 prizes awarded to the top 10 supporters of locally owned businesses.</p>
          <p className="text-xs text-gray-600 mt-1">The Top 10 NWC Earners will get to pick their desired prize starting with 1st Place. Support Local Businesses and get in the Top 10!</p>
        </div>

        {/* Row 2 - Bottom boxes: green headers same height, 1-10 rows aligned */}
        <div
          className="rounded-lg overflow-hidden border-2 shadow-sm flex flex-col order-2 lg:order-3"
          style={{ borderColor: "var(--color-primary)" }}
        >
          <div
            className="border-b px-3 py-3 text-center shrink-0 flex flex-col justify-center h-[5rem]"
            style={{ borderColor: "var(--color-primary)", backgroundColor: "var(--color-primary)" }}
          >
            <h2 className="text-base font-bold text-white">Top 10 NWC Earners{currentSeason ? " (Season)" : ""}</h2>
            <p className="text-xs text-white/90 mt-0.5">Members supporting local businesses and earning the most Community Points{currentSeason ? " this season" : ""}.</p>
          </div>
          <ol className="divide-y text-sm bg-white" style={{ borderColor: "var(--color-primary)" }}>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => {
              const m = top10Leaderboard[num - 1];
              return (
                <li
                  key={m?.id ?? `empty-${num}`}
                  className="flex items-center gap-2 px-3 py-2.5 h-[2.75rem] min-h-[2.75rem] border-t border-gray-100 first:border-t-0"
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

        {/* Table: green header matches left, 1-10 rows aligned exactly with left box */}
        <div
          className="rounded-lg overflow-hidden border-2 shadow-sm flex flex-col order-4"
          style={{ borderColor: "var(--color-primary)" }}
        >
          <div className="overflow-x-auto bg-white">
            <table className="w-full text-sm min-w-[400px]">
              <thead>
                <tr style={{ backgroundColor: "var(--color-primary)", color: "white" }}>
                  <th className="px-3 py-3 font-semibold h-[5rem] align-middle text-center">Reward</th>
                  <th className="px-3 py-3 font-semibold h-[5rem] align-middle text-center">Offered By</th>
                  <th className="px-3 py-3 font-semibold h-[5rem] align-middle text-center">Prize Value</th>
                  <th className="px-3 py-3 font-semibold h-[5rem] align-middle text-center">Days Left</th>
                </tr>
              </thead>
              <tbody>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((rank) => {
                  const p = top5?.prizes?.find((x) => x.rank === rank);
                  const hasContent = p && (p.label?.trim() || p.imageUrl || p.prizeValue || p.description);
                  const daysLeft = top5?.endDate
                    ? Math.max(0, Math.ceil((new Date(top5.endDate).getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
                    : null;
                  return (
                    <tr key={rank} className="border-b border-gray-100">
                      <td className="px-3 py-2.5 align-middle h-[2.75rem] min-h-[2.75rem]">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold tabular-nums shrink-0" style={{ color: "var(--color-primary)" }}>
                            #{rank}
                          </span>
                          {hasContent ? (
                            <div className="min-w-0 truncate overflow-hidden">
                              <p className="font-medium truncate">{p!.label?.trim() || "—"}</p>
                              {p!.description?.trim() && <p className="text-xs text-gray-600 mt-0.5 truncate">{p!.description.trim()}</p>}
                            </div>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 align-middle h-[2.75rem] text-center">
                        {hasContent && p!.business ? (
                          <Link
                            href={`/support-local/${p!.business.slug}`}
                            className="font-medium hover:underline truncate block"
                            style={{ color: "var(--color-primary)" }}
                          >
                            {p!.business.name}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-gray-700 align-middle h-[2.75rem] text-center">{hasContent && p!.prizeValue ? p!.prizeValue : "—"}</td>
                      <td className="px-3 py-2.5 tabular-nums text-gray-700 align-middle h-[2.75rem] text-center">
                        {daysLeft !== null ? daysLeft : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <h2 className="text-xl font-bold">Redeem with Points</h2>
          {session?.user && (
            <Link
              href="/my-community/my-rewards"
              className="text-sm font-semibold hover:underline"
              style={{ color: "var(--color-primary)" }}
            >
              My Rewards
            </Link>
          )}
        </div>
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
              const isSaved = savedRewardIds.has(r.id);
              return (
                <div key={r.id} className="border-2 border-[var(--color-primary)] rounded-lg p-4 transition relative">
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setSelectedRewardForModal(r)}
                      className="w-full text-left block rounded mb-3 overflow-hidden focus:ring-2 focus:ring-offset-1 focus:ring-[var(--color-primary)]"
                    >
                      {r.imageUrl ? (
                        <img src={r.imageUrl} alt={r.title} className="w-full h-32 object-cover" />
                      ) : (
                        <div className="w-full h-32 bg-gray-100 rounded flex items-center justify-center text-gray-400 text-sm">
                          No image
                        </div>
                      )}
                    </button>
                    {session?.user && (
                      <button
                        type="button"
                        onClick={() => toggleSaved(r.id, isSaved)}
                        className="absolute top-1 right-1 p-1.5 rounded-full bg-white/90 border border-gray-200 hover:bg-white shadow-sm"
                        aria-label={isSaved ? "Remove from liked" : "Like reward"}
                        title={isSaved ? "Remove from liked" : "Save reward"}
                      >
                        <span className={isSaved ? "text-red-500" : "text-gray-400"} style={{ fontSize: "1.25rem" }}>{isSaved ? "♥" : "♡"}</span>
                      </button>
                    )}
                  </div>
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
                        Sign in to Redeem
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Reward detail modal: photo click opens centered popup with details, save, share */}
      {selectedRewardForModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={() => setSelectedRewardForModal(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Reward details"
        >
          <div
            className="bg-white rounded-xl shadow-xl max-w-md w-full max-h-[90vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <h3 className="text-lg font-bold truncate flex-1 pr-2">{selectedRewardForModal.title}</h3>
              <button
                type="button"
                onClick={() => setSelectedRewardForModal(null)}
                className="p-2 rounded hover:bg-gray-100 text-gray-600"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="overflow-y-auto flex-1">
              <div className="aspect-square bg-gray-100">
                {selectedRewardForModal.imageUrl ? (
                  <img
                    src={selectedRewardForModal.imageUrl}
                    alt={selectedRewardForModal.title}
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-400">No image</div>
                )}
              </div>
              <div className="p-4">
                <Link
                  href={`/support-local/${selectedRewardForModal.business.slug}`}
                  className="text-sm font-medium hover:underline"
                  style={{ color: "var(--color-primary)" }}
                >
                  {selectedRewardForModal.business.name}
                </Link>
                {selectedRewardForModal.description && (
                  <p className="text-sm text-gray-600 mt-2">{selectedRewardForModal.description}</p>
                )}
                <p className="text-sm font-medium mt-2">
                  {selectedRewardForModal.pointsRequired} points ·{" "}
                  {selectedRewardForModal.redemptionLimit - selectedRewardForModal.timesRedeemed} left
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-4 border-t border-gray-200">
              {session?.user && (
                <button
                  type="button"
                  onClick={() => toggleSaved(selectedRewardForModal.id, savedRewardIds.has(selectedRewardForModal.id))}
                  className="inline-flex items-center gap-1.5 p-2 rounded border border-gray-300 bg-white hover:bg-gray-50"
                  title={savedRewardIds.has(selectedRewardForModal.id) ? "Remove from saved" : "Save reward"}
                >
                  <span className={savedRewardIds.has(selectedRewardForModal.id) ? "text-red-500" : "text-gray-400"} style={{ fontSize: "1.25rem" }}>
                    {savedRewardIds.has(selectedRewardForModal.id) ? "♥" : "♡"}
                  </span>
                  <span className="text-sm">{savedRewardIds.has(selectedRewardForModal.id) ? "Saved" : "Save"}</span>
                </button>
              )}
              <ShareButton
                type="reward"
                id={selectedRewardForModal.id}
                title={selectedRewardForModal.title}
                className="flex-1 inline-flex items-center justify-center gap-2 p-2.5 rounded border border-gray-300 bg-white hover:bg-gray-50"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
