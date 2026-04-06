"use client";

import { useState, useEffect, useMemo } from "react";

interface AdminTag {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  _count: {
    postTags: number;
    blogTags: number;
    followTag: number;
  };
}

export default function AdminTagsPage() {
  const [tags, setTags] = useState<AdminTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/tags")
      .then((r) => r.json())
      .then((data) => setTags(Array.isArray(data) ? data : []))
      .catch(() => setTags([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return tags;
    const q = search.toLowerCase();
    return tags.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.slug.toLowerCase().includes(q) ||
        t.id.toLowerCase().includes(q)
    );
  }, [tags, search]);

  async function handleDelete(tag: AdminTag) {
    const uses = tag._count.postTags + tag._count.blogTags + tag._count.followTag;
    const detail =
      uses > 0
        ? ` This will remove it from ${tag._count.postTags} post(s), ${tag._count.blogTags} blog(s), and ${tag._count.followTag} follow(s).`
        : "";
    if (!confirm(`Delete tag “${tag.name}”?${detail} This cannot be undone.`)) return;
    setDeletingId(tag.id);
    try {
      const res = await fetch(`/api/admin/tags/${tag.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setTags((prev) => prev.filter((t) => t.id !== tag.id));
      } else {
        alert(data.error ?? "Delete failed");
      }
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) return <p className="text-gray-500">Loading…</p>;

  return (
    <div className="min-w-0">
      <h1 className="text-2xl font-bold mb-6">Tags</h1>
      <p className="text-sm text-gray-600 mb-4 max-w-2xl">
        Delete global tags. Removing a tag detaches it from posts and blogs and removes follow relationships. Delete
        stays on the left; use the scrollbars on the tag box if the table is wide or tall.
      </p>
      <div className="mb-4">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, slug, or id…"
          className="w-full max-w-md border rounded px-3 py-2 text-sm"
        />
      </div>
      <div className="admin-xy-scroll rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="w-[max(100%,960px)] table-fixed divide-y divide-gray-200 text-sm">
          <colgroup>
            <col className="w-28" />
            <col />
            <col />
            <col className="w-20" />
            <col className="w-20" />
            <col className="w-20" />
            <col className="w-28" />
          </colgroup>
          <thead className="bg-gray-50">
            <tr>
              <th
                scope="col"
                className="sticky left-0 top-0 z-30 bg-gray-50 px-4 py-2 text-left text-xs font-medium uppercase text-gray-500 shadow-[4px_0_12px_-4px_rgba(0,0,0,0.12)]"
              >
                Actions
              </th>
              <th className="sticky top-0 z-20 bg-gray-50 px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">
                Name
              </th>
              <th className="sticky top-0 z-20 bg-gray-50 px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">
                Slug
              </th>
              <th className="sticky top-0 z-20 bg-gray-50 px-4 py-2 text-right text-xs font-medium uppercase text-gray-500">
                Posts
              </th>
              <th className="sticky top-0 z-20 bg-gray-50 px-4 py-2 text-right text-xs font-medium uppercase text-gray-500">
                Blogs
              </th>
              <th className="sticky top-0 z-20 bg-gray-50 px-4 py-2 text-right text-xs font-medium uppercase text-gray-500">
                Follows
              </th>
              <th className="sticky top-0 z-20 bg-gray-50 px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">
                Created
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                  No tags match your search.
                </td>
              </tr>
            ) : (
              filtered.map((t) => (
                <tr key={t.id}>
                  <td className="sticky left-0 z-10 bg-white px-4 py-2 align-top shadow-[4px_0_12px_-4px_rgba(0,0,0,0.08)]">
                    <button
                      type="button"
                      onClick={() => handleDelete(t)}
                      disabled={deletingId === t.id}
                      className="text-red-600 hover:underline disabled:opacity-50"
                    >
                      {deletingId === t.id ? "…" : "Delete"}
                    </button>
                  </td>
                  <td className="px-4 py-2 align-top break-all">{t.name}</td>
                  <td className="px-4 py-2 align-top break-all text-gray-600">{t.slug}</td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">{t._count.postTags}</td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">{t._count.blogTags}</td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">{t._count.followTag}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-gray-500">
                    {new Date(t.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
