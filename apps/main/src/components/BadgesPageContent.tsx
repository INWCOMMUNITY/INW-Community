"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { BadgeCard } from "@/components/BadgeCard";
import { getBadgeCategoryLabel } from "@/lib/badge-icons";

const CATEGORY_ORDER = ["member", "business", "seller", "event", "other"];

interface Badge {
  id: string;
  slug: string;
  name: string;
  description: string;
  imageUrl: string | null;
  category: string;
  order: number;
}

interface MemberBadge {
  id: string;
  badgeId: string;
  badge: Badge;
}

interface BusinessBadge {
  id: string;
  badgeId: string;
  badge: Badge;
}

interface BadgesPageContentProps {
  allBadges: Badge[];
}

export function BadgesPageContent({ allBadges }: BadgesPageContentProps) {
  const searchParams = useSearchParams();
  const { data: session, status } = useSession();
  const [memberBadges, setMemberBadges] = useState<MemberBadge[]>([]);
  const [businessBadges, setBusinessBadges] = useState<BusinessBadge[]>([]);
  const [loading, setLoading] = useState(true);
  const viewParam = searchParams.get("view");
  const [view, setView] = useState<"all" | "my">(viewParam === "my" ? "my" : "all");

  useEffect(() => {
    if (viewParam === "my") setView("my");
  }, [viewParam]);

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

  const earnedBadgeIds = new Set([
    ...memberBadges.map((mb) => mb.badgeId),
    ...businessBadges.map((bb) => bb.badgeId),
  ]);

  const myBadges = allBadges.filter((b) => earnedBadgeIds.has(b.id));

  const groupByCategory = (badges: Badge[]) => {
    const groups: Record<string, Badge[]> = {};
    for (const b of badges) {
      const cat = b.category?.toLowerCase?.() || "other";
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(b);
    }
    for (const cat of CATEGORY_ORDER) {
      if (groups[cat]) {
        groups[cat].sort((a, b) => a.order - b.order);
      }
    }
    return groups;
  };

  const displayBadges = view === "my" ? myBadges : allBadges;
  const grouped = groupByCategory(displayBadges);

  const sortedCategories = CATEGORY_ORDER.filter((c) => grouped[c]?.length);

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1
            className="text-3xl font-bold mb-2"
            style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}
          >
            Badges
          </h1>
          <p className="text-gray-600 max-w-2xl">
            Earn badges by participating in Northwest Community. Here are all the badges you can unlock.
          </p>
        </div>
        {status === "authenticated" && (
          <div className="flex gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setView("all")}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                view === "all"
                  ? "bg-[var(--color-primary)] text-white"
                  : "bg-gray-200 text-gray-700 hover:bg-gray-300"
              }`}
            >
              All Badges
            </button>
            <button
              type="button"
              onClick={() => setView("my")}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                view === "my"
                  ? "bg-[var(--color-primary)] text-white"
                  : "bg-gray-200 text-gray-700 hover:bg-gray-300"
              }`}
            >
              My Badges
            </button>
          </div>
        )}
      </div>

      {status === "unauthenticated" && (
        <p className="text-gray-600 mb-6">
          <Link href={`/login?callbackUrl=${encodeURIComponent("/badges")}`} className="underline" style={{ color: "var(--color-primary)" }}>
            Sign in
          </Link>{" "}
          to see your earned badges.
        </p>
      )}

      {view === "my" && status === "authenticated" && !loading && myBadges.length === 0 && (
        <p className="text-gray-600 py-12 text-center">
          You haven&apos;t earned any badges yet. Keep participating to unlock them!
        </p>
      )}

      {(view === "all" || (view === "my" && myBadges.length > 0)) && (
        <div className="space-y-8">
          {sortedCategories.map((category) => (
            <div key={category}>
              <h2
                className="text-xl font-bold mb-4"
                style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}
              >
                {getBadgeCategoryLabel(category)}
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {grouped[category]?.map((b) => (
                  <BadgeCard key={b.id} badge={b} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-10">
        <Link
          href="/my-community"
          className="text-sm font-medium"
          style={{ color: "var(--color-primary)" }}
        >
          ← Back to My Community
        </Link>
      </div>
    </div>
  );
}
