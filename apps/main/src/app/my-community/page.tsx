"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { BadgeIcon } from "@/lib/badge-icons";
import { IonIcon } from "@/components/IonIcon";

interface MemberProfile {
  id: string;
  firstName: string;
  lastName: string;
  profilePhotoUrl: string | null;
  city: string | null;
  bio: string | null;
  points: number | null;
}

interface MemberBadge {
  id: string;
  badge: { slug: string; name: string };
  displayOnProfile: boolean;
}

const PROFILE_BUTTONS = [
  { href: "/my-community/friends", label: "My Friends", icon: "people-outline" },
  { href: "/my-community/businesses", label: "My Businesses", icon: "business-outline" },
  { href: "/my-community/events", label: "My Events", icon: "calendar-outline" },
  { href: "/my-community/coupons", label: "My Coupons", icon: "pricetag-outline" },
  { href: "/my-community/wantlist", label: "My Wishlist", icon: "heart-outline" },
  { href: "/my-community/orders", label: "My Orders", icon: "receipt-outline" },
  { href: "/my-community/my-rewards", label: "My Rewards", icon: "gift-outline" },
  { href: "/my-community/my-badges", label: "My Badges", icon: "ribbon-outline" },
] as const;

export default function MyCommunityProfilePage() {
  const [member, setMember] = useState<MemberProfile | null>(null);
  const [badges, setBadges] = useState<MemberBadge[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/me", { credentials: "include" }).then((r) => r.json()),
      fetch("/api/me/badges", { credentials: "include" }).then((r) => r.json()),
    ])
      .then(([meData, badgesData]) => {
        if (meData?.id) {
          setMember({
            id: meData.id,
            firstName: meData.firstName ?? "",
            lastName: meData.lastName ?? "",
            profilePhotoUrl: meData.profilePhotoUrl ?? null,
            city: meData.city ?? null,
            bio: meData.bio ?? null,
            points: meData.points ?? 0,
          });
        }
        const list = (badgesData?.memberBadges ?? []).filter(
          (mb: MemberBadge) => mb.displayOnProfile
        );
        setBadges(list);
      })
      .catch(() => setMember(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <p className="text-gray-500">Loading…</p>;
  }

  if (!member) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-600 mb-4">Could not load your profile.</p>
        <Link href="/login?callbackUrl=/my-community" className="btn">
          Sign in
        </Link>
      </div>
    );
  }

  const initials = `${member.firstName?.[0] ?? ""}${member.lastName?.[0] ?? ""}`.toUpperCase() || "?";

  return (
    <div className="max-w-3xl mx-auto w-full">
      {/* Profile card - app-style green/white section */}
      <div className="bg-white rounded-lg border-2 border-[var(--color-primary)] p-6 mb-6">
        <div className="flex flex-col items-center text-center mb-6">
          <div className="mb-4">
            {member.profilePhotoUrl ? (
              <Image
                src={member.profilePhotoUrl}
                alt=""
                width={140}
                height={140}
                className="rounded-full object-cover w-[140px] h-[140px] border-2 border-[var(--color-primary)]"
              />
            ) : (
              <div className="w-[140px] h-[140px] rounded-full bg-gray-200 border-2 border-[var(--color-primary)] flex items-center justify-center text-4xl font-bold text-gray-600">
                {initials !== "?" ? initials : <IonIcon name="person-outline" size={56} />}
              </div>
            )}
          </div>
          <h1 className="text-xl font-semibold text-gray-900 truncate w-full">
            {member.firstName} {member.lastName}
          </h1>
          <p className="text-gray-600 text-base mt-0.5">{member.city || "City"}</p>
          <div className="w-full h-0.5 bg-[var(--color-primary)] my-4 max-w-lg mx-auto" />
          <p className="text-gray-700 text-sm leading-relaxed max-w-lg mx-auto whitespace-pre-wrap">
            {member.bio || "Add a bio in Edit Profile"}
          </p>
          <div className="w-full h-0.5 bg-[var(--color-primary)] my-4 max-w-lg mx-auto" />
        </div>

        <div className="mb-4">
          <div className="border-2 border-[var(--color-primary)] rounded-lg px-4 py-3 bg-white">
            <span className="text-sm font-medium text-gray-900">
              {member.points ?? 0} points
            </span>
          </div>
        </div>

        {badges.length > 0 && (
          <Link
            href="/my-community/my-badges"
            className="flex items-center justify-between border-2 border-[var(--color-primary)] rounded-lg px-4 py-3 mb-4 bg-white hover:opacity-90 transition"
          >
            <div className="flex items-center gap-2 flex-wrap">
              {badges.slice(0, 6).map((mb) => (
                <span
                  key={mb.id}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-[var(--color-primary)]"
                  style={{ backgroundColor: "color-mix(in srgb, var(--color-primary) 12%, white)" }}
                >
                  <BadgeIcon slug={mb.badge.slug} size={20} />
                </span>
              ))}
              {badges.length > 6 && (
                <span className="text-sm font-semibold text-[var(--color-primary)]">
                  +{badges.length - 6}
                </span>
              )}
            </div>
            <span className="text-sm font-semibold text-[var(--color-primary)] flex items-center gap-1">
              {badges.length} badge{badges.length !== 1 ? "s" : ""}
              <IonIcon name="chevron-forward" size={16} />
            </span>
          </Link>
        )}

        <Link
          href="/my-community/posts"
          className="flex items-center justify-between border-2 border-[var(--color-primary)] rounded-lg px-4 py-4 mb-6 bg-white hover:opacity-90 transition min-h-[80px]"
        >
          <span className="font-semibold text-gray-900">Posts + Photos</span>
          <IonIcon name="chevron-forward" size={20} className="text-gray-700" />
        </Link>

        <Link
          href="/my-community/profile"
          className="inline-block bg-[var(--color-primary)] text-white font-semibold py-2.5 px-5 rounded hover:opacity-90 transition"
        >
          Edit Profile
        </Link>
      </div>

      {/* Tan/cream section - profile action buttons (app-style) */}
      <div
        className="rounded-lg border-2 border-[var(--color-primary)] pt-6 pb-2 px-4"
        style={{ backgroundColor: "var(--color-section-alt)" }}
      >
        <div className="grid grid-cols-2 gap-4">
          {PROFILE_BUTTONS.map((btn) => (
            <Link
              key={btn.href}
              href={btn.href}
              className="flex items-center justify-center gap-2 bg-[var(--color-primary)] text-white font-semibold py-3 px-4 rounded-lg border-2 border-[var(--color-primary)] hover:opacity-90 transition"
            >
              <IonIcon name={btn.icon} size={22} />
              <span className="text-center text-sm sm:text-base">{btn.label}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
