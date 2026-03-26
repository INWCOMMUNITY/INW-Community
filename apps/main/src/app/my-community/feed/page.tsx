"use client";

import { useState, useEffect } from "react";
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

export default function CommunityFeedPage() {
  const { data: session } = useSession();
  const viewerUserId = (session?.user as { id?: string } | undefined)?.id ?? null;
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [editPost, setEditPost] = useState<EditFeedPostPayload | null>(null);

  function loadFeed(cursor?: string) {
    const params = new URLSearchParams();
    if (cursor) params.set("cursor", cursor);
    return fetch(`/api/feed?${params}`)
      .then((r) => r.json())
      .then((data) => ({ posts: data.posts ?? [], nextCursor: data.nextCursor ?? null }));
  }

  useEffect(() => {
    loadFeed()
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
      const { posts: more, nextCursor: c } = await loadFeed(nextCursor);
      setPosts((prev) => [...prev, ...more]);
      setNextCursor(c);
    } finally {
      setLoadingMore(false);
    }
  }

  async function toggleLike(postId: string) {
    const res = await fetch(`/api/posts/${postId}/like`, { method: "POST" });
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
      body: JSON.stringify({}),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.post) {
        setPosts((prev) => [{ ...data.post, author: data.post.author, liked: false, likeCount: 0, commentCount: 0, tags: [] }, ...prev]);
      }
      alert("Post shared to your feed!");
    } else {
      const err = await res.json().catch(() => ({}));
      alert(err.error ?? "Failed to share");
    }
  }

  function refreshFeedFromStart() {
    void loadFeed().then(({ posts: p, nextCursor: c }) => {
      setPosts(p);
      setNextCursor(c);
    });
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

  if (loading) return <p className="text-gray-500">Loading…</p>;

  return (
    <div>
      <div className="flex flex-col max-md:items-center md:flex-row md:flex-wrap md:items-center md:justify-between gap-4 mb-6">
        <h1 className="text-2xl font-bold max-md:text-center md:order-1">Northwest Community Feed</h1>
      </div>
      <p className="text-gray-600 mb-6 max-md:text-center">
        Posts from you and your friends, groups you&apos;ve joined, tags you follow, and businesses you follow (including
        their updates). Share a blog or other item to add it here.
      </p>
      {posts.length === 0 ? (
        <p className="text-gray-500">
          Your feed is empty. Add friends, join groups, follow tags or local businesses, or share a blog post to get
          started!
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
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className="btn w-full"
            >
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          )}
        </div>
      )}
      <CreatePostModal
        open={!!editPost}
        onClose={() => setEditPost(null)}
        editPost={editPost}
        onAfterSuccess={refreshFeedFromStart}
      />
    </div>
  );
}
