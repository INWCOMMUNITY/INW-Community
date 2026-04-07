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
  const [allowBusinessPosts, setAllowBusinessPosts] = useState(false);
  const [rules, setRules] = useState("");
  const [success, setSuccess] = useState(false);
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
    setSuccess(false);
    try {
      const res = await fetch("/api/group-creation-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          category: category.trim() || undefined,
          coverImageUrl: coverImageUrl || undefined,
          rules: rules.trim() || undefined,
          allowBusinessPosts,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setSuccess(true);
        setName("");
        setDescription("");
        setCategory("");
        setCoverImageUrl("");
        setRules("");
        setAllowBusinessPosts(false);
      } else {
        setError(getErrorMessage(data.error, "Failed to submit group request"));
      }
    } catch {
      setError("Failed to submit group request");
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
        <h1 className="text-3xl font-bold mb-2">Request a new group</h1>
        <p className="text-gray-600 text-sm mb-6">
          Your request is reviewed by Northwest Community. If it is not approved, you will receive an email explaining why.
        </p>
        <form onSubmit={handleSubmit} className="max-w-xl space-y-4">
          {success && (
            <p className="text-green-700 text-sm rounded border border-green-200 bg-green-50 px-3 py-2">
              Request submitted. You will be able to open your group from the groups list after approval. Check your email
              if you hear back about a denial.
            </p>
          )}
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
            <label htmlFor="rules" className="block text-sm font-medium mb-1">Group rules (optional)</label>
            <textarea
              id="rules"
              value={rules}
              onChange={(e) => setRules(e.target.value)}
              maxLength={5000}
              rows={4}
              className="border rounded px-3 py-2 w-full"
              placeholder="Members may need to agree before joining."
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
          <div className="flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50/80 p-4">
            <input
              id="allowBusinessPosts"
              type="checkbox"
              checked={allowBusinessPosts}
              onChange={(e) => setAllowBusinessPosts(e.target.checked)}
              className="mt-1 h-4 w-4 shrink-0"
            />
            <label htmlFor="allowBusinessPosts" className="text-sm text-gray-700 cursor-pointer">
              <span className="font-medium text-gray-900">Allow businesses to post in this group</span>
              <span className="block text-gray-600 mt-1">
                When enabled, members with a business on the directory can choose to post as that business here.
                You can change this later in group settings.
              </span>
            </label>
          </div>
          <div className="flex gap-3">
            <button type="submit" disabled={loading} className="btn">
              {loading ? "Submitting…" : "Submit request"}
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
