"use client";

import { useState, useRef, useEffect } from "react";
import { getErrorMessage } from "@/lib/api-error";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface Group {
  id: string;
  name: string;
  slug: string;
}

interface Friend {
  id: string;
  firstName: string;
  lastName: string;
  profilePhotoUrl?: string | null;
}

interface CreatePostFormProps {
  /** When provided, form is used in a modal: no back link, Cancel calls this. */
  onCancel?: () => void;
  /** When provided, called after successful submit instead of navigating. */
  onSuccess?: () => void;
  /** Initial group to post to (e.g. when opened from a group page). */
  initialGroupId?: string;
  /** Where to navigate after submit when onSuccess is not provided. */
  returnTo?: string;
}

export function CreatePostForm({
  onCancel,
  onSuccess,
  initialGroupId = "",
  returnTo = "",
}: CreatePostFormProps) {
  const router = useRouter();
  const [content, setContent] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [videos, setVideos] = useState<string[]>([]);
  const [links, setLinks] = useState<{ url: string; title: string }[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [groupId, setGroupId] = useState(initialGroupId);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [friends, setFriends] = useState<Friend[]>([]);
  const [taggedFriendIds, setTaggedFriendIds] = useState<Set<string>>(new Set());
  const [tagFriendsOpen, setTagFriendsOpen] = useState(false);
  const mediaInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/me/groups?scope=member")
      .then((r) => r.json())
      .then((data) => {
        const list = data.groups ?? [];
        setGroups(list);
        if (initialGroupId && !groupId) setGroupId(initialGroupId);
      })
      .catch(() => setGroups([]));
  }, [initialGroupId]);

  useEffect(() => {
    fetch("/api/me/friends")
      .then((r) => r.json())
      .then((data) => setFriends(data.friends ?? []))
      .catch(() => setFriends([]));
  }, []);

  function toggleTaggedFriend(id: string) {
    setTaggedFriendIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const isImage = (file: File) => file.type.startsWith("image/");
  const isVideo = (file: File) => file.type.startsWith("video/");

  async function handleMediaUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const type = isImage(file) ? "image" : isVideo(file) ? "video" : null;
    if (!type) {
      alert("Please choose an image or video file.");
      e.target.value = "";
      return;
    }
    setUploading(type);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("type", type);
      const res = await fetch("/api/upload/post", { method: "POST", body: formData });
      const data = await res.json();
      if (res.ok && data.url) {
        if (type === "image") setPhotos((prev) => [...prev, data.url]);
        else setVideos((prev) => [...prev, data.url]);
      } else {
        alert(data.error ?? "Upload failed");
      }
    } finally {
      setUploading(null);
      e.target.value = "";
    }
  }

  function addLink() {
    const url = prompt("Enter URL:");
    if (url) {
      try {
        new URL(url);
        setLinks((prev) => [...prev, { url, title: "" }]);
      } catch {
        alert("Invalid URL");
      }
    }
  }

  function addTag() {
    const t = tagInput.trim();
    if (t && !tags.includes(t)) {
      setTags((prev) => [...prev, t]);
      setTagInput("");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: content.trim() || null,
          photos: photos.filter((p) => p.trim()),
          videos: videos.filter((v) => v.trim()),
          links: links.filter((l) => l.url?.trim()).length ? links.filter((l) => l.url?.trim()) : undefined,
          tags: tags.length ? tags : undefined,
          taggedMemberIds: taggedFriendIds.size ? Array.from(taggedFriendIds) : undefined,
          groupId: groupId || null,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        if (onSuccess) {
          onSuccess();
        } else {
          router.push(returnTo && returnTo.startsWith("/") ? returnTo : "/my-community");
          router.refresh();
        }
      } else {
        setError(getErrorMessage(data.error, "Failed to create post"));
      }
    } catch {
      setError("Failed to create post");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      {!onCancel && (
        <>
          <Link href="/my-community" className="text-sm text-gray-600 hover:underline mb-4 inline-block">
            ← Back to feed
          </Link>
          <h1 className="text-2xl font-bold mb-6">Create post</h1>
        </>
      )}
      <form onSubmit={handleSubmit} className="max-w-xl space-y-4">
        {error && <p className="text-red-600 text-sm">{error}</p>}
        {groups.length > 0 && (
          <div>
            <label htmlFor="group" className="block text-sm font-medium mb-1">Post to</label>
            <select
              id="group"
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              className="border rounded px-3 py-2 w-full"
            >
              <option value="">Personal (your feed)</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label htmlFor="content" className="block text-sm font-medium mb-1">What&apos;s on your mind?</label>
          <textarea
            id="content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            maxLength={5000}
            rows={5}
            className="border rounded px-3 py-2 w-full"
            placeholder="Share an update, link, or thought..."
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Photos & videos</label>
          <input
            ref={mediaInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime"
            onChange={handleMediaUpload}
            className="hidden"
          />
          <div className="flex flex-wrap gap-2">
            {photos.map((url, i) => (
              <div key={`p-${i}`} className="relative">
                <img src={url} alt="" className="w-20 h-20 object-cover rounded" />
                <button
                  type="button"
                  onClick={() => setPhotos((p) => p.filter((_, j) => j !== i))}
                  className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs"
                >
                  ×
                </button>
              </div>
            ))}
            {videos.map((url, i) => (
              <div key={`v-${i}`} className="relative">
                <video src={url} className="w-32 h-24 object-cover rounded" controls />
                <button
                  type="button"
                  onClick={() => setVideos((p) => p.filter((_, j) => j !== i))}
                  className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs"
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => mediaInputRef.current?.click()}
              disabled={!!uploading}
              className="w-20 h-20 border-2 border-dashed rounded flex items-center justify-center text-gray-500 hover:bg-gray-50 disabled:opacity-50"
            >
              {uploading ? "…" : "+"}
            </button>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Links</label>
          {links.map((l, i) => (
            <div key={i} className="flex gap-2 mb-2">
              <input
                type="url"
                value={l.url}
                onChange={(e) =>
                  setLinks((prev) => prev.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))
                }
                className="border rounded px-3 py-2 flex-1"
                placeholder="URL"
              />
              <input
                type="text"
                value={l.title}
                onChange={(e) =>
                  setLinks((prev) => prev.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))
                }
                className="border rounded px-3 py-2 w-32"
                placeholder="Title"
              />
              <button
                type="button"
                onClick={() => setLinks((prev) => prev.filter((_, j) => j !== i))}
                className="text-red-600 hover:underline"
              >
                Remove
              </button>
            </div>
          ))}
          <button type="button" onClick={addLink} className="text-sm text-blue-600 hover:underline">
            + Add link
          </button>
        </div>
        {friends.length > 0 && (
          <div>
            <label className="block text-sm font-medium mb-1">Tag friends</label>
            <button
              type="button"
              onClick={() => setTagFriendsOpen((o) => !o)}
              className="btn border text-sm"
            >
              {tagFriendsOpen ? "Hide friends" : taggedFriendIds.size > 0 ? `${taggedFriendIds.size} friend(s) tagged` : "Select friends to tag"}
            </button>
            {tagFriendsOpen && (
              <div className="mt-2 p-3 border rounded-lg bg-gray-50 max-h-48 overflow-y-auto">
                <ul className="space-y-1">
                  {friends.map((f) => (
                    <li key={f.id} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id={`tag-friend-${f.id}`}
                        checked={taggedFriendIds.has(f.id)}
                        onChange={() => toggleTaggedFriend(f.id)}
                        className="rounded"
                      />
                      <label htmlFor={`tag-friend-${f.id}`} className="cursor-pointer text-sm">
                        {f.firstName} {f.lastName}
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        <div>
          <label className="block text-sm font-medium mb-1">Tags (visible with post)</label>
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
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addTag())}
              placeholder="Add tag (create new or existing)"
              className="border rounded px-3 py-2 flex-1"
            />
            <button type="button" onClick={addTag} className="btn text-sm">
              Add
            </button>
          </div>
        </div>
        <div className="flex gap-3">
          <button type="submit" disabled={loading} className="btn">
            {loading ? "Posting…" : "Post"}
          </button>
          {onCancel ? (
            <button type="button" onClick={onCancel} className="btn border">
              Cancel
            </button>
          ) : (
            <Link href="/my-community" className="btn border">
              Cancel
            </Link>
          )}
        </div>
      </form>
    </div>
  );
}
