"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { getErrorMessage } from "@/lib/api-error";

export default function NewGroupPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [coverImageUrl, setCoverImageUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          category: category.trim() || undefined,
          coverImageUrl: coverImageUrl || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        router.push(`/my-community/groups/${data.group.slug}`);
      } else {
        setError(getErrorMessage(data.error, "Failed to create group"));
      }
    } catch {
      setError("Failed to create group");
    } finally {
      setLoading(false);
    }
  }

  if (status === "unauthenticated") {
    return (
      <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
        <div className="max-w-[var(--max-width)] mx-auto text-center">
          <h1 className="text-2xl font-bold mb-4">Sign in to create a group</h1>
          <p className="text-gray-600 mb-4">You need to be signed in to create a community group.</p>
          <Link href={`/login?callbackUrl=/community-groups/new`} className="btn">Sign in</Link>
        </div>
      </section>
    );
  }

  return (
    <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
      <div className="max-w-[var(--max-width)] mx-auto">
        <Link href="/community-groups" className="text-sm text-gray-600 hover:underline mb-4 inline-block">
          ← Back to groups
        </Link>
        <h1 className="text-3xl font-bold mb-6">Create a group</h1>
        <form onSubmit={handleSubmit} className="max-w-xl space-y-4">
          {error && (
            <p className="text-red-600 text-sm">{error}</p>
          )}
          <div>
            <label htmlFor="name" className="block text-sm font-medium mb-1">Name *</label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              className="border rounded px-3 py-2 w-full"
              placeholder="e.g. Local Artists"
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
              placeholder="What is this group about?"
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
              placeholder="e.g. Arts, Sports, Local"
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
              <div className="relative inline-block">
                <img src={coverImageUrl} alt="Cover" className="w-48 h-32 object-cover rounded border" />
                <div className="flex gap-2 mt-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="text-sm text-blue-600 hover:underline"
                  >
                    {uploading ? "Uploading…" : "Change"}
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
            <button type="submit" disabled={loading} className="btn">
              {loading ? "Creating…" : "Create group"}
            </button>
            <Link href="/community-groups" className="btn border">
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </section>
  );
}
