"use client";

import { useState, useRef, useEffect } from "react";
import { getErrorMessage } from "@/lib/api-error";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { IonIcon } from "@/components/IonIcon";

const POST_ACTION_BTN =
  "inline-flex items-center gap-2 rounded-lg border-2 border-[var(--color-primary)] px-3 py-2 font-medium text-sm text-gray-800 bg-white hover:bg-gray-100 transition";

const FORM_FOOTER_BTN =
  "btn inline-flex items-center justify-center gap-2 py-1.5 px-3 text-sm min-h-0";

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
  /** When provided, post is created as a business post (shared_business). Used when opening from Seller Hub. */
  initialSharedBusinessId?: string;
  /** When initialSharedBusinessId is set, optional business name to show as "Posting as [name]". */
  initialSharedBusinessName?: string;
  /** Where to navigate after submit when onSuccess is not provided. */
  returnTo?: string;
  /** Set to update an existing post (author only); locks group / business context. */
  editPostId?: string;
  initialContent?: string | null;
  initialPhotos?: string[];
  initialVideos?: string[];
  initialLinks?: { url: string; title: string }[];
  initialTags?: string[];
}

export function CreatePostForm({
  onCancel,
  onSuccess,
  initialGroupId = "",
  initialSharedBusinessId,
  initialSharedBusinessName,
  returnTo = "",
  editPostId,
  initialContent,
  initialPhotos,
  initialVideos,
  initialLinks,
  initialTags,
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
  const [tagPanelOpen, setTagPanelOpen] = useState(false);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);
  const lockPostingContext = !!editPostId;

  useEffect(() => {
    if (!editPostId) return;
    if (initialContent !== undefined) setContent(initialContent ?? "");
    if (initialPhotos !== undefined) setPhotos(initialPhotos);
    if (initialVideos !== undefined) setVideos(initialVideos);
    if (initialLinks !== undefined) setLinks(initialLinks);
    if (initialTags !== undefined) setTags(initialTags);
    if (initialGroupId !== undefined) setGroupId(initialGroupId || "");
  }, [
    editPostId,
    initialContent,
    initialPhotos,
    initialVideos,
    initialLinks,
    initialTags,
    initialGroupId,
  ]);

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
      const res = await fetch("/api/upload/post", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
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

  function addLinkRow() {
    setLinks((prev) => [...prev, { url: "", title: "" }]);
  }

  function addTag() {
    const t = tagInput.trim().replace(/^#/, "");
    if (t && !tags.includes(t)) {
      setTags((prev) => [...prev, t]);
      setTagInput("");
      setTagPanelOpen(true);
    }
  }

  function openTagPanel() {
    setTagPanelOpen(true);
    requestAnimationFrame(() => tagInputRef.current?.focus());
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      if (editPostId) {
        const res = await fetch(`/api/posts/${editPostId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            content: content.trim() || null,
            photos: photos.filter((p) => p.trim()),
            videos: videos.filter((v) => v.trim()),
            links: links.filter((l) => l.url?.trim()).length ? links.filter((l) => l.url?.trim()) : undefined,
            tags: tags.length ? tags : undefined,
            taggedMemberIds: taggedFriendIds.size ? Array.from(taggedFriendIds) : undefined,
          }),
        });
        const data = await res.json();
        if (res.ok) {
          if (onSuccess) onSuccess();
          else {
            router.push(returnTo && returnTo.startsWith("/") ? returnTo : "/my-community/feed");
            router.refresh();
          }
        } else {
          setError(getErrorMessage(data.error, "Failed to update post"));
        }
        return;
      }

      const res = await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          content: content.trim() || null,
          photos: photos.filter((p) => p.trim()),
          videos: videos.filter((v) => v.trim()),
          links: links.filter((l) => l.url?.trim()).length ? links.filter((l) => l.url?.trim()) : undefined,
          tags: tags.length ? tags : undefined,
          taggedMemberIds: taggedFriendIds.size ? Array.from(taggedFriendIds) : undefined,
          groupId: groupId || null,
          ...(initialSharedBusinessId
            ? { sharedItemType: "business" as const, sharedItemId: initialSharedBusinessId }
            : {}),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        if (onSuccess) {
          onSuccess();
        } else {
          router.push(returnTo && returnTo.startsWith("/") ? returnTo : "/my-community/feed");
          router.refresh();
        }
      } else {
        setError(getErrorMessage(data.error, "Failed to create post"));
      }
    } catch {
      setError(editPostId ? "Failed to update post" : "Failed to create post");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      {!onCancel && (
        <>
          <Link href="/my-community/feed" className="text-sm text-gray-600 hover:underline mb-4 inline-block">
            ← Back to feed
          </Link>
          <h1 className="text-2xl font-bold mb-6">{editPostId ? "Edit post" : "Create Post"}</h1>
        </>
      )}
      <form onSubmit={handleSubmit} className="max-w-xl space-y-4">
        {error && <p className="text-red-600 text-sm">{error}</p>}
        {initialSharedBusinessId && (
          <p className="text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded px-3 py-2">
            Posting as <strong>{initialSharedBusinessName ?? "your business"}</strong> (business directory)
          </p>
        )}
        {groups.length > 0 && !initialSharedBusinessId && !initialGroupId && (
          <div>
            <label htmlFor="group" className="block text-sm font-medium mb-1">Post to</label>
            <select
              id="group"
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              disabled={lockPostingContext}
              className="border rounded px-3 py-2 w-full disabled:bg-gray-100 disabled:cursor-not-allowed"
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
          <label className="block text-sm font-medium mb-1">Photos & Videos</label>
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
          <label htmlFor="content" className="block text-sm font-medium mb-1">Add Caption</label>
          <textarea
            id="content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            maxLength={5000}
            rows={5}
            className="border rounded px-3 py-2 w-full"
            placeholder="Add a caption for your post..."
          />
          <div className="flex flex-wrap gap-2 mt-3">
            {friends.length > 0 && (
              <button
                type="button"
                onClick={() => setTagFriendsOpen((o) => !o)}
                className={POST_ACTION_BTN}
                aria-expanded={tagFriendsOpen}
              >
                <IonIcon name="people-outline" size={18} className="text-[var(--color-primary)]" />
                Tag Friends
                {taggedFriendIds.size > 0 ? ` (${taggedFriendIds.size})` : ""}
              </button>
            )}
            <button
              type="button"
              onClick={() => (tagPanelOpen ? setTagPanelOpen(false) : openTagPanel())}
              className={POST_ACTION_BTN}
              aria-expanded={tagPanelOpen}
            >
              <IonIcon name="pricetag-outline" size={18} className="text-[var(--color-primary)]" />
              Create Tag
            </button>
            <button type="button" onClick={addLinkRow} className={POST_ACTION_BTN}>
              <IonIcon name="link-outline" size={18} className="text-[var(--color-primary)]" />
              Add Link
            </button>
          </div>
          {links.length > 0 && (
            <div className="mt-3 space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
              <p className="text-xs font-medium text-gray-600">Links</p>
              {links.map((l, i) => (
                <div key={i} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input
                    type="url"
                    value={l.url}
                    onChange={(e) =>
                      setLinks((prev) => prev.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))
                    }
                    className="border rounded px-3 py-2 flex-1 bg-white text-sm"
                    placeholder="https://..."
                  />
                  <input
                    type="text"
                    value={l.title}
                    onChange={(e) =>
                      setLinks((prev) => prev.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))
                    }
                    className="border rounded px-3 py-2 sm:w-36 bg-white text-sm"
                    placeholder="Title (optional)"
                  />
                  <button
                    type="button"
                    onClick={() => setLinks((prev) => prev.filter((_, j) => j !== i))}
                    className="text-sm text-red-600 hover:underline shrink-0"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
          {friends.length > 0 && tagFriendsOpen && (
            <div className="mt-3 p-3 border-2 border-[var(--color-primary)] rounded-lg bg-gray-50 max-h-48 overflow-y-auto">
              <p className="text-xs font-medium text-gray-600 mb-2">Tag Friends</p>
              <ul className="space-y-1">
                {friends.map((f) => (
                  <li key={f.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id={`tag-friend-${f.id}`}
                      checked={taggedFriendIds.has(f.id)}
                      onChange={() => toggleTaggedFriend(f.id)}
                      className="rounded border-[var(--color-primary)]"
                    />
                    <label htmlFor={`tag-friend-${f.id}`} className="cursor-pointer text-sm">
                      {f.firstName} {f.lastName}
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(tagPanelOpen || tags.length > 0) && (
            <div className="mt-3 p-3 border-2 border-[var(--color-primary)] rounded-lg bg-gray-50">
              <p className="text-xs font-medium text-gray-600 mb-2">Tags</p>
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {tags.map((t, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1 rounded-lg border border-[var(--color-primary)] bg-white px-2 py-0.5 text-sm"
                    >
                      #{t}
                      <button
                        type="button"
                        onClick={() => setTags((p) => p.filter((_, j) => j !== i))}
                        className="text-gray-600 hover:text-red-600 leading-none"
                        aria-label={`Remove tag ${t}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
              {tagPanelOpen && (
                <div className="flex gap-2">
                  <input
                    ref={tagInputRef}
                    type="text"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addTag())}
                    placeholder="New tag name"
                    className="border rounded px-3 py-2 flex-1 bg-white text-sm"
                  />
                  <button type="button" onClick={addTag} className={POST_ACTION_BTN}>
                    Add
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex gap-3">
          <button type="submit" disabled={loading} className={FORM_FOOTER_BTN}>
            {!loading && (
              <IonIcon
                name={editPostId ? "checkmark-outline" : "send-outline"}
                size={18}
                className="shrink-0"
              />
            )}
            {loading ? (editPostId ? "Saving…" : "Posting…") : editPostId ? "Save changes" : "Post"}
          </button>
          {onCancel ? (
            <button type="button" onClick={onCancel} className={`${FORM_FOOTER_BTN} border`}>
              <IonIcon name="close-outline" size={18} className="shrink-0" />
              Cancel
            </button>
          ) : (
            <Link href="/my-community/feed" className={`${FORM_FOOTER_BTN} border`}>
              <IonIcon name="close-outline" size={18} className="shrink-0" />
              Cancel
            </Link>
          )}
        </div>
      </form>
    </div>
  );
}
