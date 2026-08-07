"use client";

import Link from "next/link";
import { IonIcon } from "@/components/IonIcon";
import { CreatePostButton } from "@/components/CreatePostButton";
import { type FeedFilterId } from "@/lib/feed-types";

export function FeedEmptyState({
  isGuest,
  activeFilter = "all",
  onPostCreated,
}: {
  isGuest: boolean;
  activeFilter?: FeedFilterId;
  onPostCreated?: () => void;
}) {
  const filterCopy: Record<
    FeedFilterId,
    { title: string; body: string; primary?: { href: string; label: string; icon: string } }
  > = {
    all: {
      title: isGuest ? "No public posts yet" : "Your feed is empty",
      body: isGuest
        ? "Sign in to see posts from friends, groups, and businesses in your community."
        : "Follow businesses, join groups, or create a post to start building your personalized feed.",
    },
    friends: {
      title: "No friend posts yet",
      body: "Connect with people you know to see their posts here.",
      primary: { href: "/my-community/friends", label: "Find friends", icon: "people-outline" },
    },
    groups: {
      title: "No group posts yet",
      body: "Join a group to see discussions from your communities.",
      primary: { href: "/my-community/groups", label: "Browse groups", icon: "people-circle-outline" },
    },
    businesses: {
      title: "No business posts yet",
      body: "Follow local businesses to see their updates in your feed.",
      primary: { href: "/support-local", label: "Support local", icon: "storefront-outline" },
    },
    trending: {
      title: "Nothing trending right now",
      body: "Check back later or browse all posts.",
    },
  };

  const copy = filterCopy[activeFilter] ?? filterCopy.all;

  return (
    <div className="flex flex-col items-center text-center py-10 px-4">
      <IonIcon name="chatbubbles-outline" size={64} className="text-[var(--color-primary)] opacity-60 mb-3" />
      <h2 className="text-xl font-bold text-[var(--color-heading)]">{copy.title}</h2>
      <p className="text-gray-600 mt-2 max-w-md text-sm leading-relaxed">{copy.body}</p>
      {isGuest ? (
        <Link
          href="/login?callbackUrl=/my-community/feed"
          className="mt-6 inline-flex items-center gap-2 rounded-lg px-5 py-3 text-sm font-semibold text-white bg-[var(--color-primary)]"
        >
          Sign in to get started
        </Link>
      ) : (
        <div className="mt-6 flex flex-col gap-2.5 w-full max-w-xs">
          {copy.primary ? (
            <Link
              href={copy.primary.href}
              className="inline-flex items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold text-white bg-[var(--color-primary)]"
            >
              <IonIcon name={copy.primary.icon} size={18} />
              {copy.primary.label}
            </Link>
          ) : (
            <>
              <Link
                href="/support-local"
                className="inline-flex items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold text-white bg-[var(--color-primary)]"
              >
                <IonIcon name="storefront-outline" size={18} />
                Find businesses
              </Link>
              <Link
                href="/my-community/groups"
                className="inline-flex items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold text-white bg-[var(--color-primary)]"
              >
                <IonIcon name="people-outline" size={18} />
                Join a group
              </Link>
            </>
          )}
          <CreatePostButton
            returnTo="/my-community/feed"
            onAfterSuccess={onPostCreated}
            className="inline-flex items-center justify-center gap-2 rounded-lg border-2 border-[var(--color-primary)] px-4 py-2.5 text-sm font-semibold text-[var(--color-primary)] bg-white hover:bg-[var(--color-section-alt)]"
          >
            <IonIcon name="create-outline" size={18} />
            Create your first post
          </CreatePostButton>
        </div>
      )}
    </div>
  );
}
