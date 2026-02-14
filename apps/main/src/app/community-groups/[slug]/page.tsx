"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { CreatePostButton } from "@/components/CreatePostButton";

interface GroupDetail {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  coverImageUrl: string | null;
  slug: string;
  createdBy: { id: string; firstName: string; lastName: string; profilePhotoUrl: string | null };
  _count: { members: number; groupPosts: number };
  isMember: boolean;
  memberRole: string | null;
}

export default function GroupDetailPage() {
  const params = useParams();
  const slug = params.slug as string;
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    if (!slug) return;
    fetch(`/api/groups/${slug}`)
      .then((r) => r.json())
      .then(setGroup)
      .catch(() => setGroup(null))
      .finally(() => setLoading(false));
  }, [slug]);

  async function handleJoin() {
    if (!group || actionLoading) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/groups/${group.slug}/join`, { method: "POST" });
      if (res.ok) {
        setGroup((prev) => prev ? { ...prev, isMember: true, memberRole: "member" } : null);
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error ?? "Failed to join");
      }
    } finally {
      setActionLoading(false);
    }
  }

  async function handleLeave() {
    if (!group || actionLoading) return;
    if (group.memberRole === "admin" && group.createdBy) {
      alert("Group creators cannot leave. Transfer ownership or delete the group.");
      return;
    }
    setActionLoading(true);
    try {
      const res = await fetch(`/api/groups/${group.slug}/leave`, { method: "POST" });
      if (res.ok) {
        setGroup((prev) => prev ? { ...prev, isMember: false, memberRole: null } : null);
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error ?? "Failed to leave");
      }
    } finally {
      setActionLoading(false);
    }
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

  const isCreator = group.createdBy;
  const canLeave = group.isMember && group.memberRole !== "admin";

  return (
    <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
      <div className="max-w-[var(--max-width)] mx-auto">
        <Link href="/community-groups" className="text-sm text-gray-600 hover:underline mb-4 inline-block">
          ← Back to groups
        </Link>
        <div className="border rounded-lg overflow-hidden">
          {group.coverImageUrl ? (
            <img src={group.coverImageUrl} alt="" className="w-full h-64 object-cover" />
          ) : (
            <div className="w-full h-64 bg-gray-200 flex items-center justify-center text-6xl text-gray-400">
              #
            </div>
          )}
          <div className="p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h1 className="text-3xl font-bold">{group.name}</h1>
                {group.category && (
                  <span className="text-sm text-gray-500 uppercase">{group.category}</span>
                )}
                <p className="text-gray-600 mt-2">
                  {group._count.members} member{group._count.members !== 1 ? "s" : ""} · {group._count.groupPosts} post{group._count.groupPosts !== 1 ? "s" : ""}
                </p>
              </div>
              <div className="flex gap-2">
                {!group.isMember ? (
                  <button
                    type="button"
                    onClick={handleJoin}
                    disabled={actionLoading}
                    className="btn"
                  >
                    {actionLoading ? "Joining…" : "Join group"}
                  </button>
                ) : canLeave ? (
                  <button
                    type="button"
                    onClick={handleLeave}
                    disabled={actionLoading}
                    className="btn border text-gray-700 hover:bg-gray-100"
                  >
                    {actionLoading ? "Leaving…" : "Leave group"}
                  </button>
                ) : group.memberRole === "admin" ? (
                  <Link
                    href={`/my-community/groups/${group.slug}`}
                    className="btn"
                  >
                    Admin
                  </Link>
                ) : (
                  <span className="btn opacity-75 cursor-default">Member</span>
                )}
              </div>
            </div>
            {group.description && (
              <p className="mt-4 text-gray-700 whitespace-pre-wrap">{group.description}</p>
            )}
            <div className="mt-6 flex items-center gap-2">
              {group.createdBy.profilePhotoUrl ? (
                <img
                  src={group.createdBy.profilePhotoUrl}
                  alt=""
                  className="w-8 h-8 rounded-full object-cover"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-gray-300 flex items-center justify-center text-xs font-medium text-gray-600">
                  {group.createdBy.firstName?.[0]}{group.createdBy.lastName?.[0]}
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
        </div>
        {group.isMember && (
          <div className="mt-8">
            <div className="flex items-center justify-between gap-4 mb-4">
              <h2 className="text-xl font-bold">Posts</h2>
              <CreatePostButton
                groupId={group.id}
                returnTo={`/community-groups/${group.slug}`}
                className="btn"
              >
                Create post
              </CreatePostButton>
            </div>
            <p className="text-gray-500">Group posts appear in your feed. Create a post above!</p>
          </div>
        )}
      </div>
    </section>
  );
}
