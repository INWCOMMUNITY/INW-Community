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
}

export default function CommunityGroupsPage() {
  const { data: session } = useSession();
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");

  useEffect(() => {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (category) params.set("category", category);
    fetch(`/api/groups?${params}`)
      .then((r) => r.json())
      .then((data) => setGroups(data.groups ?? []))
      .catch(() => setGroups([]))
      .finally(() => setLoading(false));
  }, [q, category]);

  return (
    <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
      <div className="max-w-[var(--max-width)] mx-auto text-center">
        <div className="flex flex-wrap items-center justify-center gap-4 mb-8">
          <h1 className="text-3xl font-bold w-full">Community Groups</h1>
          {session?.user?.id && (
            <Link href="/community-groups/new" className="btn">
              Create group
            </Link>
          )}
        </div>
        <p className="text-gray-600 mb-6 max-w-xl mx-auto">
          Join or create groups to connect with others in your community. Share updates, photos, and more.
        </p>
        <div className="flex flex-wrap gap-4 mb-6 justify-center">
          <input
            type="search"
            placeholder="Search groups…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="border rounded px-3 py-2 w-64 max-w-full"
          />
          <input
            type="text"
            placeholder="Category filter"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="border rounded px-3 py-2 w-64 max-w-full"
          />
        </div>
        {loading ? (
          <p className="text-gray-500">Loading…</p>
        ) : groups.length === 0 ? (
          <p className="text-gray-500">No groups yet. Be the first to create one!</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 max-w-[80%] mx-auto">
            {groups.map((g) => (
              <Link
                key={g.id}
                href={`/community-groups/${g.slug}`}
                className="block border rounded-lg overflow-hidden hover:shadow-md transition w-full"
              >
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
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
