"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { FeedPostCard } from "@/components/FeedPostCard";
import { CreatePostModal, type EditFeedPostPayload } from "@/components/CreatePostModal";
import { CouponPopup } from "@/components/CouponPopup";
import { FeedToast, type FeedToastPayload } from "@/components/feed/FeedToast";
import { FeedShareModal } from "@/components/feed/FeedShareModal";
import { FeedCommentsModal } from "@/components/feed/FeedCommentsModal";
import { ReportPostDialog } from "@/components/feed/ReportPostDialog";
import { CommunityUgcTermsModal } from "@/components/feed/CommunityUgcTermsModal";
import { SkeletonFeedPost } from "@/components/ui/Skeleton";
import { type CommunityFeedPost } from "@/lib/feed-types";
import { hasAcceptedUgcTerms, acceptUgcTerms } from "@/lib/ugc-terms-storage";

export default function SavedPostsPage() {
  const { data: session, status: sessionStatus } = useSession();
  const viewerUserId = (session?.user as { id?: string } | undefined)?.id ?? null;
  const isGuest = sessionStatus !== "loading" && !viewerUserId;

  const [posts, setPosts] = useState<CommunityFeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [editPost, setEditPost] = useState<EditFeedPostPayload | null>(null);
  const [ugcAccepted, setUgcAccepted] = useState(true);
  const [showUgcModal, setShowUgcModal] = useState(false);
  const [toast, setToast] = useState<FeedToastPayload | null>(null);
  const [sharePostId, setSharePostId] = useState<string | null>(null);
  const [commentPostId, setCommentPostId] = useState<string | null>(null);
  const [reportPostId, setReportPostId] = useState<string | null>(null);
  const [couponPopupId, setCouponPopupId] = useState<string | null>(null);
  const [viewerFriendIds, setViewerFriendIds] = useState<Set<string>>(new Set());

  const updatePost = useCallback((postId: string, patch: Partial<CommunityFeedPost>) => {
    setPosts((prev) => prev.map((p) => (p.id === postId ? { ...p, ...patch } : p)));
  }, []);

  const removePost = useCallback((postId: string) => {
    setPosts((prev) => prev.filter((p) => p.id !== postId));
  }, []);

  const removePostsByAuthor = useCallback((authorId: string) => {
    setPosts((prev) => prev.filter((p) => p.author.id !== authorId));
  }, []);

  const load = useCallback(async () => {
    if (isGuest) {
      setPosts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const savedRes = await fetch("/api/saved?type=post", { credentials: "include" });
      const savedData = await savedRes.json();
      const saved = Array.isArray(savedData) ? savedData : [];
      if (!saved.length) {
        setPosts([]);
        return;
      }
      const ids = saved.map((s: { referenceId: string }) => s.referenceId).join(",");
      const batchRes = await fetch(`/api/posts/batch?ids=${encodeURIComponent(ids)}`, {
        credentials: "include",
      });
      const batchData = await batchRes.json();
      setPosts(Array.isArray(batchData?.posts) ? batchData.posts : []);
    } catch {
      setPosts([]);
    } finally {
      setLoading(false);
    }
  }, [isGuest]);

  useEffect(() => {
    void load();
  }, [load]);

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
      setViewerFriendIds(new Set());
      return;
    }
    fetch("/api/me/friends", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        const friends = Array.isArray(d?.friends) ? d.friends : [];
        const ids = friends.map((f: { id?: string }) => f.id).filter(Boolean) as string[];
        setViewerFriendIds(new Set(ids));
      })
      .catch(() => setViewerFriendIds(new Set()));
  }, [isGuest]);

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
        setToast({ message: "Failed to delete post." });
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
        removePostsByAuthor(memberId);
        setToast({ message: "User blocked." });
      } else {
        setToast({ message: "Could not block user." });
      }
    });
  }

  const commentPost = commentPostId ? posts.find((p) => p.id === commentPostId) : null;

  if (isGuest) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8 text-center">
        <p className="text-gray-600 mb-4">Sign in to view your saved posts.</p>
        <Link
          href="/login?callbackUrl=/my-community/saved-posts"
          className="inline-flex rounded-lg px-5 py-3 text-sm font-semibold text-white bg-[var(--color-primary)]"
        >
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f6f1eb] pb-10">
      <div className="max-w-2xl mx-auto w-full px-4 pt-4">
        <h1 className="text-2xl font-bold text-[var(--color-heading)] mb-2">Saved Posts</h1>
        <p className="text-sm text-gray-600 mb-6">
          Posts you saved from the feed.{" "}
          <Link href="/my-community/feed" className="underline font-medium" style={{ color: "var(--color-link)" }}>
            Back to feed
          </Link>
        </p>

        {loading ? (
          <div className="space-y-3">
            <SkeletonFeedPost />
            <SkeletonFeedPost />
          </div>
        ) : posts.length === 0 ? (
          <p className="text-center text-gray-600 py-12 text-sm">
            No saved posts yet. Use the menu on a post and choose Save post.
          </p>
        ) : (
          posts.map((post) => (
            <FeedPostCard
              key={post.id}
              post={post}
              onLike={toggleLike}
              onShare={(id) => guardAction(() => setSharePostId(id))}
              onComment={(id) => guardAction(() => setCommentPostId(id))}
              onSave={handleSave}
              onReport={handleReport}
              onBlockUser={handleBlockUser}
              onOpenCoupon={setCouponPopupId}
              viewerUserId={viewerUserId}
              onEditPost={openEditFeedPost}
              onDeletePost={handleDeletePost}
              viewerFriendIds={viewerFriendIds}
              onFollowAuthor={handleFollowAuthor}
              onCommentAdded={(postId) =>
                updatePost(postId, {
                  commentCount: (posts.find((p) => p.id === postId)?.commentCount ?? 0) + 1,
                })
              }
            />
          ))
        )}
      </div>

      <CreatePostModal
        open={!!editPost}
        onClose={() => setEditPost(null)}
        editPost={editPost}
        onAfterSuccess={() => void load()}
      />

      <CommunityUgcTermsModal
        open={showUgcModal}
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
        onClose={() => setReportPostId(null)}
        onSubmitted={() => setToast({ message: "Report submitted. Thank you." })}
      />

      {couponPopupId && (
        <CouponPopup couponId={couponPopupId} onClose={() => setCouponPopupId(null)} />
      )}

      <FeedToast toast={toast} onDone={() => setToast(null)} />
    </div>
  );
}
