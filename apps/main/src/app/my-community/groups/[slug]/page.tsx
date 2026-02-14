"use client";

import { useState, useEffect, useRef } from "react";
import { getErrorMessage } from "@/lib/api-error";
import Link from "next/link";
import { useParams } from "next/navigation";

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

export default function GroupAdminPage() {
  const params = useParams();
  const slug = params.slug as string;
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [coverImageUrl, setCoverImageUrl] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!slug) return;
    fetch(`/api/groups/${slug}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setGroup(null);
          return;
        }
        setGroup(data);
        setName(data.name);
        setDescription(data.description ?? "");
        setCategory(data.category ?? "");
        setCoverImageUrl(data.coverImageUrl ?? "");
      })
      .catch(() => setGroup(null))
      .finally(() => setLoading(false));
  }, [slug]);

  async function handleCoverUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload/group", { method: "POST", body: formData });
      const data = await res.json();
      if (res.ok && data.url) {
        setCoverImageUrl(data.url);
      } else {
        alert(data.error ?? "Upload failed");
      }
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!group) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/groups/${group.slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          category: category.trim() || null,
          coverImageUrl: coverImageUrl || null,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setGroup((prev) => prev ? { ...prev, ...data } : null);
      } else {
        setError(data.error ?? "Failed to save");
      }
    } catch {
      setError("Failed to save");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-gray-500">Loading…</p>;
  if (!group) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-4">Group not found</h1>
        <Link href="/my-community/groups" className="btn">Back to My Groups</Link>
      </div>
    );
  }

  const isAdmin = group.memberRole === "admin" || group.createdBy;
  if (!isAdmin) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-4">Access denied</h1>
        <p className="text-gray-600 mb-4">Only group admins can access this page.</p>
        <Link href={`/community-groups/${group.slug}`} className="btn">View group</Link>
      </div>
    );
  }

  return (
    <div>
      <Link href="/my-community/groups" className="text-sm text-gray-600 hover:underline mb-4 inline-block">
        ← Back to My Groups
      </Link>
      <h1 className="text-2xl font-bold mb-6">Manage group: {group.name}</h1>
      <form onSubmit={handleSave} className="max-w-xl space-y-4">
        {error && <p className="text-red-600 text-sm">{error}</p>}
        <div>
          <label htmlFor="name" className="block text-sm font-medium mb-1">Name *</label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            className="border rounded px-3 py-2 w-full"
            required
          />
        </div>
        <div>
          <label htmlFor="description" className="block text-sm font-medium mb-1">Description</label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={2000}
            rows={4}
            className="border rounded px-3 py-2 w-full"
          />
        </div>
        <div>
          <label htmlFor="category" className="block text-sm font-medium mb-1">Category</label>
          <input
            id="category"
            type="text"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            maxLength={50}
            className="border rounded px-3 py-2 w-full"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Cover photo</label>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            onChange={handleCoverUpload}
            className="hidden"
          />
          {coverImageUrl ? (
            <div className="space-y-2">
              <img src={coverImageUrl} alt="Cover" className="w-48 h-32 object-cover rounded border" />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="text-sm text-blue-600 hover:underline"
                >
                  {uploading ? "Uploading…" : "Change photo"}
                </button>
                <button
                  type="button"
                  onClick={() => setCoverImageUrl("")}
                  className="text-sm text-gray-600 hover:underline"
                >
                  Remove
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="border rounded px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
            >
              {uploading ? "Uploading…" : "Upload cover photo"}
            </button>
          )}
        </div>
        <div className="flex gap-3">
          <button type="submit" disabled={saving} className="btn">
            {saving ? "Saving…" : "Save changes"}
          </button>
          <Link href={`/community-groups/${group.slug}`} className="btn border">
            View group
          </Link>
        </div>
      </form>
      <InviteAdminSection groupSlug={group.slug} />
    </div>
  );
}

function InviteAdminSection({ groupSlug }: { groupSlug: string }) {
  const [inviteeId, setInviteeId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteeId.trim()) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/groups/${groupSlug}/invite-admin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteeId: inviteeId.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setInviteeId("");
        alert("Invite sent!");
      } else {
        setError(getErrorMessage(data.error, "Failed to invite"));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-8 border-t pt-8">
      <h2 className="text-xl font-bold mb-4">Invite admin</h2>
      <p className="text-gray-600 text-sm mb-4">
        Enter a member ID to invite them as a group admin. They must already be a member of the group, or they will be added when they accept.
      </p>
      <form onSubmit={handleInvite} className="flex gap-2 max-w-md">
        <input
          type="text"
          value={inviteeId}
          onChange={(e) => setInviteeId(e.target.value)}
          placeholder="Member ID"
          className="border rounded px-3 py-2 flex-1"
        />
        <button type="submit" disabled={loading} className="btn">
          {loading ? "Inviting…" : "Invite"}
        </button>
      </form>
      {error && <p className="text-red-600 text-sm mt-2">{error}</p>}
    </div>
  );
}
