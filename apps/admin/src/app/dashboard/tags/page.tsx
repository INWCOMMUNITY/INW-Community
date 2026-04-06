"use client";

import { useState, useEffect, useMemo } from "react";

const MAIN_URL = process.env.NEXT_PUBLIC_MAIN_SITE_URL || "http://localhost:3000";
const ADMIN_CODE = process.env.NEXT_PUBLIC_ADMIN_CODE ?? "NWC36481";

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
    fetch(`${MAIN_URL}/api/admin/tags`, {
      headers: { "x-admin-code": ADMIN_CODE },
    })
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
      const res = await fetch(`${MAIN_URL}/api/admin/tags/${tag.id}`, {
        method: "DELETE",
        headers: { "x-admin-code": ADMIN_CODE },
      });
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
        Delete global tags. Removing a tag detaches it from posts and blogs and removes follow relationships. Use
        horizontal scroll if a name is very long.
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
      <div className="overflow-x-auto min-w-0 rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="max-h-[min(70vh,720px)] overflow-y-auto">
          <table className="min-w-[640px] w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 sticky top-0 z-10">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Slug</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Posts</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Blogs</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Follows</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Created</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase w-28">Actions</th>
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
                    <td className="px-4 py-2 align-top break-all max-w-md">{t.name}</td>
                    <td className="px-4 py-2 align-top text-gray-600 break-all">{t.slug}</td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">{t._count.postTags}</td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">{t._count.blogTags}</td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">{t._count.followTag}</td>
                    <td className="px-4 py-2 text-gray-500 whitespace-nowrap">
                      {new Date(t.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => handleDelete(t)}
                        disabled={deletingId === t.id}
                        className="text-red-600 hover:underline disabled:opacity-50"
                      >
                        {deletingId === t.id ? "…" : "Delete"}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
