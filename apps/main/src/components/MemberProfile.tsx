"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { IonIcon } from "@/components/IonIcon";
import { badgeSlugToIonIconName } from "@/lib/badge-ion-icon-name";

interface MemberProfileProps {
  member: {
    id: string;
    firstName: string;
    lastName: string;
    profilePhotoUrl: string | null;
    bio: string | null;
    city: string | null;
    allTimePointsEarned: number;
  };
  canSeeFullProfile: boolean;
  badges: Array<{ id: string; name: string; slug: string; description: string | null }>;
  favoriteBusinesses: Array<{ id: string; name: string; slug: string; logoUrl: string | null }>;
  blogs: Array<{ id: string; slug: string; title: string; createdAt: Date | string }>;
  sessionUserId: string | null;
  isOwnProfile: boolean;
  isFriend?: boolean;
  pendingFriendRequest?: "incoming" | "outgoing" | null;
  /** Friend request row id when `pendingFriendRequest === "incoming"` (for accept/decline). */
  incomingFriendRequestId?: string | null;
  editProfileHref?: string;
  backHref?: string;
}

type MemberPostRow = { id: string; photos: string[] };

function resolveClientMediaUrl(path: string | null | undefined): string {
  if (!path) return "";
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  if (typeof window === "undefined") return path;
  return path.startsWith("/") ? `${window.location.origin}${path}` : `${window.location.origin}/${path}`;
}

export function MemberProfile({
  member,
  canSeeFullProfile,
  badges,
  favoriteBusinesses,
  blogs,
  sessionUserId,
  isOwnProfile,
  isFriend = false,
  pendingFriendRequest = null,
  incomingFriendRequestId = null,
  editProfileHref = "/my-community/profile",
  backHref = "/my-community/find-members",
}: MemberProfileProps) {
  const router = useRouter();
  const menuRef = useRef<HTMLDivElement>(null);
  const [friendPending, setFriendPending] = useState(pendingFriendRequest);
  const [friendAccepted, setFriendAccepted] = useState(isFriend);
  const [loading, setLoading] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [blockReportLoading, setBlockReportLoading] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [badgeModal, setBadgeModal] = useState<(typeof badges)[0] | null>(null);
  const [memberPosts, setMemberPosts] = useState<MemberPostRow[]>([]);
  const [postsNextCursor, setPostsNextCursor] = useState<string | null>(null);
  const [postsLoading, setPostsLoading] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState(0);

  const galleryUrls: string[] = [];
  for (const post of memberPosts) {
    const first = post.photos?.[0];
    if (first) {
      const u = resolveClientMediaUrl(first);
      if (u) galleryUrls.push(u);
    }
    if (galleryUrls.length >= 9) break;
  }

  const loadMemberPosts = useCallback(
    async (cursor?: string | null) => {
      if (!canSeeFullProfile || !sessionUserId) return;
      const isAppend = !!cursor;
      setPostsLoading(true);
      try {
        const params = new URLSearchParams();
        params.set("limit", "9");
        if (cursor) params.set("cursor", cursor);
        const res = await fetch(`/api/members/${member.id}/posts?${params}`, { credentials: "include" });
        const data = (await res.json().catch(() => ({}))) as {
          posts?: MemberPostRow[];
          nextCursor?: string | null;
        };
        const posts = Array.isArray(data.posts) ? data.posts : [];
        setMemberPosts((prev) => (isAppend ? [...prev, ...posts] : posts));
        setPostsNextCursor(data.nextCursor ?? null);
      } catch {
        if (!isAppend) setMemberPosts([]);
      } finally {
        setPostsLoading(false);
      }
    },
    [canSeeFullProfile, sessionUserId, member.id]
  );

  useEffect(() => {
    setFriendPending(pendingFriendRequest);
    setFriendAccepted(isFriend);
  }, [pendingFriendRequest, isFriend]);

  useEffect(() => {
    if (!canSeeFullProfile || !sessionUserId) {
      setMemberPosts([]);
      setPostsNextCursor(null);
      return;
    }
    loadMemberPosts();
  }, [canSeeFullProfile, sessionUserId, member.id, loadMemberPosts]);

  useEffect(() => {
    if (!menuOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  useEffect(() => {
    if (!galleryOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setGalleryOpen(false);
      if (e.key === "ArrowLeft" && galleryUrls.length > 0) {
        setGalleryIndex((i) => (i <= 0 ? galleryUrls.length - 1 : i - 1));
      }
      if (e.key === "ArrowRight" && galleryUrls.length > 0) {
        setGalleryIndex((i) => (i >= galleryUrls.length - 1 ? 0 : i + 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [galleryOpen, galleryUrls.length]);

  async function handleAddFriend() {
    if (!sessionUserId || loading || friendAccepted || friendPending === "outgoing") return;
    if (friendPending === "incoming" && incomingFriendRequestId) {
      setLoading("friend");
      try {
        const res = await fetch(`/api/friend-requests/${incomingFriendRequestId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ status: "accepted" }),
        });
        if (res.ok) {
          setFriendPending(null);
          setFriendAccepted(true);
        } else {
          const err = await res.json().catch(() => ({}));
          alert((err as { error?: string }).error ?? "Could not accept request");
        }
      } finally {
        setLoading(null);
      }
      return;
    }
    setLoading("friend");
    try {
      const res = await fetch("/api/friend-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ addresseeId: member.id }),
      });
      if (res.ok) {
        setFriendPending("outgoing");
      } else {
        const err = await res.json().catch(() => ({}));
        alert((err as { error?: string }).error ?? "Failed to send request");
      }
    } finally {
      setLoading(null);
    }
  }

  async function handleDeclineIncoming() {
    if (!incomingFriendRequestId || loading) return;
    setLoading("decline");
    try {
      const res = await fetch(`/api/friend-requests/${incomingFriendRequestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status: "declined" }),
      });
      if (res.ok) {
        setFriendPending(null);
      } else {
        const err = await res.json().catch(() => ({}));
        alert((err as { error?: string }).error ?? "Could not decline");
      }
    } finally {
      setLoading(null);
    }
  }

  async function handleBlock() {
    if (!sessionUserId || blockReportLoading) return;
    setBlockReportLoading(true);
    try {
      const res = await fetch("/api/members/block", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ memberId: member.id }),
      });
      if (res.ok) {
        setMenuOpen(false);
        router.push("/my-community/friends");
      } else {
        const data = await res.json().catch(() => ({}));
        alert((data as { error?: string }).error ?? "Could not block");
      }
    } finally {
      setBlockReportLoading(false);
    }
  }

  async function submitReport(reason: "political" | "hate" | "nudity" | "spam" | "other") {
    if (!sessionUserId || blockReportLoading) return;
    setBlockReportLoading(true);
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          contentType: "member",
          contentId: member.id,
          reason,
        }),
      });
      if (res.ok) {
        setReportOpen(false);
        setMenuOpen(false);
        alert("Report submitted. Thank you.");
      } else {
        const data = await res.json().catch(() => ({}));
        alert((data as { error?: string }).error ?? "Could not submit report");
      }
    } finally {
      setBlockReportLoading(false);
    }
  }

  const firstName = member.firstName;
  type PhotoGridCell =
    | { type: "post"; post: MemberPostRow; idx: number }
    | { type: "ph"; i: number };
  const photoItems: PhotoGridCell[] = [];
  let idxAcc = 0;
  for (const post of memberPosts) {
    const ph = post.photos?.[0];
    if (ph && resolveClientMediaUrl(ph)) {
      photoItems.push({ type: "post", post, idx: idxAcc });
      idxAcc += 1;
    }
    if (idxAcc >= 9) break;
  }
  while (photoItems.length < 9) {
    photoItems.push({ type: "ph", i: photoItems.length });
  }
  const photoGridItems = photoItems.slice(0, 9);

  return (
    <>
      <div
        className="flex items-center gap-3 px-4 py-3 border-b-2 border-black shrink-0"
        style={{ backgroundColor: "var(--color-primary)" }}
      >
        <Link
          href={backHref}
          className="p-2 rounded text-white hover:bg-white/10 text-lg leading-none shrink-0"
          aria-label="Back"
        >
          ←
        </Link>
        <h1
          className="flex-1 text-center text-lg font-bold text-white truncate min-w-0"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          {member.firstName} {member.lastName}
        </h1>
        {sessionUserId && !isOwnProfile ? (
          <div className="relative shrink-0" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              className="p-2 rounded text-white hover:bg-white/10"
              aria-label="Options"
            >
              <IonIcon name="ellipsis-vertical" size={22} className="text-white" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 py-1 bg-white border rounded-lg shadow-lg z-20 min-w-[180px]">
                <button
                  type="button"
                  onClick={handleBlock}
                  disabled={blockReportLoading}
                  className="block w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-gray-50"
                >
                  Block member
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setReportOpen(true);
                  }}
                  disabled={blockReportLoading}
                  className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  Report member
                </button>
              </div>
            )}
          </div>
        ) : (
          <span className="w-10 shrink-0" aria-hidden />
        )}
      </div>

      <div className="p-4 md:p-6">
        <div className="flex flex-row gap-4 pb-4 mb-4 border-b border-gray-200">
          {member.profilePhotoUrl ? (
            <img
              src={member.profilePhotoUrl}
              alt=""
              className="w-20 h-20 rounded-full object-cover shrink-0"
            />
          ) : (
            <div className="w-20 h-20 rounded-full bg-gray-300 flex items-center justify-center text-xl font-medium text-gray-600 shrink-0">
              {member.firstName?.[0]}
              {member.lastName?.[0]}
            </div>
          )}
          <div className="min-w-0 flex-1 flex flex-col justify-center">
            <p className="text-xl font-bold" style={{ color: "var(--color-heading)" }}>
              {member.firstName} {member.lastName}
            </p>
            {member.city ? <p className="text-sm text-gray-600 mt-1">{member.city}</p> : null}
            {canSeeFullProfile && member.bio ? (
              <p className="text-[15px] text-gray-800 mt-2 whitespace-pre-wrap leading-relaxed">{member.bio}</p>
            ) : null}
            <p className="text-sm text-gray-600 mt-2">
              <span className="font-semibold">All time reward points:</span> {member.allTimePointsEarned ?? 0}
            </p>
          </div>
        </div>

        {!isOwnProfile && sessionUserId ? (
          <div className="flex flex-wrap gap-3 pb-4 mb-4 border-b border-gray-200">
            <button
              type="button"
              onClick={handleAddFriend}
              disabled={!!loading || friendAccepted || friendPending === "outgoing"}
              className="flex-1 min-w-[140px] flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-white font-semibold text-sm disabled:opacity-70"
              style={{ backgroundColor: "var(--color-primary)" }}
            >
              {loading === "friend" ? (
                "…"
              ) : friendAccepted ? (
                <>
                  <IonIcon name="people-outline" size={20} className="text-white" />
                  Friends
                </>
              ) : friendPending === "outgoing" ? (
                <>
                  <IonIcon name="time-outline" size={20} className="text-white" />
                  Pending
                </>
              ) : friendPending === "incoming" ? (
                <>
                  <IonIcon name="person-add-outline" size={20} className="text-white" />
                  Accept
                </>
              ) : (
                <>
                  <IonIcon name="person-add-outline" size={20} className="text-white" />
                  Add friend
                </>
              )}
            </button>
            {friendPending === "incoming" && incomingFriendRequestId ? (
              <button
                type="button"
                onClick={handleDeclineIncoming}
                disabled={!!loading}
                className="py-2.5 px-4 rounded-lg border-2 border-gray-300 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                {loading === "decline" ? "…" : "Decline"}
              </button>
            ) : null}
            <Link
              href={`/my-community/messages?addresseeId=${encodeURIComponent(member.id)}`}
              className="flex-1 min-w-[140px] flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg border-2 font-semibold text-sm"
              style={{ borderColor: "var(--color-primary)", color: "var(--color-primary)" }}
            >
              <IonIcon name="chatbubble-outline" size={20} style={{ color: "var(--color-primary)" }} />
              Message {firstName}
            </Link>
          </div>
        ) : !isOwnProfile && !sessionUserId ? (
          <p className="text-sm text-gray-600 pb-4 mb-4 border-b border-gray-200">
            <Link href={`/login?callbackUrl=${encodeURIComponent(`/members/${member.id}`)}`} className="font-semibold underline" style={{ color: "var(--color-primary)" }}>
              Sign in
            </Link>{" "}
            to add friends or send a message.
          </p>
        ) : null}

        {isOwnProfile ? (
          <Link
            href={editProfileHref}
            className="inline-block btn text-sm py-2 px-4 mb-6"
          >
            Edit profile
          </Link>
        ) : null}

        <section className="mb-6">
          <h2 className="text-base font-bold mb-2" style={{ color: "var(--color-heading)" }}>
            {firstName}&apos;s Photos
          </h2>
          {!sessionUserId ? (
            <div className="py-8 px-4 bg-gray-100 rounded-lg text-center text-sm text-gray-600">
              Sign in to view {firstName}&apos;s photos
            </div>
          ) : !canSeeFullProfile ? (
            <div className="py-8 px-4 bg-gray-100 rounded-lg text-center text-sm text-gray-600">
              Photos are only visible to friends
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-1 max-w-md mx-auto">
                {photoGridItems.map((item) =>
                  item.type === "post" ? (
                    <button
                      key={item.post.id}
                      type="button"
                      onClick={() => {
                        setGalleryIndex(item.idx);
                        setGalleryOpen(true);
                      }}
                      className="aspect-square overflow-hidden border border-gray-200 bg-gray-100 rounded focus:ring-2 focus:ring-offset-1 focus:outline-none"
                      style={{ outlineColor: "var(--color-primary)" }}
                    >
                      <img
                        src={resolveClientMediaUrl(item.post.photos[0])}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    </button>
                  ) : (
                    <div
                      key={`ph-${item.i}`}
                      className="aspect-square border border-dashed border-gray-200 bg-gray-50 rounded flex flex-col items-center justify-center p-1"
                    >
                      <IonIcon name="images-outline" size={28} className="text-gray-400" />
                      <span className="text-[10px] text-gray-500 text-center mt-1 leading-tight">
                        {isOwnProfile ? "Post in the feed to add photos" : "No photo yet"}
                      </span>
                    </div>
                  )
                )}
              </div>
              {postsNextCursor ? (
                <button
                  type="button"
                  onClick={() => loadMemberPosts(postsNextCursor)}
                  disabled={postsLoading}
                  className="w-full mt-3 py-2 text-sm font-semibold"
                  style={{ color: "var(--color-primary)" }}
                >
                  {postsLoading ? "Loading…" : "Load more"}
                </button>
              ) : null}
            </>
          )}
        </section>

        {canSeeFullProfile && favoriteBusinesses.length > 0 ? (
          <section className="pt-5 border-t border-gray-200 mb-6">
            <Link
              href={`/members/businesses/${member.id}`}
              className="flex items-center justify-between gap-2 mb-3 group"
            >
              <h2 className="text-base font-bold group-hover:underline" style={{ color: "var(--color-heading)" }}>
                Favorite Businesses
              </h2>
              <IonIcon name="chevron-forward-outline" size={20} style={{ color: "var(--color-primary)" }} />
            </Link>
            <div className="flex gap-4 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-thin">
              {favoriteBusinesses.map((b) => (
                <Link
                  key={b.id}
                  href={`/support-local/${b.slug}`}
                  className="shrink-0 w-24 flex flex-col items-center text-center"
                >
                  {b.logoUrl ? (
                    <img src={b.logoUrl} alt="" className="w-24 h-24 object-cover rounded-lg border border-gray-100" />
                  ) : (
                    <div className="w-24 h-24 rounded-lg bg-gray-200 flex items-center justify-center text-xl font-bold text-gray-500">
                      {b.name[0]}
                    </div>
                  )}
                  <span className="text-xs font-medium text-gray-800 mt-2 line-clamp-2">{b.name}</span>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        {canSeeFullProfile && badges.length > 0 ? (
          <section className="pt-5 border-t border-gray-200 mb-6">
            <h2 className="text-base font-bold mb-3" style={{ color: "var(--color-heading)" }}>
              Badges
            </h2>
            <div className="flex flex-wrap gap-3">
              {badges.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setBadgeModal(b)}
                  className="w-12 h-12 rounded-full flex items-center justify-center border border-gray-200 bg-gray-50 hover:bg-gray-100 transition-colors"
                  style={{ color: "var(--color-primary)" }}
                  aria-label={b.name}
                >
                  <IonIcon name={badgeSlugToIonIconName(b.slug)} size={26} />
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {canSeeFullProfile && blogs.length > 0 ? (
          <section className="pt-5 border-t border-gray-200">
            <h2 className="text-base font-bold mb-3" style={{ color: "var(--color-heading)" }}>
              Blogs
            </h2>
            <ul className="space-y-2">
              {blogs.map((b) => (
                <li key={b.id}>
                  <Link href={`/blog/${b.slug}`} className="hover:underline font-medium text-[var(--color-primary)]">
                    {b.title}
                  </Link>
                  <span className="text-gray-500 text-sm ml-2">
                    {new Date(b.createdAt).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      {reportOpen && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/50"
          role="dialog"
          aria-modal="true"
          aria-label="Report member"
        >
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-5">
            <p className="font-semibold mb-3" style={{ color: "var(--color-heading)" }}>
              Why are you reporting this member?
            </p>
            <div className="flex flex-col gap-2">
              {(
                [
                  ["Political", "political"],
                  ["Hate / harassment", "hate"],
                  ["Spam", "spam"],
                  ["Other", "other"],
                ] as const
              ).map(([label, reason]) => (
                <button
                  key={reason}
                  type="button"
                  disabled={blockReportLoading}
                  onClick={() => submitReport(reason)}
                  className="w-full text-left px-4 py-2 rounded-lg border border-gray-200 hover:bg-gray-50 text-sm"
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setReportOpen(false)}
              className="mt-4 w-full py-2 text-sm font-medium text-gray-600"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {badgeModal && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/40"
          onClick={() => setBadgeModal(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-center mb-3" style={{ color: "var(--color-primary)" }}>
              <IonIcon name={badgeSlugToIonIconName(badgeModal.slug)} size={48} />
            </div>
            <p className="text-lg font-bold" style={{ color: "var(--color-heading)" }}>
              {badgeModal.name}
            </p>
            {badgeModal.description ? (
              <p className="text-sm text-gray-700 mt-2 leading-relaxed">{badgeModal.description}</p>
            ) : null}
            <button
              type="button"
              onClick={() => setBadgeModal(null)}
              className="mt-5 text-sm font-semibold"
              style={{ color: "var(--color-primary)" }}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {galleryOpen && galleryUrls.length > 0 && (
        <div
          className="fixed inset-0 z-[200] bg-black/90 flex flex-col items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            onClick={() => setGalleryOpen(false)}
            className="absolute top-4 right-4 text-white text-2xl font-light z-10 p-2"
            aria-label="Close"
          >
            ×
          </button>
          <img
            src={galleryUrls[Math.min(galleryIndex, galleryUrls.length - 1)]}
            alt=""
            className="max-h-[85vh] max-w-full object-contain"
          />
          {galleryUrls.length > 1 ? (
            <div className="flex gap-4 mt-4">
              <button
                type="button"
                className="text-white text-sm font-medium px-4 py-2 rounded bg-white/10"
                onClick={() =>
                  setGalleryIndex((i) => (i <= 0 ? galleryUrls.length - 1 : i - 1))
                }
              >
                Previous
              </button>
              <button
                type="button"
                className="text-white text-sm font-medium px-4 py-2 rounded bg-white/10"
                onClick={() =>
                  setGalleryIndex((i) => (i >= galleryUrls.length - 1 ? 0 : i + 1))
                }
              >
                Next
              </button>
            </div>
          ) : null}
        </div>
      )}
    </>
  );
}
