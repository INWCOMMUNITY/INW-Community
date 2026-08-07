"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { FeedPostCard } from "@/components/FeedPostCard";
import { CreatePostModal, type EditFeedPostPayload } from "@/components/CreatePostModal";
import { CouponPopup } from "@/components/CouponPopup";
import { FeedToast, type FeedToastPayload } from "@/components/feed/FeedToast";
import { FeedShareModal } from "@/components/feed/FeedShareModal";
import { FeedCommentsModal } from "@/components/feed/FeedCommentsModal";
import { ReportPostDialog } from "@/components/feed/ReportPostDialog";
import { CommunityUgcTermsModal } from "@/components/feed/CommunityUgcTermsModal";
import { type CommunityFeedPost } from "@/lib/feed-types";
import { hasAcceptedUgcTerms, acceptUgcTerms } from "@/lib/ugc-terms-storage";

type PostShape = Parameters<typeof FeedPostCard>[0]["post"];

export default function SingleCommunityPostPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const id = typeof params?.id === "string" ? params.id : "";
  const initialCommentId = searchParams?.get("comment");
  const { data: session, status: sessionStatus } = useSession();
  const viewerUserId = (session?.user as { id?: string } | undefined)?.id ?? null;
  const isGuest = sessionStatus !== "loading" && !viewerUserId;

  const [post, setPost] = useState<PostShape | null>(null);
  const [loading, setLoading] = useState(true);
  const [editPost, setEditPost] = useState<EditFeedPostPayload | null>(null);
  const [ugcAccepted, setUgcAccepted] = useState(true);
  const [showUgcModal, setShowUgcModal] = useState(false);
  const [toast, setToast] = useState<FeedToastPayload | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [highlightCommentId, setHighlightCommentId] = useState<string | null>(initialCommentId);
  const [reportOpen, setReportOpen] = useState(false);
  const [couponPopupId, setCouponPopupId] = useState<string | null>(null);
  const [viewerFriendIds, setViewerFriendIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const res = await fetch(`/api/posts/${encodeURIComponent(id)}`, { credentials: "include" });
      if (!res.ok) {
        setPost(null);
        return;
      }
      const data = await res.json();
      setPost(data.post ?? null);
    } catch {
      setPost(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (initialCommentId) {
      setHighlightCommentId(initialCommentId);
      setCommentsOpen(true);
    }
  }, [initialCommentId]);

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

  function clearCommentQueryParam() {
    if (!searchParams?.get("comment")) return;
    const next = new URLSearchParams(searchParams.toString());
    next.delete("comment");
    const q = next.toString();
    router.replace(q ? `/my-community/posts/${id}?${q}` : `/my-community/posts/${id}`, {
      scroll: false,
    });
    setHighlightCommentId(null);
  }

  async function toggleLike(postId: string) {
    guardAction(async () => {
      if (!post || post.id !== postId) return;
      const prev = post;
      const optimisticLiked = !prev.liked;
      setPost({
        ...prev,
        liked: optimisticLiked,
        likeCount: prev.likeCount + (optimisticLiked ? 1 : -1),
      });
      const res = await fetch(`/api/posts/${postId}/like`, { method: "POST", credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setPost((p) =>
          p && p.id === postId
            ? { ...p, liked: data.liked, likeCount: prev.likeCount + (data.liked ? 1 : -1) }
            : p
        );
      } else {
        setPost(prev);
        setToast({ message: "Could not update like." });
      }
    });
  }

  function openEditFeedPost(p: PostShape) {
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
        window.location.href = "/my-community/feed";
      } else {
        setToast({ message: "Failed to delete post." });
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

  async function handleFollowAuthor(authorId: string) {
    guardAction(async () => {
      if (!post || post.author.id !== authorId) return;
      const wasFollowing = post.isFollowingAuthor ?? false;
      setPost({ ...post, isFollowingAuthor: !wasFollowing });
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
        setPost({ ...post, isFollowingAuthor: wasFollowing });
        setToast({ message: "Could not update follow." });
      }
    });
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
        setToast({ message: "User blocked." });
        window.location.href = "/my-community/feed";
      } else {
        setToast({ message: "Could not block user." });
      }
    });
  }

  if (loading) return <p className="text-gray-500">Loading…</p>;

  if (!post) {
    return (
      <div>
        <p className="text-gray-600 mb-4">This post is not available.</p>
        <Link href="/my-community/feed" className="font-medium hover:underline" style={{ color: "var(--color-primary)" }}>
          Back to feed
        </Link>
      </div>
    );
  }

  return (
    <div>
      {isGuest && (
        <div
          className="mb-4 rounded-lg border p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3"
          style={{ borderColor: "var(--color-primary)", background: "rgba(201,157,95,0.06)" }}
        >
          <div className="flex-1">
            <p className="font-semibold text-sm" style={{ color: "var(--color-primary)" }}>
              Join the community to like, comment, and share
            </p>
            <p className="text-xs text-gray-500 mt-0.5">Sign up free or download the app</p>
          </div>
          <div className="flex gap-2">
            <Link
              href={`/login?callbackUrl=/my-community/posts/${id}`}
              className="px-4 py-1.5 rounded-full text-sm font-medium text-white"
              style={{ background: "var(--color-primary)" }}
            >
              Sign in
            </Link>
            <Link
              href="/download-app"
              className="px-4 py-1.5 rounded-full text-sm font-medium border"
              style={{ borderColor: "var(--color-primary)", color: "var(--color-primary)" }}
            >
              Get the app
            </Link>
          </div>
        </div>
      )}
      <div className="mb-6">
        <Link
          href="/my-community/feed"
          className="text-sm font-medium hover:underline"
          style={{ color: "var(--color-primary)" }}
        >
          ← Back to feed
        </Link>
      </div>
      <FeedPostCard
        post={post}
        onLike={toggleLike}
        onShare={isGuest ? undefined : (_id) => guardAction(() => setShareOpen(true))}
        onComment={isGuest ? undefined : () => guardAction(() => setCommentsOpen(true))}
        onSave={isGuest ? undefined : handleSave}
        onReport={isGuest ? undefined : () => guardAction(() => setReportOpen(true))}
        onBlockUser={isGuest ? undefined : handleBlockUser}
        onOpenCoupon={setCouponPopupId}
        viewerUserId={viewerUserId}
        onEditPost={isGuest ? undefined : openEditFeedPost}
        onDeletePost={isGuest ? undefined : handleDeletePost}
        readOnlyInteractions={isGuest}
        viewerFriendIds={viewerFriendIds}
        onFollowAuthor={isGuest ? undefined : handleFollowAuthor}
        onCommentAdded={(postId) => {
          setPost((p) =>
            p && p.id === postId ? { ...p, commentCount: p.commentCount + 1 } : p
          );
        }}
      />

      <CreatePostModal
        open={!!editPost}
        onClose={() => setEditPost(null)}
        editPost={editPost}
        onAfterSuccess={load}
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
        open={shareOpen}
        target={{ type: "post", id: post.id }}
        onClose={() => setShareOpen(false)}
        onToast={(msg) => setToast({ message: msg })}
        onSourcePostShared={(_, shareCount) => {
          if (shareCount != null) setPost((p) => (p ? { ...p, shareCount } : p));
        }}
      />

      <FeedCommentsModal
        open={commentsOpen}
        postId={post.id}
        post={post as CommunityFeedPost}
        highlightCommentId={highlightCommentId}
        onHighlightConsumed={clearCommentQueryParam}
        onClose={() => setCommentsOpen(false)}
        onCommentAdded={() => {
          setPost((p) => (p ? { ...p, commentCount: p.commentCount + 1 } : p));
        }}
      />

      <ReportPostDialog
        open={reportOpen}
        postId={post.id}
        authorId={post.author.id}
        onClose={() => setReportOpen(false)}
        onSubmitted={() => setToast({ message: "Report submitted. Thank you." })}
        onBlockUser={() => void handleBlockUser(post.author.id, post.id)}
      />

      {couponPopupId && (
        <CouponPopup couponId={couponPopupId} onClose={() => setCouponPopupId(null)} />
      )}

      <FeedToast toast={toast} onDone={() => setToast(null)} />
    </div>
  );
}
