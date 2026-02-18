"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { getBadgeIcon } from "@/lib/badge-icons";

export default function MyBadgesPage() {
  const { data: session, status } = useSession();
  const [memberBadges, setMemberBadges] = useState<Array<{
    id: string;
    badgeId: string;
    displayOnProfile: boolean;
    badge: { id: string; slug: string; name: string; description: string };
  }>>([]);
  const [businessBadges, setBusinessBadges] = useState<Array<{
    id: string;
    badgeId: string;
    displayOnPage: boolean;
    badge: { id: string; slug: string; name: string; description: string };
  }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status !== "authenticated" || !session?.user?.id) {
      setLoading(false);
      return;
    }
    fetch("/api/me/badges")
      .then((r) => r.json())
      .then((data) => {
        setMemberBadges(data?.memberBadges ?? []);
        setBusinessBadges(data?.businessBadges ?? []);
      })
      .catch(() => {
        setMemberBadges([]);
        setBusinessBadges([]);
      })
      .finally(() => setLoading(false));
  }, [session?.user?.id, status]);

  const toggleMemberDisplay = async (badgeId: string, displayOnProfile: boolean) => {
    try {
      const res = await fetch("/api/me/badges", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ badgeId, displayOnProfile }),
      });
      if (!res.ok) return;
      setMemberBadges((prev) =>
        prev.map((mb) => (mb.badgeId === badgeId ? { ...mb, displayOnProfile } : mb))
      );
    } catch {}
  };

  if (status === "loading" || loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin w-8 h-8 border-2 border-gray-300 border-t-[var(--color-primary)] rounded-full" />
      </div>
    );
  }

  if (status === "unauthenticated") {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-4" style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}>
          My Badges
        </h1>
        <p className="text-gray-600 mb-4">Sign in to see the badges you&apos;ve earned.</p>
        <Link
          href={`/login?callbackUrl=${encodeURIComponent("/my-community/my-badges")}`}
          className="btn inline-block"
        >
          Sign In
        </Link>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4" style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}>
        My Badges
      </h1>
      <p className="text-gray-600 mb-6">
        Toggle which badges to display on your profile, seller page, or business page.
      </p>
      <Link href="/badges" className="text-sm font-medium mb-6 inline-block" style={{ color: "var(--color-primary)" }}>
        View all Community Badges →
      </Link>

      {memberBadges.length > 0 && (
        <div className="mb-8">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
            My badges (profile)
          </h2>
          <div className="space-y-4">
            {memberBadges.map((mb) => {
            const BadgeIcon = getBadgeIcon(mb.badge.slug ?? "");
            return (
              <div
                key={mb.id}
                className="border-2 rounded-lg p-4 bg-gray-50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                style={{ borderColor: "var(--color-primary)" }}
              >
                <div className="flex gap-3">
                  <div
                    className="w-12 h-12 rounded-full flex items-center justify-center shrink-0"
                    style={{ backgroundColor: "#FDEDCC", color: "var(--color-primary)" }}
                  >
                    <BadgeIcon className="shrink-0" style={{ width: 24, height: 24 }} />
                  </div>
                  <div>
                    <h3 className="font-semibold" style={{ color: "var(--color-heading)" }}>
                      {mb.badge.name}
                    </h3>
                    <p className="text-gray-600 text-sm mt-1">{mb.badge.description}</p>
                  </div>
                </div>
                <label className="flex items-center gap-2 shrink-0 cursor-pointer">
                  <span className="text-sm text-gray-600">Show on profile</span>
                  <input
                    type="checkbox"
                    checked={mb.displayOnProfile}
                    onChange={(e) => toggleMemberDisplay(mb.badgeId, e.target.checked)}
                    className="rounded"
                  />
                </label>
              </div>
            );
          })}
          </div>
        </div>
      )}

      {businessBadges.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Business badges
          </h2>
          <div className="space-y-4">
{businessBadges.map((bb) => {
            const BadgeIcon = getBadgeIcon(bb.badge.slug ?? "");
            return (
              <div
                key={bb.id}
                className="border-2 rounded-lg p-4 bg-gray-50 flex gap-3"
                style={{ borderColor: "var(--color-primary)" }}
              >
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center shrink-0"
                  style={{ backgroundColor: "#FDEDCC", color: "var(--color-primary)" }}
                >
                  <BadgeIcon className="shrink-0" style={{ width: 24, height: 24 }} />
                </div>
                <div>
                  <h3 className="font-semibold" style={{ color: "var(--color-heading)" }}>
                    {bb.badge.name}
                  </h3>
                  <p className="text-gray-600 text-sm mt-1">{bb.badge.description}</p>
                </div>
              </div>
            );
          })}
          </div>
        </div>
      )}

      {memberBadges.length === 0 && businessBadges.length === 0 && (
        <>
          <p className="text-gray-600 text-center py-12">
            You haven&apos;t earned any badges yet. Keep participating to unlock them!
          </p>
          <p className="text-center">
            <Link href="/badges" className="text-sm font-medium" style={{ color: "var(--color-primary)" }}>
              See all Community Badges →
            </Link>
          </p>
        </>
      )}
    </div>
  );
}
