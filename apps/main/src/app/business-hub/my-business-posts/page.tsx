"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { FeedPostCard } from "@/components/FeedPostCard";
import { CreatePostModal, type EditFeedPostPayload } from "@/components/CreatePostModal";

interface FeedPost {
  id: string;
  type: string;
  content: string | null;
  photos: string[];
  videos?: string[];
  tags?: { id: string; name: string; slug: string }[];
  createdAt: string;
  groupId?: string | null;
  author: { id: string; firstName: string; lastName: string; profilePhotoUrl: string | null };
  sourceBlog?: {
    id: string;
    slug: string;
    title: string;
    body: string;
    photos: string[];
    member: { id: string; firstName: string; lastName: string; profilePhotoUrl: string | null };
    category: { name: string; slug: string };
    blogTags?: { tag: { id: string; name: string; slug: string } }[];
  } | null;
  sourceBusiness?: { id: string; name: string; slug: string; shortDescription: string | null; logoUrl: string | null } | null;
  sourceCoupon?: { id: string; name: string; discount: string; code: string; business: { name: string; slug: string } } | null;
  sourceReward?: { id: string; title: string; pointsRequired: number; business: { name: string; slug: string } } | null;
  sourceStoreItem?: { id: string; title: string; slug: string; photos: string[]; priceCents: number } | null;
  sourcePost?: unknown;
  liked: boolean;
  likeCount: number;
  commentCount: number;
}

function loadBusinessHubPosts(cursor?: string) {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  return fetch(`/api/business-hub/business-posts?${params}`, { credentials: "include" })
    .then((r) => {
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    })
    .then((data) => ({
      posts: (data.posts ?? []) as FeedPost[],
      nextCursor: (data.nextCursor ?? null) as string | null,
    }));
}

export default function MyBusinessPostsPage() {
  const { data: session } = useSession();
  const viewerUserId = (session?.user as { id?: string } | undefined)?.id ?? null;
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [editPost, setEditPost] = useState<EditFeedPostPayload | null>(null);

  function refreshFromStart() {
    void loadBusinessHubPosts().then(({ posts: p, nextCursor: c }) => {
      setPosts(p);
      setNextCursor(c);
    });
  }

  useEffect(() => {
    loadBusinessHubPosts()
      .then(({ posts: p, nextCursor: c }) => {
        setPosts(p);
        setNextCursor(c);
      })
      .catch(() => setPosts([]))
      .finally(() => setLoading(false));
  }, []);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const { posts: more, nextCursor: c } = await loadBusinessHubPosts(nextCursor);
      setPosts((prev) => [...prev, ...more]);
      setNextCursor(c);
    } finally {
      setLoadingMore(false);
    }
  }

  async function toggleLike(postId: string) {
    const res = await fetch(`/api/posts/${postId}/like`, {
      method: "POST",
      credentials: "include",
    });
    if (res.ok) {
      const data = await res.json();
      setPosts((prev) =>
        prev.map((p) =>
          p.id === postId
            ? { ...p, liked: data.liked, likeCount: p.likeCount + (data.liked ? 1 : -1) }
            : p
        )
      );
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

  function openEditFeedPost(p: FeedPost) {
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

  if (loading) {
    return (
      <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
        <div className="max-w-[var(--max-width)] mx-auto">
          <p className="text-gray-500">Loading…</p>
        </div>
      </section>
    );
  }

  return (
    <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
      <div className="max-w-[var(--max-width)] mx-auto">
        <div className="mb-8 flex flex-wrap gap-x-6 gap-y-2">
          <Link
            href="/business-hub/manage"
            className="text-sm font-medium hover:underline"
            style={{ color: "var(--color-primary)" }}
          >
            ← Manage
          </Link>
          <Link
            href="/business-hub"
            className="text-sm font-medium hover:underline"
            style={{ color: "var(--color-primary)" }}
          >
            Business Hub
          </Link>
        </div>

        <h1 className="text-2xl font-bold mb-2" style={{ color: "var(--color-heading)" }}>
          My Business Posts
        </h1>
        <p className="text-gray-600 mb-6">
          Posts you published as your business. Use the menu on each card to edit or delete.
        </p>

        {posts.length === 0 ? (
          <p className="text-gray-500">
            No business posts yet. Create one from Business Hub (Create Post).
          </p>
        ) : (
          <div className="space-y-6">
            {posts.map((post) => (
              <FeedPostCard
                key={post.id}
                post={post as Parameters<typeof FeedPostCard>[0]["post"]}
                onLike={toggleLike}
                onShare={handleShare}
                viewerUserId={viewerUserId}
                onEditPost={openEditFeedPost}
                onDeletePost={handleDeletePost}
                onCommentAdded={(postId) => {
                  setPosts((prev) =>
                    prev.map((p) =>
                      p.id === postId ? { ...p, commentCount: p.commentCount + 1 } : p
                    )
                  );
                }}
              />
            ))}
            {nextCursor && (
              <button type="button" onClick={loadMore} disabled={loadingMore} className="btn w-full">
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            )}
          </div>
        )}

        <CreatePostModal
          open={!!editPost}
          onClose={() => setEditPost(null)}
          editPost={editPost}
          onAfterSuccess={refreshFromStart}
        />
      </div>
    </section>
  );
}
