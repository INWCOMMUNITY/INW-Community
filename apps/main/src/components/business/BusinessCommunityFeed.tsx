"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { FeedPostCard } from "@/components/FeedPostCard";
import { CreatePostModal, type EditFeedPostPayload } from "@/components/CreatePostModal";
import {
  fetchBusinessFeed,
  toggleBusinessFeedLike,
  type BusinessFeedPost,
} from "@/lib/business-feed-api";
import { BUSINESS_SECTION_TITLE } from "@/components/business/business-page-layout";

export function BusinessCommunityFeed({ businessId }: { businessId: string }) {
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();
  const viewerUserId = (session?.user as { id?: string } | undefined)?.id ?? null;
  const isGuest = sessionStatus !== "loading" && !viewerUserId;

  const [posts, setPosts] = useState<BusinessFeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [editPost, setEditPost] = useState<EditFeedPostPayload | null>(null);

  const load = useCallback(
    async (cursor?: string, append = false) => {
      const { posts: next, nextCursor: nc } = await fetchBusinessFeed(businessId, cursor);
      setPosts((prev) => (append && cursor ? [...prev, ...next] : next));
      setNextCursor(nc);
    },
    [businessId]
  );

  useEffect(() => {
    setLoading(true);
    load()
      .catch(() => setPosts([]))
      .finally(() => setLoading(false));
  }, [load]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      await load(nextCursor, true);
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleLike(postId: string) {
    if (isGuest) {
      router.push(`/login?callbackUrl=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    try {
      const { liked } = await toggleBusinessFeedLike(postId);
      setPosts((prev) =>
        prev.map((p) =>
          p.id === postId
            ? { ...p, liked, likeCount: p.likeCount + (liked ? 1 : -1) }
            : p
        )
      );
    } catch {
      /* ignore */
    }
  }

  async function handleShare(postId: string) {
    const res = await fetch(`/api/posts/${postId}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({}),
    });
    if (res.ok) {
      alert("Post shared to your feed!");
    } else {
      const err = await res.json().catch(() => ({}));
      alert((err as { error?: string }).error ?? "Failed to share");
    }
  }

  function openEditFeedPost(p: BusinessFeedPost) {
    setEditPost({
      id: p.id,
      content: p.content,
      photos: p.photos,
      videos: p.videos ?? [],
      tags: p.tags,
      groupId: p.groupId ?? null,
      type: p.type,
      sourceBusiness: p.sourceBusiness
        ? { id: p.sourceBusiness.id, name: p.sourceBusiness.name }
        : null,
    });
  }

  async function handleDeletePost(postId: string) {
    if (!window.confirm("Delete this post? This cannot be undone.")) return;
    const res = await fetch(`/api/posts/${encodeURIComponent(postId)}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (res.ok) {
      setPosts((prev) => prev.filter((p) => p.id !== postId));
    } else {
      const err = await res.json().catch(() => ({}));
      alert((err as { error?: string }).error ?? "Failed to delete post.");
    }
  }

  return (
    <div className="pt-2">
      <p className={BUSINESS_SECTION_TITLE} style={{ color: "var(--color-heading)" }}>
        Community posts
      </p>
      <p className="text-sm mb-3" style={{ color: "var(--color-text)" }}>
        Posts that share this business or its coupons and rewards on the community feed.
      </p>

      {loading && posts.length === 0 ? (
        <p className="text-center text-gray-500 py-6 text-sm">Loading posts…</p>
      ) : null}

      {!loading && posts.length === 0 ? (
        <p className="text-center text-gray-500 py-4 text-sm">No posts yet.</p>
      ) : (
        <div className="space-y-4">
          {posts.map((post) => (
            <FeedPostCard
              key={post.id}
              post={post as Parameters<typeof FeedPostCard>[0]["post"]}
              onLike={handleLike}
              onShare={isGuest ? undefined : handleShare}
              viewerUserId={viewerUserId}
              onEditPost={isGuest ? undefined : openEditFeedPost}
              onDeletePost={isGuest ? undefined : handleDeletePost}
              readOnlyInteractions={isGuest}
              onCommentAdded={(postId) => {
                setPosts((prev) =>
                  prev.map((p) =>
                    p.id === postId ? { ...p, commentCount: p.commentCount + 1 } : p
                  )
                );
              }}
            />
          ))}
          {nextCursor ? (
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className="w-full py-2.5 rounded-lg border-2 border-[var(--color-primary)] font-semibold text-[var(--color-primary)] hover:opacity-90 disabled:opacity-50"
            >
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          ) : null}
        </div>
      )}

      <CreatePostModal
        open={!!editPost}
        onClose={() => setEditPost(null)}
        editPost={editPost}
        onAfterSuccess={() => {
          void load();
        }}
      />
    </div>
  );
}
