"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { FeedPostCard } from "@/components/FeedPostCard";
import { CreatePostModal, type EditFeedPostPayload } from "@/components/CreatePostModal";
import { BackToProfileLink } from "@/components/BackToProfileLink";

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

export default function MyPostsPage() {
  const { data: session } = useSession();
  const viewerUserId = (session?.user as { id?: string } | undefined)?.id ?? null;
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [editPost, setEditPost] = useState<EditFeedPostPayload | null>(null);

  function loadMyPosts(cursor?: string) {
    const params = new URLSearchParams();
    if (cursor) params.set("cursor", cursor);
    return fetch(`/api/me/posts?${params}`)
      .then((r) => r.json())
      .then((data) => ({ posts: data.posts ?? [], nextCursor: data.nextCursor ?? null }));
  }

  useEffect(() => {
    loadMyPosts()
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
      const { posts: more, nextCursor: c } = await loadMyPosts(nextCursor);
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

  function refreshPostsFromStart() {
    void loadMyPosts().then(({ posts: p, nextCursor: c }) => {
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

  if (loading) {
    return (
      <div>
        <BackToProfileLink />
        <p className="text-gray-500">Loading…</p>
      </div>
    );
  }

  return (
    <div>
      <BackToProfileLink />
      <div className="flex flex-col max-md:items-center md:flex-row md:flex-wrap md:items-center md:justify-between gap-4 mb-6">
        <h1 className="text-2xl font-bold max-md:text-center md:order-1">Posts + Photos</h1>
      </div>
      <p className="text-gray-600 mb-6 max-md:text-center">
        Everything you&apos;ve shared—posts and photos only you can see here.
      </p>
      {posts.length === 0 ? (
        <p className="text-gray-500">
          You haven&apos;t shared any posts or photos yet. Share from the Feed or create a post to see them here.
        </p>
      ) : (
        <div className="space-y-6">
          {posts.map((post) => (
            <FeedPostCard
              key={post.id}
              post={post as Parameters<typeof FeedPostCard>[0]["post"]}
              onLike={toggleLike}
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
        onAfterSuccess={refreshPostsFromStart}
      />
    </div>
  );
}
