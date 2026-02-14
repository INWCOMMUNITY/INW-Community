"use client";

import { useState, useEffect } from "react";

interface Tag {
  id: string;
  name: string;
  slug: string;
}

export default function MyTagsPage() {
  const [followedTags, setFollowedTags] = useState<Tag[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/api/me/followed-tags").then((r) => r.json()),
      fetch("/api/tags?limit=100").then((r) => r.json()),
    ])
      .then(([followed, all]) => {
        setFollowedTags(followed.tags ?? []);
        setAllTags(all.tags ?? []);
      })
      .catch(() => {
        setFollowedTags([]);
        setAllTags([]);
      })
      .finally(() => setLoading(false));
  }, []);

  async function toggleFollow(tagId: string, currentlyFollowing: boolean) {
    const res = await fetch(`/api/tags/${tagId}/follow`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: currentlyFollowing ? "unfollow" : "follow" }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.following) {
        const tag = allTags.find((t) => t.id === tagId);
        if (tag) setFollowedTags((prev) => [...prev.filter((t) => t.id !== tagId), tag]);
      } else {
        setFollowedTags((prev) => prev.filter((t) => t.id !== tagId));
      }
    }
  }

  const filteredTags = search.trim()
    ? allTags.filter((t) => t.name.toLowerCase().includes(search.toLowerCase()))
    : allTags;
  const followedIds = new Set(followedTags.map((t) => t.id));

  if (loading) return <p className="text-gray-500">Loading…</p>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Following Tags</h1>
      <p className="text-gray-600 mb-6">
        Tags you follow. Posts and blogs with these tags will appear in your feed.
      </p>
      <input
        type="search"
        placeholder="Search tags…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="border rounded px-3 py-2 w-64 mb-6"
      />
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold mb-3">Following ({followedTags.length})</h2>
          {followedTags.length === 0 ? (
            <p className="text-gray-500">You are not following any tags yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {followedTags.map((t) => (
                <span
                  key={t.id}
                  className="inline-flex items-center gap-2 bg-blue-100 rounded px-3 py-1 text-sm"
                >
                  #{t.name}
                  <button
                    type="button"
                    onClick={() => toggleFollow(t.id, true)}
                    className="text-red-600 hover:underline"
                  >
                    Unfollow
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
        <div>
          <h2 className="text-lg font-semibold mb-3">All tags</h2>
          <div className="flex flex-wrap gap-2">
            {filteredTags.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => toggleFollow(t.id, followedIds.has(t.id))}
                className={`px-3 py-1 rounded text-sm border ${
                  followedIds.has(t.id) ? "bg-blue-100 border-blue-300" : "bg-white border-gray-300 hover:bg-gray-50"
                }`}
              >
                #{t.name} {followedIds.has(t.id) ? "✓" : "+"}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
