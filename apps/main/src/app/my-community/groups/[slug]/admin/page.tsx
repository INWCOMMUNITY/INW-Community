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

  const [inviteeId, setInviteeId] = useState("");
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [requestDelBusy, setRequestDelBusy] = useState(false);

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

  async function deletePost(postId: string) {
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

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteeId.trim()) return;
    setInviteLoading(true);
    setInviteError("");
    try {
      const res = await fetch(`/api/groups/${slug}/invite-admin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteeId: inviteeId.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setInviteeId("");
        alert("Invite sent. They will get a message with a link to accept.");
      } else {
        setInviteError(getErrorMessage(data.error, "Failed to invite"));
      }
    } finally {
      setInviteLoading(false);
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
              <li key={r.id} className="border rounded-lg p-4 space-y-2">
                <p className="text-sm text-gray-600">
                  {r.reason} · {new Date(r.createdAt).toLocaleString()} · Reported by {r.reporter.firstName}{" "}
                  {r.reporter.lastName}
                </p>
                {r.post?.content && <p className="text-sm whitespace-pre-wrap line-clamp-6">{r.post.content}</p>}
                {r.details && <p className="text-xs text-gray-500">{r.details}</p>}
                {r.post?.id && (
                  <button type="button" className="btn bg-red-600 text-white hover:bg-red-700 text-sm" onClick={() => deletePost(r.post!.id)}>
                    Delete post
                  </button>
                )}
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
              Enter a member ID. They will receive a direct message with a link to accept.
            </p>
            <form onSubmit={handleInvite} className="flex flex-wrap gap-2 max-w-xl">
              <input
                type="text"
                value={inviteeId}
                onChange={(e) => setInviteeId(e.target.value)}
                placeholder="Member ID"
                className="border rounded px-3 py-2 flex-1 min-w-[200px]"
              />
              <button type="submit" disabled={inviteLoading} className="btn">
                {inviteLoading ? "Sending…" : "Send invite"}
              </button>
            </form>
            {inviteError && <p className="text-red-600 text-sm mt-2">{inviteError}</p>}
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
