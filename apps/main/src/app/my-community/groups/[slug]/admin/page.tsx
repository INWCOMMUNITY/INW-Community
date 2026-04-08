"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { getErrorMessage } from "@/lib/api-error";

type Tab = "members" | "flagged" | "settings";

interface AdminGroup {
  id: string;
  name: string;
  slug: string;
}

interface Overview {
  slug: string;
  name: string;
  isCreator: boolean;
  pendingDeletionRequest: { id: string; createdAt: string } | null;
}

interface MemberRow {
  id: string;
  memberId: string;
  role: string;
  joinedAt: string;
  isCreator: boolean;
  member: { id: string; firstName: string; lastName: string; profilePhotoUrl: string | null };
}

interface ReportRow {
  id: string;
  contentId: string;
  reason: string;
  details: string | null;
  createdAt: string;
  reporter: { id: string; firstName: string; lastName: string };
  post: { id: string; content: string | null; createdAt: string } | null;
}

interface FriendRow {
  id: string;
  firstName: string;
  lastName: string;
  profilePhotoUrl: string | null;
  city: string | null;
}

function PostPreviewModalBody({ post }: { post: Record<string, unknown> }) {
  const author = post.author as { firstName?: string; lastName?: string } | undefined;
  const name = author ? `${author.firstName ?? ""} ${author.lastName ?? ""}`.trim() : "Member";
  const content = typeof post.content === "string" ? post.content : "";
  const photos = Array.isArray(post.photos)
    ? post.photos.filter((x): x is string => typeof x === "string")
    : [];
  return (
    <>
      <p className="text-sm text-gray-500 mb-2">{name || "Member"}</p>
      {content ? <p className="whitespace-pre-wrap text-sm">{content}</p> : <p className="text-sm text-gray-400">No text</p>}
      <div className="mt-3 space-y-2">
        {photos.map((url) => (
          <img key={url} src={url} alt="" className="max-h-64 w-full object-contain rounded border" />
        ))}
      </div>
    </>
  );
}

function GroupAdminHubContent() {
  const params = useParams();
  const slug = params.slug as string;
  const searchParams = useSearchParams();
  const inviteHandledRef = useRef(false);

  const [tab, setTab] = useState<Tab>("members");
  const [adminGroups, setAdminGroups] = useState<AdminGroup[]>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [coverImageUrl, setCoverImageUrl] = useState("");
  const [rules, setRules] = useState("");
  const [allowBusinessPosts, setAllowBusinessPosts] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [friends, setFriends] = useState<FriendRow[]>([]);
  const [friendQuery, setFriendQuery] = useState("");
  /** Dropdown only while the search field is focused (not merely when text remains). */
  const [inviteFieldFocused, setInviteFieldFocused] = useState(false);
  const inviteComboboxRef = useRef<HTMLDivElement>(null);
  const inviteFriendInputRef = useRef<HTMLInputElement>(null);
  const inviteFieldBlurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [inviteBusyId, setInviteBusyId] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState("");
  const [requestDelBusy, setRequestDelBusy] = useState(false);

  const [postModalId, setPostModalId] = useState<string | null>(null);
  const [postModalData, setPostModalData] = useState<Record<string, unknown> | null>(null);
  const [postModalLoading, setPostModalLoading] = useState(false);
  const [dismissBusyId, setDismissBusyId] = useState<string | null>(null);

  const loadAdminGroups = useCallback(async () => {
    try {
      const res = await fetch("/api/me/groups?scope=admin");
      const data = await res.json();
      setAdminGroups(Array.isArray(data.groups) ? data.groups : []);
    } catch {
      setAdminGroups([]);
    }
  }, []);

  const loadData = useCallback(async () => {
    if (!slug) return;
    setError("");
    try {
      const [ovRes, memRes, repRes, grpRes] = await Promise.all([
        fetch(`/api/groups/${slug}/admin/overview`),
        fetch(`/api/groups/${slug}/admin/members?limit=100`),
        fetch(`/api/groups/${slug}/admin/reported-posts`),
        fetch(`/api/groups/${slug}`),
      ]);
      const ov = await ovRes.json();
      const mem = await memRes.json();
      const rep = await repRes.json();
      const grp = await grpRes.json();
      if (!ovRes.ok) {
        setError(ov.error ?? "Access denied");
        setOverview(null);
        return;
      }
      setOverview(ov);
      setMembers(Array.isArray(mem.members) ? mem.members : []);
      setReports(Array.isArray(rep.reports) ? rep.reports : []);
      if (grpRes.ok && !grp.error) {
        setName(grp.name ?? "");
        setDescription(grp.description ?? "");
        setCategory(grp.category ?? "");
        setCoverImageUrl(grp.coverImageUrl ?? "");
        setRules(grp.rules ?? "");
        setAllowBusinessPosts(!!grp.allowBusinessPosts);
      }
    } catch {
      setError("Failed to load");
    }
  }, [slug]);

  useEffect(() => {
    void loadAdminGroups();
  }, [loadAdminGroups]);

  useEffect(() => {
    if (tab !== "settings") return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/me/friends");
        const data = await res.json();
        if (!cancelled && res.ok && Array.isArray(data.friends)) {
          setFriends(data.friends as FriendRow[]);
        }
      } catch {
        if (!cancelled) setFriends([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab]);

  useEffect(() => {
    setLoading(true);
    void loadData().finally(() => setLoading(false));
  }, [loadData]);

  useEffect(() => {
    if (searchParams.get("adminInvite") !== "1" || inviteHandledRef.current) return;
    inviteHandledRef.current = true;
    void (async () => {
      try {
        const res = await fetch(`/api/groups/${slug}/admin-invite`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "accept" }),
        });
        if (res.ok) {
          alert("You accepted the co-admin invite.");
          await loadData();
        } else {
          const data = await res.json().catch(() => ({}));
          alert(getErrorMessage(data.error, "Could not accept invite."));
        }
      } catch {
        alert("Could not accept invite.");
      }
    })();
  }, [searchParams, slug, loadData]);

  useEffect(() => {
    if (!postModalId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPostModalId(null);
        setPostModalData(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [postModalId]);

  useEffect(() => {
    if (!inviteFieldFocused) return;
    const onDoc = (e: MouseEvent) => {
      if (inviteComboboxRef.current?.contains(e.target as Node)) return;
      if (inviteFieldBlurTimerRef.current) {
        clearTimeout(inviteFieldBlurTimerRef.current);
        inviteFieldBlurTimerRef.current = null;
      }
      setInviteFieldFocused(false);
      inviteFriendInputRef.current?.blur();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [inviteFieldFocused]);

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

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/groups/${slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          category: category.trim() || null,
          coverImageUrl: coverImageUrl || null,
          rules: rules.trim() || null,
          allowBusinessPosts,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(getErrorMessage(data.error, "Failed to save"));
        return;
      }
      setOverview((prev) => (prev ? { ...prev, name: data.name ?? prev.name } : prev));
    } catch {
      setError("Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function removeMember(memberId: string, label: string) {
    if (!confirm(`Remove ${label}? They will not be able to rejoin or find this group.`)) return;
    try {
      const res = await fetch(`/api/groups/${slug}/admin/members/${memberId}/remove`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(getErrorMessage(data.error, "Failed"));
        return;
      }
      setMembers((prev) => prev.filter((m) => m.memberId !== memberId));
    } catch {
      alert("Failed");
    }
  }

  async function deletePost(postId: string, e?: React.MouseEvent) {
    e?.stopPropagation();
    if (!confirm("Delete this post from the group?")) return;
    try {
      const res = await fetch(`/api/posts/${postId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(getErrorMessage(data.error, "Failed"));
        return;
      }
      setReports((prev) => prev.filter((r) => r.contentId !== postId));
    } catch {
      alert("Failed");
    }
  }

  async function openPostModal(postId: string) {
    setPostModalId(postId);
    setPostModalData(null);
    setPostModalLoading(true);
    try {
      const res = await fetch(`/api/posts/${postId}`);
      const data = await res.json();
      if (res.ok && data.post && typeof data.post === "object") {
        setPostModalData(data.post as Record<string, unknown>);
      }
    } finally {
      setPostModalLoading(false);
    }
  }

  function closePostModal() {
    setPostModalId(null);
    setPostModalData(null);
  }

  async function dismissReport(reportId: string, e?: React.MouseEvent) {
    e?.stopPropagation();
    setDismissBusyId(reportId);
    try {
      const res = await fetch(`/api/groups/${slug}/admin/reports/${reportId}/dismiss`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(getErrorMessage(data.error, "Could not dismiss"));
        return;
      }
      setReports((prev) => prev.filter((r) => r.id !== reportId));
    } catch {
      alert("Could not dismiss");
    } finally {
      setDismissBusyId(null);
    }
  }

  async function inviteFriend(friendId: string) {
    setInviteBusyId(friendId);
    setInviteError("");
    try {
      const res = await fetch(`/api/groups/${slug}/invite-admin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteeId: friendId }),
      });
      const data = await res.json();
      if (res.ok) {
        setFriendQuery("");
        setInviteFieldFocused(false);
        inviteFriendInputRef.current?.blur();
        alert("Invite sent. They can accept or decline from their account (banner or message link).");
      } else {
        setInviteError(getErrorMessage(data.error, "Failed to invite"));
      }
    } finally {
      setInviteBusyId(null);
    }
  }

  async function requestDeletion() {
    if (!confirm("Request that Northwest Community delete this group? You will be notified after review.")) return;
    setRequestDelBusy(true);
    try {
      const res = await fetch(`/api/groups/${slug}/request-deletion`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(getErrorMessage(data.error, "Failed"));
        return;
      }
      await loadData();
      alert("Deletion request submitted.");
    } finally {
      setRequestDelBusy(false);
    }
  }

  const adminMemberIds = new Set(
    members.filter((m) => m.isCreator || m.role === "admin").map((m) => m.memberId)
  );
  const friendSearchQ = friendQuery.trim().toLowerCase();
  const filteredFriends =
    friendSearchQ.length >= 1
      ? friends.filter((f) => `${f.firstName} ${f.lastName}`.toLowerCase().includes(friendSearchQ))
      : [];

  if (loading) return <p className="text-gray-500">Loading…</p>;
  if (error && !overview) {
    return (
      <div>
        <p className="text-red-600 mb-4">{error}</p>
        <Link href="/my-community/groups" className="btn">
          Back to groups
        </Link>
      </div>
    );
  }

  return (
    <div>
      <Link href="/my-community/groups" className="text-sm text-gray-600 hover:underline mb-4 inline-block">
        ← My groups
      </Link>

      <div className="flex flex-wrap items-center gap-4 mb-6">
        <h1 className="text-2xl font-bold">Group admin</h1>
        {adminGroups.length > 1 ? (
          <label className="flex items-center gap-2 text-sm">
            <span className="text-gray-600">Group:</span>
            <select
              className="border rounded px-2 py-1"
              value={slug}
              onChange={(e) => {
                window.location.href = `/my-community/groups/${e.target.value}/admin`;
              }}
            >
              {adminGroups.map((g) => (
                <option key={g.id} value={g.slug}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          overview && <span className="text-gray-700 font-medium">{overview.name}</span>
        )}
      </div>

      <div className="flex gap-2 border-b mb-6">
        {(["members", "flagged", "settings"] as const).map((t) => (
          <button
            key={t}
            type="button"
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === t ? "border-[var(--color-primary)] text-[var(--color-heading)]" : "border-transparent text-gray-500"
            }`}
            onClick={() => setTab(t)}
          >
            {t === "members" ? "Members" : t === "flagged" ? "Flagged" : "Settings"}
          </button>
        ))}
      </div>

      {tab === "members" && (
        <ul className="space-y-3 max-w-2xl">
          {members.length === 0 ? (
            <p className="text-gray-500">No members.</p>
          ) : (
            members.map((m) => (
              <li key={m.id} className="flex items-center justify-between border rounded-lg p-3">
                <div>
                  <span className="font-medium">
                    {m.member.firstName} {m.member.lastName}
                  </span>
                  {m.isCreator && <span className="text-gray-500 text-sm ml-2">Creator</span>}
                  {!m.isCreator && m.role === "admin" && (
                    <span className="text-gray-500 text-sm ml-2">Admin</span>
                  )}
                </div>
                {!m.isCreator && (
                  <button
                    type="button"
                    className="text-sm text-red-600 hover:underline"
                    onClick={() =>
                      removeMember(m.memberId, `${m.member.firstName} ${m.member.lastName}`)
                    }
                  >
                    Remove
                  </button>
                )}
              </li>
            ))
          )}
        </ul>
      )}

      {tab === "flagged" && (
        <ul className="space-y-4 max-w-3xl">
          {reports.length === 0 ? (
            <p className="text-gray-500">No pending post reports in this group.</p>
          ) : (
            reports.map((r) => (
              <li
                key={r.id}
                className={`border rounded-lg p-4 space-y-2 ${r.post?.id ? "cursor-pointer hover:bg-gray-50/80" : ""}`}
                onClick={() => {
                  if (r.post?.id) void openPostModal(r.post.id);
                }}
                onKeyDown={(e) => {
                  if (r.post?.id && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    void openPostModal(r.post.id);
                  }
                }}
                role={r.post?.id ? "button" : undefined}
                tabIndex={r.post?.id ? 0 : undefined}
              >
                <p className="text-sm text-gray-600">
                  {r.reason} · {new Date(r.createdAt).toLocaleString()} · Reported by {r.reporter.firstName}{" "}
                  {r.reporter.lastName}
                </p>
                {r.post?.content && <p className="text-sm whitespace-pre-wrap line-clamp-6">{r.post.content}</p>}
                {r.details && <p className="text-xs text-gray-500">{r.details}</p>}
                {r.post?.id ? (
                  <p className="text-xs text-gray-400">Click the card to view the full post.</p>
                ) : null}
                <div className="flex flex-wrap gap-2 pt-1" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                  {r.post?.id && (
                    <button
                      type="button"
                      className="btn border text-sm"
                      onClick={() => void openPostModal(r.post!.id)}
                    >
                      View post
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn border text-sm"
                    disabled={dismissBusyId === r.id}
                    onClick={(e) => void dismissReport(r.id, e)}
                  >
                    {dismissBusyId === r.id ? "Dismissing…" : "Dismiss report"}
                  </button>
                  {r.post?.id && (
                    <button
                      type="button"
                      className="btn bg-red-600 text-white hover:bg-red-700 text-sm"
                      onClick={(e) => void deletePost(r.post!.id, e)}
                    >
                      Delete post
                    </button>
                  )}
                </div>
              </li>
            ))
          )}
        </ul>
      )}

      {tab === "settings" && (
        <div className="max-w-2xl space-y-8">
          <form onSubmit={handleSaveSettings} className="space-y-4">
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <div>
              <label htmlFor="ga-name" className="block text-sm font-medium mb-1">
                Name *
              </label>
              <input
                id="ga-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
                className="border rounded px-3 py-2 w-full"
                required
              />
            </div>
            <div>
              <label htmlFor="ga-desc" className="block text-sm font-medium mb-1">
                Description
              </label>
              <textarea
                id="ga-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={2000}
                rows={4}
                className="border rounded px-3 py-2 w-full"
              />
            </div>
            <div>
              <label htmlFor="ga-cat" className="block text-sm font-medium mb-1">
                Category
              </label>
              <input
                id="ga-cat"
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
                  <img src={coverImageUrl} alt="" className="w-48 h-32 object-cover rounded border" />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading}
                      className="text-sm text-blue-600 hover:underline"
                    >
                      {uploading ? "Uploading…" : "Change photo"}
                    </button>
                    <button type="button" onClick={() => setCoverImageUrl("")} className="text-sm text-gray-600 hover:underline">
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
            <div>
              <label htmlFor="ga-rules" className="block text-sm font-medium mb-1">
                Group rules
              </label>
              <textarea
                id="ga-rules"
                value={rules}
                onChange={(e) => setRules(e.target.value)}
                maxLength={5000}
                rows={5}
                className="border rounded px-3 py-2 w-full"
                placeholder="Members agree to these when joining"
              />
            </div>
            <div className="flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50/80 p-4">
              <input
                id="ga-allowBiz"
                type="checkbox"
                checked={allowBusinessPosts}
                onChange={(e) => setAllowBusinessPosts(e.target.checked)}
                className="mt-1 h-4 w-4 shrink-0"
              />
              <label htmlFor="ga-allowBiz" className="text-sm text-gray-700 cursor-pointer">
                <span className="font-medium text-gray-900">Allow businesses to post in this group</span>
              </label>
            </div>
            <div className="flex gap-3">
              <button type="submit" disabled={saving} className="btn">
                {saving ? "Saving…" : "Save changes"}
              </button>
              <Link href={`/community-groups/${slug}`} className="btn border">
                View group
              </Link>
            </div>
          </form>

          <div className="border-t pt-8">
            <h2 className="text-xl font-bold mb-2">Invite co-admin</h2>
            <p className="text-gray-600 text-sm mb-4">
              Type a friend&apos;s name to find them. They get a message with a link and must accept or decline — they are
              not added as admin until they accept.
            </p>
            <div ref={inviteComboboxRef} className="relative max-w-md">
              <label htmlFor="ga-invite-friend" className="sr-only">
                Search friends to invite as co-admin
              </label>
              <input
                ref={inviteFriendInputRef}
                id="ga-invite-friend"
                type="search"
                value={friendQuery}
                onChange={(e) => setFriendQuery(e.target.value)}
                onFocus={() => {
                  if (inviteFieldBlurTimerRef.current) {
                    clearTimeout(inviteFieldBlurTimerRef.current);
                    inviteFieldBlurTimerRef.current = null;
                  }
                  setInviteFieldFocused(true);
                }}
                onBlur={() => {
                  inviteFieldBlurTimerRef.current = setTimeout(() => {
                    setInviteFieldFocused(false);
                    inviteFieldBlurTimerRef.current = null;
                  }, 200);
                }}
                placeholder="Start typing a name…"
                className="border rounded px-3 py-2 w-full"
                autoComplete="off"
              />
              {inviteFieldFocused && friendSearchQ.length >= 1 && (
                <ul
                  className="absolute z-30 top-full left-0 right-0 mt-1 border rounded-lg bg-white shadow-lg max-h-56 overflow-y-auto py-1"
                  role="listbox"
                >
                  {filteredFriends.length === 0 ? (
                    <li className="px-3 py-2 text-sm text-gray-500">No matching friends.</li>
                  ) : (
                    filteredFriends.map((f) => {
                      const already = adminMemberIds.has(f.id);
                      const busy = inviteBusyId === f.id;
                      return (
                        <li
                          key={f.id}
                          className="flex items-stretch min-h-[3rem] border-b border-gray-200 last:border-b-0 hover:bg-gray-50"
                          role="option"
                        >
                          <span className="text-sm flex-1 flex items-center px-3 py-2 min-w-0">
                            {f.firstName} {f.lastName}
                            {f.city ? <span className="text-gray-500"> · {f.city}</span> : null}
                          </span>
                          <span className="w-px shrink-0 bg-gray-400 self-stretch my-1" aria-hidden />
                          <span className="shrink-0 flex items-center justify-center px-3 min-w-[6.5rem]">
                            {already ? (
                              <span className="text-xs text-gray-400 text-center">Already admin</span>
                            ) : (
                              <button
                                type="button"
                                disabled={busy}
                                className="btn text-sm py-1.5 px-3 w-full max-w-[5.5rem]"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => void inviteFriend(f.id)}
                              >
                                {busy ? "Sending…" : "Invite"}
                              </button>
                            )}
                          </span>
                        </li>
                      );
                    })
                  )}
                </ul>
              )}
            </div>
            {inviteError && <p className="text-red-600 text-sm mt-2 max-w-md">{inviteError}</p>}
          </div>

          {overview?.isCreator && (
            <div className="border-t pt-8">
              <h2 className="text-xl font-bold mb-2">Delete group</h2>
              {overview.pendingDeletionRequest ? (
                <p className="text-gray-600 text-sm">A deletion request is pending review by Northwest Community.</p>
              ) : (
                <>
                  <p className="text-gray-600 text-sm mb-4">
                    Co-admins cannot request deletion. Only you (the creator) can submit a request; the site team must
                    approve before the group is removed.
                  </p>
                  <button
                    type="button"
                    disabled={requestDelBusy}
                    className="btn border border-red-600 text-red-600 hover:bg-red-50"
                    onClick={() => void requestDeletion()}
                  >
                    {requestDelBusy ? "Submitting…" : "Request group deletion"}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {postModalId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="post-modal-title"
          onClick={closePostModal}
        >
          <div
            className="bg-white rounded-lg max-w-lg w-full max-h-[85vh] overflow-y-auto p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-3 gap-2">
              <h2 id="post-modal-title" className="text-lg font-semibold">
                Post
              </h2>
              <button type="button" className="text-gray-500 hover:text-gray-800 text-sm shrink-0" onClick={closePostModal}>
                Close
              </button>
            </div>
            {postModalLoading && <p className="text-gray-500 text-sm">Loading…</p>}
            {!postModalLoading && !postModalData && (
              <p className="text-red-600 text-sm">Could not load this post.</p>
            )}
            {!postModalLoading && postModalData && <PostPreviewModalBody post={postModalData} />}
          </div>
        </div>
      )}
    </div>
  );
}

export default function GroupAdminHubPage() {
  return (
    <Suspense fallback={<p className="text-gray-500 p-4">Loading…</p>}>
      <GroupAdminHubContent />
    </Suspense>
  );
}
