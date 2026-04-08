"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { CreateGroupCallout } from "@/components/CreateGroupCallout";

interface Group {
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

export default function GroupsPage() {
  const { data: session } = useSession();
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [rulesModalGroup, setRulesModalGroup] = useState<Group | null>(null);
  const rulesDialogRef = useRef<HTMLDialogElement>(null);
  const [adminHubHref, setAdminHubHref] = useState<string | null>(null);

  useEffect(() => {
    if (!session?.user?.id) {
      setAdminHubHref(null);
      return;
    }
    fetch("/api/me/groups?scope=admin")
      .then((r) => r.json())
      .then((data: { groups?: { slug: string }[] }) => {
        const first = data.groups?.[0];
        setAdminHubHref(first?.slug ? `/my-community/groups/${first.slug}/admin` : null);
      })
      .catch(() => setAdminHubHref(null));
  }, [session?.user?.id]);

  function loadGroups() {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (category) params.set("category", category);
    return fetch(`/api/groups?${params}`)
      .then((r) => r.json())
      .then((data) => setGroups(data.groups ?? []))
      .catch(() => setGroups([]));
  }

  useEffect(() => {
    setLoading(true);
    loadGroups().finally(() => setLoading(false));
  }, [q, category]);

  useEffect(() => {
    const el = rulesDialogRef.current;
    if (!el) return;
    if (rulesModalGroup) el.showModal();
    else el.close();
  }, [rulesModalGroup]);

  async function joinWithAgreement(slug: string, agreedToRules: boolean) {
    setActionLoading(slug);
    try {
      const res = await fetch(`/api/groups/${slug}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agreedToRules }),
      });
      if (res.ok) {
        setRulesModalGroup(null);
        await loadGroups();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error ?? "Failed to join");
      }
    } finally {
      setActionLoading(null);
    }
  }

  function handleJoinClick(g: Group) {
    if (g.rules != null && String(g.rules).trim().length > 0) {
      setRulesModalGroup(g);
    } else {
      void joinWithAgreement(g.slug, false);
    }
  }

  async function handleLeave(slug: string, createdById: string) {
    const userId = session?.user && "id" in session.user ? (session.user as { id: string }).id : null;
    if (userId && createdById === userId) {
      alert("Group creators cannot leave. Transfer ownership or delete the group from the group page.");
      return;
    }
    setActionLoading(slug);
    try {
      const res = await fetch(`/api/groups/${slug}/leave`, { method: "POST" });
      if (res.ok) {
        await loadGroups();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error ?? "Failed to leave");
      }
    } finally {
      setActionLoading(null);
    }
  }

  if (loading) return <p className="text-gray-500">Loading…</p>;

  return (
    <div>
      <dialog
        ref={rulesDialogRef}
        className="max-w-lg w-[calc(100%-2rem)] rounded-lg border border-gray-200 p-0 shadow-lg backdrop:bg-black/40"
        onClose={() => setRulesModalGroup(null)}
      >
        <div className="p-6">
          <h2 className="text-lg font-semibold mb-2">Group rules</h2>
          <p className="text-sm text-gray-600 mb-4">
            {rulesModalGroup ? (
              <>
                Read and agree before joining <span className="font-medium">{rulesModalGroup.name}</span>.
              </>
            ) : null}
          </p>
          <div className="max-h-64 overflow-y-auto rounded border bg-gray-50 p-3 text-sm whitespace-pre-wrap mb-4">
            {rulesModalGroup?.rules}
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="btn border border-gray-300 bg-white"
              onClick={() => setRulesModalGroup(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn bg-green-600 text-white hover:bg-green-700"
              disabled={!rulesModalGroup || actionLoading === rulesModalGroup.slug}
              onClick={() => rulesModalGroup && void joinWithAgreement(rulesModalGroup.slug, true)}
            >
              {rulesModalGroup && actionLoading === rulesModalGroup.slug ? "Joining…" : "I agree — Join"}
            </button>
          </div>
        </div>
      </dialog>
      <div className="flex items-start justify-between gap-4 mb-6">
        <h1 className="text-2xl font-bold">Groups</h1>
        {adminHubHref ? (
          <Link
            href={adminHubHref}
            className="shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-full border-2 border-[var(--color-primary)] text-[var(--color-primary)] hover:bg-[var(--color-section-alt)]"
            aria-label="Group admin"
            title="Group admin"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
              <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z" />
            </svg>
          </Link>
        ) : null}
      </div>
      {session?.user?.id && <CreateGroupCallout className="mb-6" />}
      <p className="text-gray-600 mb-6">
        Search and join groups to connect with others in your community. Share updates, photos, and more.
      </p>
      <div className="flex flex-wrap gap-4 mb-6">
        <input
          type="search"
          placeholder="Search groups…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="border rounded px-3 py-2 w-64"
          style={{ letterSpacing: "normal" }}
        />
        <input
          type="text"
          placeholder="Category filter"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="border rounded px-3 py-2 w-48"
        />
      </div>
      {groups.length === 0 ? (
        <p className="text-gray-500">No groups yet. Be the first to create one!</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((g) => (
            <div
              key={g.id}
              className="border rounded-lg overflow-hidden hover:shadow-md transition flex flex-col"
            >
              <Link href={`/community-groups/${g.slug}`} className="block flex-1">
                {g.coverImageUrl ? (
                  <img
                    src={g.coverImageUrl}
                    alt=""
                    className="w-full h-32 object-cover"
                  />
                ) : (
                  <div className="w-full h-32 bg-gray-200 flex items-center justify-center text-4xl text-gray-400">
                    #
                  </div>
                )}
                <div className="p-4">
                  <h2 className="font-bold text-lg">{g.name}</h2>
                  {g.category && (
                    <span className="text-xs text-gray-500 uppercase">{g.category}</span>
                  )}
                  {g.description && (
                    <p className="text-gray-600 text-sm mt-1 line-clamp-2">{g.description}</p>
                  )}
                  <p className="text-gray-500 text-sm mt-2">
                    {g._count.members} member{g._count.members !== 1 ? "s" : ""} · {g._count.groupPosts} post{g._count.groupPosts !== 1 ? "s" : ""}
                  </p>
                  {g.isMember && g.memberRole === "admin" && (
                    <span className="inline-block mt-2 text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded">
                      Admin
                    </span>
                  )}
                </div>
              </Link>
              {session?.user?.id && (
                <div className="p-4 pt-0 border-t">
                  {g.isMember ? (
                    <div className="flex gap-2">
                      <Link href={`/community-groups/${g.slug}`} className="btn text-sm flex-1 text-center">
                        View
                      </Link>
                      {g.memberRole === "admin" && (
                        <Link href={`/my-community/groups/${g.slug}`} className="btn border text-sm">
                          Manage
                        </Link>
                      )}
                      {g.memberRole !== "admin" && (
                        <button
                          type="button"
                          onClick={() => handleLeave(g.slug, g.createdBy.id)}
                          disabled={actionLoading === g.slug}
                          className="btn border border-gray-300 bg-white hover:bg-gray-50 text-sm disabled:opacity-50"
                        >
                          {actionLoading === g.slug ? "…" : "Leave"}
                        </button>
                      )}
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleJoinClick(g)}
                      disabled={actionLoading === g.slug}
                      className="btn w-full text-sm disabled:opacity-50"
                    >
                      {actionLoading === g.slug ? "Joining…" : "Join"}
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
