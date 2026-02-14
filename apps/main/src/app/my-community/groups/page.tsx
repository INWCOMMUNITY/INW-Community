"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";

interface Group {
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

export default function GroupsPage() {
  const { data: session } = useSession();
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

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

  async function handleJoin(slug: string) {
    setActionLoading(slug);
    try {
      const res = await fetch(`/api/groups/${slug}/join`, { method: "POST" });
      if (res.ok) {
        await loadGroups();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error ?? "Failed to join");
      }
    } finally {
      setActionLoading(null);
    }
  }

  async function handleLeave(slug: string, memberRole: string | null) {
    if (memberRole === "admin") {
      alert("Group admins cannot leave. Transfer ownership or delete the group from the group page.");
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
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <h1 className="text-2xl font-bold">Groups</h1>
        {session?.user?.id && (
          <Link href="/community-groups/new" className="btn">
            Create group
          </Link>
        )}
      </div>
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
                          onClick={() => handleLeave(g.slug, g.memberRole)}
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
                      onClick={() => handleJoin(g.slug)}
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
