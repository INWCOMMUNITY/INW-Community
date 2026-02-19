"use client";

import { useState, useEffect } from "react";

interface Badge {
  id: string;
  slug: string;
  name: string;
  description: string;
  imageUrl: string | null;
  category: string;
  criteria: unknown;
  order: number;
}

export default function AdminBadgesPage() {
  const [badges, setBadges] = useState<Badge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addForm, setAddForm] = useState({
    slug: "",
    name: "",
    description: "",
    category: "member" as "business" | "member" | "seller",
  });

  const load = () => {
    setLoading(true);
    fetch("/api/admin/badges")
      .then((r) => r.json())
      .then((data) => setBadges(Array.isArray(data) ? data : []))
      .catch(() => setBadges([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!addForm.slug.trim() || !addForm.name.trim() || !addForm.description.trim()) {
      setError("Slug, name, and description are required.");
      return;
    }
    try {
      const res = await fetch("/api/admin/badges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: addForm.slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-"),
          name: addForm.name.trim(),
          description: addForm.description.trim(),
          category: addForm.category,
          order: badges.length,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Failed to create badge");
        return;
      }
      setAddForm({ slug: "", name: "", description: "", category: "member" });
      load();
    } catch {
      setError("Failed to create badge");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this badge? This will remove it from all members/businesses.")) return;
    try {
      const res = await fetch(`/api/admin/badges/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error ?? "Failed to delete");
        return;
      }
      load();
    } catch {
      alert("Failed to delete");
    }
  };

  if (loading) return <p className="text-gray-500">Loading…</p>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Badges</h1>
      <p className="text-gray-600 mb-6">
        Create and manage badges awarded to members, sellers, and businesses.
      </p>

      <form onSubmit={handleAdd} className="mb-8 p-4 bg-gray-50 rounded-lg space-y-3 max-w-xl">
        <h2 className="font-semibold">Add badge</h2>
        {error && <p className="text-red-600 text-sm">{error}</p>}
        <div>
          <label className="block text-sm font-medium mb-1">Slug (unique id)</label>
          <input
            type="text"
            value={addForm.slug}
            onChange={(e) => setAddForm((p) => ({ ...p, slug: e.target.value }))}
            placeholder="e.g. community_member"
            className="w-full border rounded px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Name</label>
          <input
            type="text"
            value={addForm.name}
            onChange={(e) => setAddForm((p) => ({ ...p, name: e.target.value }))}
            placeholder="e.g. Community Member"
            className="w-full border rounded px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Description</label>
          <textarea
            value={addForm.description}
            onChange={(e) => setAddForm((p) => ({ ...p, description: e.target.value }))}
            placeholder="How to earn this badge"
            rows={2}
            className="w-full border rounded px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Category</label>
          <select
            value={addForm.category}
            onChange={(e) =>
              setAddForm((p) => ({
                ...p,
                category: e.target.value as "business" | "member" | "seller",
              }))
            }
            className="border rounded px-3 py-2 text-sm"
          >
            <option value="member">Member</option>
            <option value="seller">Seller</option>
            <option value="business">Business</option>
          </select>
        </div>
        <button
          type="submit"
          className="px-4 py-2 bg-[#3E432F] text-white rounded text-sm font-medium hover:bg-[#505542]"
        >
          Add badge
        </button>
      </form>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Slug</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {badges.map((b) => (
              <tr key={b.id}>
                <td className="px-4 py-2 text-sm font-mono">{b.slug}</td>
                <td className="px-4 py-2 font-medium">{b.name}</td>
                <td className="px-4 py-2 text-sm capitalize">{b.category}</td>
                <td className="px-4 py-2 text-sm text-gray-600 max-w-xs truncate">{b.description}</td>
                <td className="px-4 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => handleDelete(b.id)}
                    className="text-red-600 hover:underline text-sm"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {badges.length === 0 && (
          <p className="p-6 text-gray-500 text-center">No badges yet. Add one above.</p>
        )}
      </div>
    </div>
  );
}
