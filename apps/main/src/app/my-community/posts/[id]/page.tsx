"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { FeedPostCard } from "@/components/FeedPostCard";
import { CreatePostModal, type EditFeedPostPayload } from "@/components/CreatePostModal";

type PostShape = Parameters<typeof FeedPostCard>[0]["post"];

export default function SingleCommunityPostPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const id = typeof params?.id === "string" ? params.id : "";
  const initialCommentId = searchParams?.get("comment");
  const { data: session, status: sessionStatus } = useSession();
  const viewerUserId = (session?.user as { id?: string } | undefined)?.id ?? null;
  const isGuest = sessionStatus !== "loading" && !viewerUserId;

  const [post, setPost] = useState<PostShape | null>(null);
  const [loading, setLoading] = useState(true);
  const [editPost, setEditPost] = useState<EditFeedPostPayload | null>(null);

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

  async function toggleLike(postId: string) {
    if (isGuest) return;
    const res = await fetch(`/api/posts/${postId}/like`, { method: "POST", credentials: "include" });
    if (res.ok) {
      const data = await res.json();
      setPost((p) =>
        p && p.id === postId
          ? { ...p, liked: data.liked, likeCount: p.likeCount + (data.liked ? 1 : -1) }
          : p
      );
    }
  }

  async function handleShare(postId: string) {
    if (isGuest) return;
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
    const res = await fetch(`/api/posts/${encodeURIComponent(postId)}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (res.ok) {
      window.location.href = "/my-community/feed";
    } else {
      const err = await res.json().catch(() => ({}));
      alert((err as { error?: string }).error ?? "Failed to delete post.");
    }
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
        <div className="mb-4 rounded-lg border p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3" style={{ borderColor: "var(--color-primary)", background: "rgba(201,157,95,0.06)" }}>
          <div className="flex-1">
            <p className="font-semibold text-sm" style={{ color: "var(--color-primary)" }}>
              Join the community to like, comment, and share
            </p>
            <p className="text-xs text-gray-500 mt-0.5">Sign up free or download the app</p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/login"
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
        onShare={isGuest ? undefined : handleShare}
        viewerUserId={viewerUserId}
        onEditPost={isGuest ? undefined : openEditFeedPost}
        onDeletePost={isGuest ? undefined : handleDeletePost}
        readOnlyInteractions={isGuest}
        initialCommentId={initialCommentId}
        onCommentAdded={isGuest ? undefined : (postId) => {
          setPost((p) =>
            p && p.id === postId ? { ...p, commentCount: p.commentCount + 1 } : p
          );
        }}
      />
      {!isGuest && (
        <CreatePostModal open={!!editPost} onClose={() => setEditPost(null)} editPost={editPost} onAfterSuccess={load} />
      )}
    </div>
  );
}
