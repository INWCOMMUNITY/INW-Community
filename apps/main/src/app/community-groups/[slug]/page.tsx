"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { CreatePostButton } from "@/components/CreatePostButton";

interface GroupDetail {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  coverImageUrl: string | null;
  slug: string;
  rules: string | null;
  createdBy: { id: string; firstName: string; lastName: string; profilePhotoUrl: string | null };
  _count: { members: number; groupPosts: number };
  isMember: boolean;
  memberRole: string | null;
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

  useEffect(() => {
    if (!slug) return;
    fetch(`/api/groups/${slug}`)
      .then((r) => r.json())
      .then(setGroup)
      .catch(() => setGroup(null))
      .finally(() => setLoading(false));
  }, [slug]);

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
        setGroup((prev) => prev ? { ...prev, isMember: true, memberRole: "member" } : null);
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
    const userId = session?.user && "id" in session.user ? (session.user as { id: string }).id : null;
    if (userId && group.createdBy.id === userId) {
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

  const userId =
    session?.user && "id" in session.user ? (session.user as { id: string }).id : undefined;
  const canLeave = Boolean(group.isMember && userId && userId !== group.createdBy.id);

  return (
    <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
      <dialog
        ref={rulesDialogRef}
        className="max-w-lg w-[calc(100%-2rem)] rounded-lg border border-gray-200 p-0 shadow-lg backdrop:bg-black/40"
        onClose={() => setRulesOpen(false)}
      >
        <div className="p-6">
          <h2 className="text-lg font-semibold mb-2">Group rules</h2>
          <p className="text-sm text-gray-600 mb-4">Read and agree before joining.</p>
          <div className="max-h-64 overflow-y-auto rounded border bg-gray-50 p-3 text-sm whitespace-pre-wrap mb-4">
            {group?.rules}
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
              <div className="flex gap-2 items-center">
                {!group.isMember ? (
                  <button
                    type="button"
                    onClick={handleJoinClick}
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
                {group.isMember && (
                  <CreatePostButton
                    groupId={group.id}
                    returnTo={`/community-groups/${group.slug}`}
                    className="btn !p-0 w-10 h-10 flex items-center justify-center"
                  >
                    <span aria-hidden className="text-xl leading-none">
                      +
                    </span>
                  </CreatePostButton>
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
            </div>
            <p className="text-gray-500">Group posts appear in your feed. Create a post above!</p>
          </div>
        )}
      </div>
    </section>
  );
}
