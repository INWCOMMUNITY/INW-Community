"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { CreateGroupCallout } from "@/components/CreateGroupCallout";
import { titleCaseCategory } from "@/lib/group-labels";

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
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
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

  useEffect(() => {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (category) params.set("category", category);
    fetch(`/api/groups?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setGroups(data.groups ?? []);
        if (Array.isArray(data.categories)) setCategories(data.categories);
      })
      .catch(() => setGroups([]))
      .finally(() => setLoading(false));
  }, [q, category]);

  return (
    <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
      <div className="max-w-[var(--max-width)] mx-auto text-center">
        <div className="relative w-full text-center mb-6">
          <h1 className="text-3xl font-bold">Community Groups</h1>
          {adminHubHref ? (
            <Link
              href={adminHubHref}
              className="absolute right-0 top-0 inline-flex items-center justify-center w-10 h-10 rounded-full border-2 border-[var(--color-primary)] text-[var(--color-primary)] hover:bg-[var(--color-section-alt)]"
              aria-label="Group admin"
              title="Group admin"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z" />
              </svg>
            </Link>
          ) : null}
        </div>
        {session?.user?.id && (
          <div className="max-w-xl mx-auto mb-8">
            <CreateGroupCallout />
          </div>
        )}
        <p className="text-gray-600 mb-6 max-w-xl mx-auto">
          Join or create groups to connect with others in your community. Share updates, photos, and more.
        </p>
        <div className="mb-6 flex flex-col items-center gap-3">
          <input
            type="search"
            placeholder="Search groups…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="border rounded px-3 py-2 w-64 max-w-full"
            style={{ letterSpacing: "normal" }}
          />
          {categories.length > 0 ? (
            <div className="flex flex-wrap justify-center gap-2">
              <button
                type="button"
                onClick={() => setCategory("")}
                className={`rounded-full px-3 py-1.5 text-sm font-semibold border ${
                  category === ""
                    ? "text-white border-transparent"
                    : "text-gray-700 border-gray-200 hover:bg-gray-50"
                }`}
                style={category === "" ? { backgroundColor: "var(--color-primary)" } : undefined}
              >
                All
              </button>
              {categories.map((c) => {
                const active = category === c;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCategory(active ? "" : c)}
                    className={`rounded-full px-3 py-1.5 text-sm font-semibold border ${
                      active
                        ? "text-white border-transparent"
                        : "text-gray-700 border-gray-200 hover:bg-gray-50"
                    }`}
                    style={active ? { backgroundColor: "var(--color-primary)" } : undefined}
                  >
                    {titleCaseCategory(c)}
                  </button>
                );
              })}
            </div>
          ) : null}
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
                className="block border rounded-lg overflow-hidden hover:shadow-md transition w-full no-underline text-left"
                style={{ borderColor: "var(--color-earth)", color: "var(--color-heading)" }}
              >
                {g.coverImageUrl ? (
                  <img
                    src={g.coverImageUrl}
                    alt=""
                    className="w-full aspect-[5/2] object-cover object-center"
                  />
                ) : (
                  <div
                    className="w-full aspect-[5/2]"
                    style={{ backgroundColor: "var(--color-section-alt)" }}
                    aria-hidden
                  />
                )}
                <div className="p-4">
                  <h2 className="font-bold text-lg" style={{ fontFamily: "var(--font-heading)" }}>
                    {g.name}
                  </h2>
                  {g.category ? (
                    <span className="text-xs text-gray-500">{titleCaseCategory(g.category)}</span>
                  ) : null}
                  {g.description ? (
                    <p className="text-gray-600 text-sm mt-1 line-clamp-2">{g.description}</p>
                  ) : null}
                  <p className="text-gray-500 text-sm mt-2">
                    {g._count.members} member{g._count.members !== 1 ? "s" : ""} · {g._count.groupPosts}{" "}
                    post{g._count.groupPosts !== 1 ? "s" : ""}
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
