"use client";

import Link from "next/link";
import { IonIcon } from "@/components/IonIcon";
import { CreatePostButton } from "@/components/CreatePostButton";
import { CARD_RADIUS, CARD_SHADOW } from "@/components/ui/card-styles";
import { FEED_FILTERS, type FeedFilterId } from "@/lib/feed-types";

const FEED_ACTION_BORDER = "#c99d5f";

type FeedHeaderBoxProps = {
  isGuest: boolean;
  pendingFriendRequests: number;
  activeFilter: FeedFilterId;
  onFilterChange: (id: FeedFilterId) => void;
  interactionsEnabled: boolean;
  onRequireUgc?: () => void;
  onPostCreated?: () => void;
};

export function FeedHeaderBox({
  isGuest,
  pendingFriendRequests,
  activeFilter,
  onFilterChange,
  interactionsEnabled,
  onRequireUgc,
  onPostCreated,
}: FeedHeaderBoxProps) {
  const friendsHref = isGuest
    ? "/login?callbackUrl=/my-community/friends"
    : "/my-community/friends";
  const groupsHref = isGuest
    ? "/login?callbackUrl=/my-community/groups"
    : "/my-community/groups";

  function guardCreate(e: React.MouseEvent) {
    if (interactionsEnabled) return;
    e.preventDefault();
    onRequireUgc?.();
  }

  return (
    <div
      className={`${CARD_RADIUS} ${CARD_SHADOW} border-2 border-[var(--color-primary)] bg-white overflow-hidden mb-6`}
    >
      <div className="px-4 py-4 bg-gradient-to-r from-[#f6f1eb] to-white border-b border-[var(--color-primary)]/15 text-center">
        <h1 className="text-2xl font-bold text-[var(--color-heading)]">Northwest Community Feed</h1>
        <p className="text-gray-600 text-sm md:text-base mt-2 max-w-lg mx-auto">
          {isGuest ? (
            <>
              Browse recent posts.{" "}
              <Link
                href="/login?callbackUrl=/my-community/feed"
                className="underline font-medium"
                style={{ color: "var(--color-link)" }}
              >
                Sign in
              </Link>{" "}
              to like, comment, and save.
            </>
          ) : (
            "Posts from people you follow and groups you've joined."
          )}
        </p>
      </div>

      <div className="px-4 py-3 flex items-stretch gap-2.5">
        <Link
          href={friendsHref}
          className="relative shrink-0 flex flex-col items-center justify-center min-w-[52px] px-1 py-2 rounded-md border-2 text-white text-[10px] font-semibold lg:hidden"
          style={{ backgroundColor: "var(--color-primary)", borderColor: FEED_ACTION_BORDER }}
        >
          <IonIcon name="people-outline" size={22} className="text-white" />
          Friends
          {pendingFriendRequests > 0 && (
            <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-white border-2 border-[var(--color-primary)] text-[var(--color-primary)] text-xs font-bold flex items-center justify-center">
              !
            </span>
          )}
        </Link>

        <div className="flex-1 min-w-0" onClickCapture={guardCreate}>
          {isGuest ? (
            <Link
              href="/login?callbackUrl=/my-community/feed"
              className="flex h-full items-center justify-center rounded-md border-2 py-3 text-base font-semibold text-white"
              style={{ backgroundColor: "var(--color-primary)", borderColor: FEED_ACTION_BORDER }}
            >
              Sign in
            </Link>
          ) : (
            <CreatePostButton
              returnTo="/my-community/feed"
              onAfterSuccess={onPostCreated}
              className="flex h-full w-full items-center justify-center rounded-md border-2 border-[#c99d5f] py-3 text-base font-semibold text-white !bg-[var(--color-primary)] hover:!opacity-90"
            >
              Create Post
            </CreatePostButton>
          )}
        </div>

        <Link
          href={groupsHref}
          className="shrink-0 flex flex-col items-center justify-center min-w-[52px] px-1 py-2 rounded-md border-2 text-white text-[10px] font-semibold lg:hidden"
          style={{ backgroundColor: "var(--color-primary)", borderColor: FEED_ACTION_BORDER }}
        >
          <IonIcon name="people-circle-outline" size={22} className="text-white" />
          Groups
        </Link>
      </div>

      <div
        className="px-4 pb-4 flex gap-2 overflow-x-auto scrollbar-hide"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        {FEED_FILTERS.map((filter) => {
          const isActive = activeFilter === filter.id;
          return (
            <button
              key={filter.id}
              type="button"
              onClick={() => onFilterChange(filter.id)}
              className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition shadow-sm ${
                isActive
                  ? "bg-[var(--color-primary)] text-white"
                  : "border border-[var(--color-primary)]/40 bg-[#faf8f5] text-[var(--color-primary)] hover:bg-[var(--color-section-alt)]"
              }`}
            >
              {filter.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
