"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { FeedPostCard } from "@/components/FeedPostCard";
import { CreatePostModal, type EditFeedPostPayload } from "@/components/CreatePostModal";
import { CouponPopup } from "@/components/CouponPopup";
import { FeedHeaderBox } from "@/components/feed/FeedHeaderBox";
import { FeedEmptyState } from "@/components/feed/FeedEmptyState";
import { FeedToast, type FeedToastPayload } from "@/components/feed/FeedToast";
import { FeedShareModal } from "@/components/feed/FeedShareModal";
import { FeedCommentsModal } from "@/components/feed/FeedCommentsModal";
import { ReportPostDialog } from "@/components/feed/ReportPostDialog";
import { CommunityUgcTermsModal } from "@/components/feed/CommunityUgcTermsModal";
import { SkeletonFeedPost } from "@/components/ui/Skeleton";
import { useCommunityFeed } from "@/hooks/useCommunityFeed";
import { type CommunityFeedPost, type FeedFilterId, parseFeedFilterId } from "@/lib/feed-types";
import { hasAcceptedUgcTerms, acceptUgcTerms } from "@/lib/ugc-terms-storage";

export function CommunityFeedPageClient({
  initialPosts,
  initialCursor,
}: {
  initialPosts?: CommunityFeedPost[];
  initialCursor?: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, status: sessionStatus } = useSession();
  const viewerUserId = (session?.user as { id?: string } | undefined)?.id ?? null;
  const isGuest = sessionStatus !== "loading" && !viewerUserId;

  const urlFilter = parseFeedFilterId(searchParams?.get("filter"));
  const [editPost, setEditPost] = useState<EditFeedPostPayload | null>(null);
  const [pendingFriendRequests, setPendingFriendRequests] = useState(0);
  const [ugcAccepted, setUgcAccepted] = useState(true);
  const [showUgcModal, setShowUgcModal] = useState(false);
  const [toast, setToast] = useState<FeedToastPayload | null>(null);
  const [sharePostId, setSharePostId] = useState<string | null>(null);
  const [commentPostId, setCommentPostId] = useState<string | null>(null);
  const [reportPostId, setReportPostId] = useState<string | null>(null);
  const [couponPopupId, setCouponPopupId] = useState<string | null>(null);
  const [viewerFriendIds, setViewerFriendIds] = useState<Set<string>>(new Set());
  const [guestBarDismissed, setGuestBarDismissed] = useState(false);

  const loadMoreRef = useRef<HTMLDivElement>(null);
  const feedTopRef = useRef<HTMLDivElement>(null);

  const [activeFilter, setActiveFilter] = useState<FeedFilterId>(urlFilter);

  const signedIn = !isGuest;
  const {
    posts,
    loading,
    loadingMore,
    nextCursor,
    newPostCount,
    setNewPostCount,
    refetch,
    loadMore,
    updatePost,
    removePost,
    removePostsByAuthor,
  } = useCommunityFeed(activeFilter, signedIn, { initialPosts, initialCursor });

  useEffect(() => {
    setActiveFilter(urlFilter);
  }, [urlFilter]);

  const setFilter = useCallback(
    (id: FeedFilterId) => {
      setActiveFilter(id);
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      if (id === "all") params.delete("filter");
      else params.set("filter", id);
      const q = params.toString();
      router.replace(q ? `/my-community/feed?${q}` : "/my-community/feed", { scroll: false });
    },
    [router, searchParams]
  );

  useEffect(() => {
    if (!isGuest) return;
    try {
      setGuestBarDismissed(sessionStorage.getItem("nwc_feed_guest_bar_dismissed") === "1");
    } catch {
      setGuestBarDismissed(false);
    }
  }, [isGuest]);

  useEffect(() => {
    if (isGuest) {
      setUgcAccepted(true);
      return;
    }
    const ok = hasAcceptedUgcTerms();
    setUgcAccepted(ok);
    setShowUgcModal(!ok);
  }, [isGuest, viewerUserId]);

  useEffect(() => {
    if (isGuest) {
      setPendingFriendRequests(0);
      setViewerFriendIds(new Set());
      return;
    }
    fetch("/api/friend-requests/count", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setPendingFriendRequests(typeof d.count === "number" ? d.count : 0))
      .catch(() => setPendingFriendRequests(0));
    fetch("/api/me/friends", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        const friends = Array.isArray(d?.friends) ? d.friends : Array.isArray(d) ? d : [];
        const ids = friends.map((f: { id?: string }) => f.id).filter(Boolean) as string[];
        setViewerFriendIds(new Set(ids));
      })
      .catch(() => setViewerFriendIds(new Set()));
  }, [isGuest]);

  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el || !nextCursor) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore();
      },
      { rootMargin: "200px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [nextCursor, loadMore]);

  const interactionsEnabled = isGuest || ugcAccepted;

  const requireUgc = useCallback(() => {
    if (!isGuest && !ugcAccepted) setShowUgcModal(true);
  }, [isGuest, ugcAccepted]);

  const guardAction = useCallback(
    (action: () => void) => {
      if (isGuest) return;
      if (!ugcAccepted) {
        setShowUgcModal(true);
        return;
      }
      action();
    },
    [isGuest, ugcAccepted]
  );

  async function toggleLike(postId: string) {
    guardAction(async () => {
      const prev = posts.find((p) => p.id === postId);
      if (!prev) return;
      const optimisticLiked = !prev.liked;
      updatePost(postId, {
        liked: optimisticLiked,
        likeCount: prev.likeCount + (optimisticLiked ? 1 : -1),
      });
      const res = await fetch(`/api/posts/${postId}/like`, { method: "POST", credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        updatePost(postId, {
          liked: data.liked,
          likeCount: prev.likeCount + (data.liked ? 1 : -1),
        });
      } else {
        updatePost(postId, { liked: prev.liked, likeCount: prev.likeCount });
        setToast({ message: "Could not update like." });
      }
    });
  }

  function openEditFeedPost(p: Parameters<typeof FeedPostCard>[0]["post"]) {
    setEditPost({
      id: p.id,
      content: p.content,
      photos: p.photos,
      videos: p.videos ?? [],
      tags: p.tags,
      groupId: p.groupId ?? null,
      type: p.type,
      sourceBusiness: p.sourceBusiness ? { id: p.sourceBusiness.id, name: p.sourceBusiness.name } : null,
    });
  }

  async function handleDeletePost(postId: string) {
    if (!window.confirm("Delete this post? This cannot be undone.")) return;
    guardAction(async () => {
      const res = await fetch(`/api/posts/${encodeURIComponent(postId)}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) {
        removePost(postId);
        setToast({ message: "Post deleted" });
      } else {
        const err = await res.json().catch(() => ({}));
        setToast({ message: (err as { error?: string }).error ?? "Failed to delete post." });
      }
    });
  }

  async function handleFollowAuthor(authorId: string) {
    guardAction(async () => {
      const affected = posts.filter((p) => p.author.id === authorId);
      const wasFollowing = affected[0]?.isFollowingAuthor ?? false;
      const nextFollowing = !wasFollowing;
      for (const p of affected) {
        updatePost(p.id, { isFollowingAuthor: nextFollowing });
      }
      const res = await fetch("/api/follow", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memberId: authorId,
          action: wasFollowing ? "unfollow" : "follow",
        }),
      });
      if (!res.ok) {
        for (const p of affected) {
          updatePost(p.id, { isFollowingAuthor: wasFollowing });
        }
        setToast({ message: "Could not update follow." });
      }
    });
  }

  async function handleSave(postId: string) {
    guardAction(async () => {
      const res = await fetch("/api/saved", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "post", referenceId: postId }),
      });
      if (res.ok) {
        setToast({
          message: "Post saved!",
          action: { label: "View saved", href: "/my-community/saved-posts" },
        });
      } else setToast({ message: "Could not save post." });
    });
  }

  function handleReport(postId: string) {
    guardAction(() => setReportPostId(postId));
  }

  async function handleBlockUser(memberId: string, postId: string) {
    if (memberId === viewerUserId) {
      setToast({ message: "You cannot block yourself." });
      return;
    }
    if (
      !window.confirm(
        "This user will be blocked. Their posts will be removed from your feed and they will not be able to message you."
      )
    ) {
      return;
    }
    guardAction(async () => {
      const res = await fetch("/api/members/block", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId }),
      });
      if (res.ok) {
        await fetch("/api/reports", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contentType: "post",
            contentId: postId,
            reason: "other",
            details: "User blocked by viewer",
          }),
        }).catch(() => {});
        removePostsByAuthor(memberId);
        setToast({ message: "User blocked." });
      } else {
        setToast({ message: "Could not block user." });
      }
    });
  }

  function handleNewPostsBanner() {
    setNewPostCount(0);
    void refetch();
    feedTopRef.current?.scrollIntoView({ behavior: "smooth" });
  }

  const commentPost = commentPostId ? posts.find((p) => p.id === commentPostId) : null;

  return (
    <div className="min-h-screen bg-[#f6f1eb] pb-10">
      <div ref={feedTopRef} className="max-w-2xl mx-auto w-full px-4 pt-4">
        {newPostCount > 0 && (
          <button
            type="button"
            onClick={handleNewPostsBanner}
            className="sticky top-[var(--site-header-height)] z-30 mb-3 w-full rounded-full bg-[var(--color-primary)] text-white py-2.5 text-sm font-semibold shadow-md hover:opacity-95"
            aria-live="polite"
          >
            {newPostCount} new post{newPostCount === 1 ? "" : "s"} — Tap to refresh
          </button>
        )}

        {isGuest && !guestBarDismissed && (
          <div
            className="mb-4 rounded-lg border px-4 py-3 flex flex-wrap items-center justify-between gap-3 bg-white"
            style={{ borderColor: "var(--color-primary)" }}
          >
            <p className="text-sm text-gray-700">
              <Link
                href="/login?callbackUrl=/my-community/feed"
                className="font-semibold underline"
                style={{ color: "var(--color-link)" }}
              >
                Sign in
              </Link>{" "}
              to like, comment, save, and share posts.
            </p>
            <button
              type="button"
              className="text-xs text-gray-500 hover:text-gray-800"
              onClick={() => {
                setGuestBarDismissed(true);
                try {
                  sessionStorage.setItem("nwc_feed_guest_bar_dismissed", "1");
                } catch {
                  /* ignore */
                }
              }}
            >
              Dismiss
            </button>
          </div>
        )}

        <FeedHeaderBox
          isGuest={isGuest}
          pendingFriendRequests={pendingFriendRequests}
          activeFilter={activeFilter}
          onFilterChange={setFilter}
          interactionsEnabled={interactionsEnabled}
          onRequireUgc={requireUgc}
          onPostCreated={() => void refetch()}
        />

        {loading ? (
          <div className="space-y-3">
            <SkeletonFeedPost />
            <SkeletonFeedPost />
            <SkeletonFeedPost />
          </div>
        ) : posts.length === 0 ? (
          <FeedEmptyState
            isGuest={isGuest}
            activeFilter={activeFilter}
            onPostCreated={() => void refetch()}
          />
        ) : (
          <div>
            {posts.map((post) => (
              <FeedPostCard
                key={post.id}
                post={post}
                onLike={toggleLike}
                onShare={
                  isGuest
                    ? undefined
                    : (id) => guardAction(() => setSharePostId(id))
                }
                onComment={
                  isGuest ? undefined : (id) => guardAction(() => setCommentPostId(id))
                }
                onSave={isGuest ? undefined : handleSave}
                onReport={isGuest ? undefined : handleReport}
                onBlockUser={isGuest ? undefined : handleBlockUser}
                onOpenCoupon={setCouponPopupId}
                viewerUserId={viewerUserId}
                onEditPost={isGuest ? undefined : openEditFeedPost}
                onDeletePost={isGuest ? undefined : handleDeletePost}
                readOnlyInteractions={isGuest}
                viewerFriendIds={viewerFriendIds}
                onFollowAuthor={isGuest ? undefined : handleFollowAuthor}
                onCommentAdded={(postId) =>
                  updatePost(postId, {
                    commentCount:
                      (posts.find((p) => p.id === postId)?.commentCount ?? 0) + 1,
                  })
                }
              />
            ))}
            {nextCursor && (
              <div ref={loadMoreRef} className="py-6 text-center text-sm text-gray-500">
                {loadingMore ? "Loading more…" : ""}
              </div>
            )}
          </div>
        )}
      </div>

      <CreatePostModal
        open={!!editPost}
        onClose={() => setEditPost(null)}
        editPost={editPost}
        onAfterSuccess={() => void refetch()}
      />

      <CommunityUgcTermsModal
        open={showUgcModal && !isGuest}
        onAccept={() => {
          acceptUgcTerms();
          setUgcAccepted(true);
          setShowUgcModal(false);
        }}
      />

      <FeedShareModal
        open={!!sharePostId}
        target={sharePostId ? { type: "post", id: sharePostId } : null}
        onClose={() => setSharePostId(null)}
        onToast={(msg) => setToast({ message: msg })}
        onSourcePostShared={(postId, shareCount) => {
          if (shareCount != null) updatePost(postId, { shareCount });
        }}
        onShareToFeedComplete={() => void refetch()}
      />

      <FeedCommentsModal
        open={!!commentPostId}
        postId={commentPostId}
        post={commentPost}
        onClose={() => setCommentPostId(null)}
        onCommentAdded={(postId) =>
          updatePost(postId, {
            commentCount: (posts.find((p) => p.id === postId)?.commentCount ?? 0) + 1,
          })
        }
      />

      <ReportPostDialog
        open={!!reportPostId}
        postId={reportPostId}
        authorId={reportPostId ? posts.find((p) => p.id === reportPostId)?.author.id : null}
        onClose={() => setReportPostId(null)}
        onSubmitted={() => setToast({ message: "Report submitted. Thank you." })}
        onBlockUser={
          reportPostId
            ? () => {
                const p = posts.find((x) => x.id === reportPostId);
                if (p) void handleBlockUser(p.author.id, p.id);
              }
            : undefined
        }
      />

      {couponPopupId && (
        <CouponPopup couponId={couponPopupId} onClose={() => setCouponPopupId(null)} />
      )}

      <FeedToast toast={toast} onDone={() => setToast(null)} />
    </div>
  );
}
