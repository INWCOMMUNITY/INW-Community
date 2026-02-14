"use client";

import { useState, useEffect } from "react";
import { getErrorMessage } from "@/lib/api-error";
import { useRouter } from "next/navigation";

interface BlogCategory {
  id: string;
  name: string;
  slug: string;
}

interface BlogFormProps {
  successRedirect?: string;
}

export function BlogForm({ successRedirect = "/blog" }: BlogFormProps) {
  const router = useRouter();
  const [categories, setCategories] = useState<BlogCategory[]>([]);
  const [photos, setPhotos] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");

  useEffect(() => {
    fetch("/api/blog-categories")
      .then((r) => r.json())
      .then((data) => {
        setCategories(Array.isArray(data) ? data : []);
        if (data?.length && !categoryId) setCategoryId(data[0].id);
      })
      .catch(() => setCategories([]));
  }, [categoryId]);

  async function uploadFile(file: File): Promise<string> {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch("/api/upload/blog", { method: "POST", body: formData });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? "Upload failed");
    const url = data.url;
    if (!url) throw new Error("No URL returned");
    if (url.startsWith("/")) return `${window.location.origin}${url}`;
    return url;
  }

  async function handlePhotosChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files?.length) return;
    setUploadingPhotos(true);
    setError("");
    try {
      for (let i = 0; i < files.length; i++) {
        const url = await uploadFile(files[i]);
        setPhotos((prev) => (prev.includes(url) ? prev : [...prev, url]));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Photo upload failed");
    } finally {
      setUploadingPhotos(false);
      e.target.value = "";
    }
  }

  function removePhoto(i: number) {
    setPhotos((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/blogs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, body, categoryId, photos, tags: tags.length ? tags : undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(getErrorMessage(data.error, "Failed to post blog."));
        return;
      }
      router.push(successRedirect);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-xl">
      <div>
        <label className="block text-sm font-medium mb-1">Photos (optional)</label>
        <label className="cursor-pointer inline-block">
          <span className="inline-block px-4 py-2 border rounded hover:bg-gray-100">
            {uploadingPhotos ? "Uploading…" : "Upload photos"}
          </span>
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={handlePhotosChange}
            disabled={uploadingPhotos}
            className="sr-only"
          />
        </label>
        <p className="text-xs text-gray-500 mt-1">Upload from your device. Max 40MB each. JPEG, PNG, WebP, GIF.</p>
        {photos.length > 0 && (
          <ul className="space-y-2 mt-3">
            {photos.map((url, i) => (
              <li key={i} className="flex items-center gap-2 text-sm">
                <img src={url} alt="" className="w-12 h-12 object-cover rounded" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                <span className="truncate flex-1 text-gray-500">Photo {i + 1}</span>
                <button type="button" onClick={() => removePhoto(i)} className="text-red-600 hover:underline">
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Blog title *</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          className="w-full border rounded px-3 py-2"
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Category *</label>
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          required
          className="w-full border rounded px-3 py-2"
        >
          <option value="">Select category</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Blog content *</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          required
          rows={12}
          className="w-full border rounded px-3 py-2"
          placeholder="Write your blog post here…"
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Tags (optional)</label>
        <div className="flex flex-wrap gap-2 mb-2">
          {tags.map((t, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 bg-gray-200 rounded px-2 py-0.5 text-sm"
            >
              #{t}
              <button
                type="button"
                onClick={() => setTags((p) => p.filter((_, j) => j !== i))}
                className="text-gray-600 hover:text-red-600"
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                const t = tagInput.trim();
                if (t && !tags.includes(t)) setTags((p) => [...p, t]);
                setTagInput("");
              }
            }}
            placeholder="Add tag"
            className="border rounded px-3 py-2 flex-1"
          />
          <button
            type="button"
            onClick={() => {
              const t = tagInput.trim();
              if (t && !tags.includes(t)) {
                setTags((p) => [...p, t]);
                setTagInput("");
              }
            }}
            className="btn text-sm"
          >
            Add
          </button>
        </div>
      </div>
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <button type="submit" className="btn" disabled={submitting}>
        {submitting ? "Posting…" : "Post blog"}
      </button>
      <p className="text-sm text-gray-500">Your blog will be reviewed by an admin before it appears publicly.</p>
    </form>
  );
}
