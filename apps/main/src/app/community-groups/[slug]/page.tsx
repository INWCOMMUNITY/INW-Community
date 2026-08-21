"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { CreatePostButton } from "@/components/CreatePostButton";
import { FeedPostCard } from "@/components/FeedPostCard";
import { SkeletonFeedPost } from "@/components/ui/Skeleton";
import {
  fetchGroupFeedPage,
  type CommunityFeedPost,
} from "@/lib/feed-types";
import { titleCaseCategory } from "@/lib/group-labels";

interface MemberPreview {
  id: string;
  firstName: string;
  lastName: string;
  profilePhotoUrl: string | null;
}

interface GroupDetail {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  coverImageUrl: string | null;
  slug: string;
  rules: string | null;
  allowBusinessPosts?: boolean;
  createdBy: { id: string; firstName: string; lastName: string; profilePhotoUrl: string | null };
  _count: { members: number; groupPosts: number };
  isMember: boolean;
  memberRole: string | null;
  membersPreview?: MemberPreview[];
}

export default function GroupDetailPage() {
  const params = useParams();
  const slug = params.slug as string;
  const { data: session } = useSession();
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const rulesDialogRef = useRef<HTMLDialogElement>(null);

  const [posts, setPosts] = useState<CommunityFeedPost[]>([]);
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const userId =
    session?.user && "id" in session.user ? (session.user as { id: string }).id : undefined;

  const loadFeed = useCallback(
    async (cursor?: string) => {
      if (!slug) return;
      if (cursor) setLoadingMore(true);
      else {
        setFeedLoading(true);
        setFeedError(null);
      }
      try {
        const data = await fetchGroupFeedPage(slug, cursor);
        setPosts((prev) => (cursor ? [...prev, ...data.posts] : data.posts));
        setNextCursor(data.nextCursor);
      } catch {
        if (!cursor) {
          setPosts([]);
          setNextCursor(null);
          setFeedError("Could not load posts. Try again.");
        }
      } finally {
        setFeedLoading(false);
        setLoadingMore(false);
      }
    },
    [slug]
  );

  useEffect(() => {
    if (!slug) return;
    fetch(`/api/groups/${slug}`)
      .then((r) => r.json())
      .then((data) => {
        if (data?.error || !data?.id) {
          setGroup(null);
          return;
        }
        setGroup(data);
      })
      .catch(() => setGroup(null))
      .finally(() => setLoading(false));
  }, [slug]);

  useEffect(() => {
    if (!group?.isMember) {
      setPosts([]);
      setNextCursor(null);
      setFeedError(null);
      setFeedLoading(false);
      return;
    }
    void loadFeed();
  }, [group?.isMember, group?.id, loadFeed]);

  useEffect(() => {
    const el = rulesDialogRef.current;
    if (!el) return;
    if (rulesOpen) el.showModal();
    else el.close();
  }, [rulesOpen]);

  async function performJoin(agreedToRules: boolean) {
    if (!group || actionLoading) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/groups/${group.slug}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agreedToRules }),
      });
      if (res.ok) {
        setGroup((prev) =>
          prev
            ? {
                ...prev,
                isMember: true,
                memberRole: "member",
                _count: { ...prev._count, members: prev._count.members + 1 },
              }
            : null
        );
        setRulesOpen(false);
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error ?? "Failed to join");
      }
    } finally {
      setActionLoading(false);
    }
  }

  function handleJoinClick() {
    if (!group || actionLoading) return;
    if (group.rules != null && String(group.rules).trim().length > 0) {
      setRulesOpen(true);
    } else {
      void performJoin(false);
    }
  }

  async function handleLeave() {
    if (!group || actionLoading) return;
    if (userId && group.createdBy.id === userId) {
      alert("Group creators cannot leave. Transfer ownership or delete the group.");
      return;
    }
    setActionLoading(true);
    try {
      const res = await fetch(`/api/groups/${group.slug}/leave`, { method: "POST" });
      if (res.ok) {
        setGroup((prev) =>
          prev
            ? {
                ...prev,
                isMember: false,
                memberRole: null,
                _count: {
                  ...prev._count,
                  members: Math.max(0, prev._count.members - 1),
                },
              }
            : null
        );
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error ?? "Failed to leave");
      }
    } finally {
      setActionLoading(false);
    }
  }

  async function toggleLike(postId: string) {
    const prev = posts.find((p) => p.id === postId);
    if (!prev) return;
    const optimisticLiked = !prev.liked;
    setPosts((list) =>
      list.map((p) =>
        p.id === postId
          ? { ...p, liked: optimisticLiked, likeCount: p.likeCount + (optimisticLiked ? 1 : -1) }
          : p
      )
    );
    const res = await fetch(`/api/posts/${postId}/like`, { method: "POST", credentials: "include" });
    if (res.ok) {
      const data = await res.json();
      setPosts((list) =>
        list.map((p) =>
          p.id === postId
            ? { ...p, liked: data.liked, likeCount: prev.likeCount + (data.liked ? 1 : -1) }
            : p
        )
      );
    } else {
      setPosts((list) =>
        list.map((p) =>
          p.id === postId ? { ...p, liked: prev.liked, likeCount: prev.likeCount } : p
        )
      );
    }
  }

  function handleAfterCreatePost() {
    setGroup((prev) =>
      prev
        ? { ...prev, _count: { ...prev._count, groupPosts: prev._count.groupPosts + 1 } }
        : null
    );
    void loadFeed();
  }

  if (loading) return <p className="text-gray-500 py-12">Loading…</p>;
  if (!group) return (
    <section className="py-12 px-4">
      <div className="max-w-[var(--max-width)] mx-auto text-center">
        <h1 className="text-2xl font-bold mb-4">Group not found</h1>
        <Link href="/community-groups" className="btn">Back to groups</Link>
      </div>
    </section>
  );

  const canLeave = Boolean(group.isMember && userId && userId !== group.createdBy.id);
  const isAdmin = group.memberRole === "admin" || (userId != null && userId === group.createdBy.id);
  const createPostBtn = group.isMember ? (
    <CreatePostButton
      groupId={group.id}
      groupAllowsBusinessPosts={!!group.allowBusinessPosts}
      returnTo={`/community-groups/${group.slug}`}
      onAfterSuccess={handleAfterCreatePost}
      className="btn inline-block text-sm px-4 py-2"
    >
      Create Post
    </CreatePostButton>
  ) : null;

  return (
    <section className="px-4 py-6 md:py-10">
      <dialog
        ref={rulesDialogRef}
        className="max-w-lg w-[calc(100%-2rem)] rounded-lg border border-gray-200 p-0 shadow-lg backdrop:bg-black/40"
        onClose={() => setRulesOpen(false)}
      >
        <div className="p-6">
          <h2 className="text-lg font-semibold mb-2">Group rules</h2>
          <p className="text-sm text-gray-600 mb-4">Read and agree before joining.</p>
          <div className="max-h-64 overflow-y-auto rounded border bg-gray-50 p-3 text-sm whitespace-pre-wrap mb-4">
            {group.rules}
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="btn border border-gray-300 bg-white"
              onClick={() => setRulesOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn bg-green-600 text-white hover:bg-green-700"
              disabled={actionLoading}
              onClick={() => void performJoin(true)}
            >
              {actionLoading ? "Joining…" : "I agree — Join group"}
            </button>
          </div>
        </div>
      </dialog>

      <div className="max-w-[var(--max-width)] mx-auto">
        <div className="relative overflow-hidden rounded-xl w-full aspect-[5/2] min-h-[13rem]">
          {group.coverImageUrl ? (
            <>
              <img
                src={group.coverImageUrl}
                alt=""
                className="absolute inset-0 w-full h-full object-cover object-center"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/25 to-black/10" />
            </>
          ) : (
            <div
              className="absolute inset-0"
              style={{ backgroundColor: "var(--color-earth)" }}
              aria-hidden
            />
          )}
          <div className="absolute inset-0 z-10 flex flex-col justify-between p-4 md:p-6">
            <Link
              href="/community-groups"
              className="self-start rounded-full bg-white/90 px-3 py-1.5 text-sm font-semibold no-underline hover:bg-white"
              style={{ color: "var(--color-heading)" }}
            >
              ← Back to groups
            </Link>
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
              <div className="min-w-0">
                <h1
                  className="text-3xl md:text-4xl font-bold text-white"
                  style={{ fontFamily: "var(--font-heading)" }}
                >
                  {group.name}
                </h1>
                {group.category ? (
                  <p className="text-sm text-white/90 mt-1">{titleCaseCategory(group.category)}</p>
                ) : null}
                <p className="text-sm text-white/90 mt-1">
                  {group._count.members} member{group._count.members !== 1 ? "s" : ""} ·{" "}
                  {group._count.groupPosts} post{group._count.groupPosts !== 1 ? "s" : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 items-center">
                {!group.isMember ? (
                  <button
                    type="button"
                    onClick={handleJoinClick}
                    disabled={actionLoading}
                    className="btn"
                  >
                    {actionLoading ? "Joining…" : "Join Group"}
                  </button>
                ) : null}
                {canLeave ? (
                  <button
                    type="button"
                    onClick={handleLeave}
                    disabled={actionLoading}
                    className="inline-block px-4 py-2 rounded text-sm font-medium border bg-white/90 hover:bg-white"
                    style={{ color: "var(--color-heading)", borderColor: "var(--color-earth)" }}
                  >
                    {actionLoading ? "Leaving…" : "Leave Group"}
                  </button>
                ) : null}
                {group.isMember && isAdmin ? (
                  <Link
                    href={`/my-community/groups/${group.slug}`}
                    className="inline-block px-4 py-2 rounded text-sm font-medium border bg-white/90 hover:bg-white no-underline"
                    style={{ color: "var(--color-earth)", borderColor: "var(--color-earth)" }}
                  >
                    Admin
                  </Link>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 mb-8">
          {group.membersPreview && group.membersPreview.length > 0 ? (
            <div className="flex items-center gap-2 mb-3">
              <div className="flex -space-x-2">
                {group.membersPreview.map((m) =>
                  m.profilePhotoUrl ? (
                    <img
                      key={m.id}
                      src={m.profilePhotoUrl}
                      alt=""
                      className="w-8 h-8 rounded-full object-cover border-2 border-white"
                    />
                  ) : (
                    <div
                      key={m.id}
                      className="w-8 h-8 rounded-full border-2 border-white flex items-center justify-center text-xs font-medium"
                      style={{ backgroundColor: "var(--color-section-alt)", color: "var(--color-heading)" }}
                    >
                      {m.firstName?.[0]}
                      {m.lastName?.[0]}
                    </div>
                  )
                )}
              </div>
              <span className="text-sm text-gray-600">
                {group._count.members} member{group._count.members !== 1 ? "s" : ""}
              </span>
            </div>
          ) : null}
          {group.description ? (
            <p className="text-gray-700 whitespace-pre-wrap">{group.description}</p>
          ) : null}
          {group.rules?.trim() ? (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer font-medium" style={{ color: "var(--color-heading)" }}>
                Group rules
              </summary>
              <p className="mt-2 text-gray-600 whitespace-pre-wrap">{group.rules}</p>
            </details>
          ) : null}
          <div className="mt-4 flex items-center gap-2">
            {group.createdBy.profilePhotoUrl ? (
              <img
                src={group.createdBy.profilePhotoUrl}
                alt=""
                className="w-8 h-8 rounded-full object-cover"
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-gray-300 flex items-center justify-center text-xs font-medium text-gray-600">
                {group.createdBy.firstName?.[0]}
                {group.createdBy.lastName?.[0]}
              </div>
            )}
            <span className="text-sm text-gray-600">
              Created by{" "}
              <Link href={`/members/${group.createdBy.id}`} className="hover:underline font-medium">
                {group.createdBy.firstName} {group.createdBy.lastName}
              </Link>
            </span>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between gap-3 mb-4">
            <h2
              className="text-xl font-bold"
              style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}
            >
              Posts
            </h2>
            {createPostBtn}
          </div>

          {!group.isMember ? (
            <p className="text-gray-600">Join to see posts.</p>
          ) : feedLoading ? (
            <div className="space-y-4">
              <SkeletonFeedPost />
              <SkeletonFeedPost />
            </div>
          ) : feedError ? (
            <div>
              <p className="text-sm text-red-600 mb-3">{feedError}</p>
              <button type="button" className="btn text-sm" onClick={() => void loadFeed()}>
                Try again
              </button>
            </div>
          ) : posts.length === 0 ? (
            <div
              className="rounded-xl border bg-white px-4 py-8 text-center"
              style={{ borderColor: "var(--color-earth)" }}
            >
              <p className="text-gray-600 mb-4">No posts in this group yet.</p>
              {createPostBtn}
            </div>
          ) : (
            <div className="space-y-4">
              {posts.map((post) => (
                <FeedPostCard
                  key={post.id}
                  post={post}
                  onLike={toggleLike}
                  viewerUserId={userId ?? null}
                />
              ))}
              {nextCursor ? (
                <div className="flex justify-center pt-2">
                  <button
                    type="button"
                    className="btn text-sm"
                    disabled={loadingMore}
                    onClick={() => void loadFeed(nextCursor)}
                  >
                    {loadingMore ? "Loading…" : "Load more"}
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
