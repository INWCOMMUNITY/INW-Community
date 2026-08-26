"use client";

import { useState, useEffect, useMemo, type ReactNode } from "react";
import Link from "next/link";
import { AddFriendButton } from "@/components/AddFriendButton";
import { BackToProfileLink } from "@/components/BackToProfileLink";
import { IonIcon } from "@/components/IonIcon";
import { initialsAvatarColor } from "@/lib/friend-suggestion-reasons";

type FriendStatus = "none" | "friends" | "pending_outgoing" | "pending_incoming";
type Tab = "friends" | "requests" | "discover";
type FriendFilter = "all" | "nearby" | "az" | "recent";

interface Person {
  id: string;
  firstName: string;
  lastName: string;
  profilePhotoUrl: string | null;
  city?: string | null;
  bio?: string | null;
  friendsSince?: string;
}

interface FriendData {
  incoming: Array<{
    id: string;
    status: string;
    createdAt: string;
    requester: Person;
  }>;
  outgoing: Array<{
    id: string;
    status: string;
    addressee: Person;
  }>;
  friends: Person[];
}

interface SuggestedMember extends Person {
  mutualCount: number;
  reasons?: string[];
}

function fullName(p: Person) {
  return `${p.firstName} ${p.lastName}`.trim();
}

function PersonAvatar({ person, size = 64 }: { person: Person; size?: number }) {
  const name = fullName(person);
  const initials = `${person.firstName?.[0] ?? ""}${person.lastName?.[0] ?? ""}`.toUpperCase() || "?";
  if (person.profilePhotoUrl) {
    return (
      <img
        src={person.profilePhotoUrl}
        alt=""
        width={size}
        height={size}
        className="rounded-full object-cover shrink-0 ring-2 ring-[var(--color-primary)]"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className="rounded-full shrink-0 flex items-center justify-center text-white font-semibold ring-2 ring-[var(--color-primary)]"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.32,
        backgroundColor: initialsAvatarColor(name),
      }}
    >
      {initials}
    </div>
  );
}

function CityChip({ city }: { city?: string | null }) {
  if (!city) return null;
  return (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-[var(--color-section-alt)] text-[var(--color-primary)]">
      {city}
    </span>
  );
}

function TabButton({
  active,
  onClick,
  children,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  badge?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative px-4 py-2 rounded-full text-sm font-semibold transition ${
        active ? "text-white" : "text-gray-700 bg-white border border-gray-200 hover:bg-gray-50"
      }`}
      style={active ? { backgroundColor: "var(--color-primary)" } : undefined}
    >
      {children}
      {badge != null && badge > 0 && (
        <span
          className={`ml-2 inline-flex min-w-[1.25rem] h-5 px-1 items-center justify-center rounded-full text-xs font-bold ${
            active ? "bg-white text-[var(--color-primary)]" : "bg-[var(--color-primary)] text-white"
          }`}
        >
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </button>
  );
}

function FriendCard({
  person,
  menuOpen,
  onToggleMenu,
  onUnfriend,
}: {
  person: Person;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onUnfriend: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 p-4 border rounded-xl bg-white hover:bg-gray-50 transition border-gray-200">
      <div className="flex items-start gap-3">
        <Link href={`/members/${person.id}`} className="shrink-0">
          <PersonAvatar person={person} />
        </Link>
        <div className="min-w-0 flex-1">
          <Link href={`/members/${person.id}`} className="font-semibold hover:underline block truncate">
            {fullName(person)}
          </Link>
          <div className="mt-1">
            <CityChip city={person.city} />
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 mt-auto">
        <Link
          href={`/my-community/messages?addresseeId=${encodeURIComponent(person.id)}`}
          className="inline-flex items-center justify-center gap-1.5 flex-1 rounded-lg text-white text-sm font-semibold py-2 px-3 hover:opacity-90"
          style={{ backgroundColor: "var(--color-primary)" }}
        >
          <IonIcon name="chatbubble-outline" size={16} />
          Message
        </Link>
        <Link
          href={`/members/${person.id}`}
          className="inline-flex items-center justify-center rounded-lg border-2 text-sm font-semibold py-2 px-3 hover:bg-[var(--color-section-alt)]"
          style={{ borderColor: "var(--color-primary)", color: "var(--color-primary)" }}
        >
          Profile
        </Link>
        <div className="relative">
          <button
            type="button"
            aria-label="More"
            onClick={onToggleMenu}
            className="p-2 rounded-lg text-gray-500 hover:bg-gray-100"
          >
            <IonIcon name="ellipsis-horizontal" size={18} />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 z-10 bg-white border rounded-lg shadow-lg min-w-[8rem]">
              <button
                type="button"
                onClick={onUnfriend}
                className="block w-full text-left px-4 py-2 text-sm text-red-700 hover:bg-red-50 rounded-lg"
              >
                Unfriend
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DiscoverCard({
  person,
  reasons,
  friendStatus,
  onFriendAction,
  carousel,
}: {
  person: Person;
  reasons?: string[];
  friendStatus: FriendStatus;
  onFriendAction: () => void;
  carousel?: boolean;
}) {
  return (
    <div
      className={`flex flex-col gap-2 p-4 border rounded-xl bg-white ${
        carousel ? "min-w-[220px] w-[220px] shrink-0" : ""
      }`}
    >
      <Link href={`/members/${person.id}`} className="flex flex-col items-center text-center gap-2">
        <PersonAvatar person={person} size={72} />
        <span className="font-semibold leading-tight">{fullName(person)}</span>
        <CityChip city={person.city} />
      </Link>
      {reasons && reasons.length > 0 && (
        <p className="text-xs text-gray-500 text-center leading-snug">{reasons.join(" · ")}</p>
      )}
      <div className="mt-auto pt-1 flex justify-center">
        <AddFriendButton memberId={person.id} initialStatus={friendStatus} onSuccess={onFriendAction} />
      </div>
    </div>
  );
}

export default function MyFriendsPage() {
  const [tab, setTab] = useState<Tab>("friends");
  const [tabSeeded, setTabSeeded] = useState(false);
  const [friendData, setFriendData] = useState<FriendData | null>(null);
  const [following, setFollowing] = useState<Person[]>([]);
  const [myCity, setMyCity] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Person[]>([]);
  const [searching, setSearching] = useState(false);
  const [suggested, setSuggested] = useState<SuggestedMember[]>([]);
  const [loadingSuggested, setLoadingSuggested] = useState(true);
  const [friendQuery, setFriendQuery] = useState("");
  const [friendFilter, setFriendFilter] = useState<FriendFilter>("all");
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const [shareMessage, setShareMessage] = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/api/friend-requests").then((r) => r.json()),
      fetch("/api/me/following").then((r) => r.json()),
      fetch("/api/me/suggested-friends").then((r) => r.json()),
      fetch("/api/me").then((r) => r.json()),
      fetch("/api/me/referral-link").then((r) => r.json()).catch(() => ({})),
    ])
      .then(([friendRes, followingRes, suggestedRes, meRes, referralRes]) => {
        setFriendData(friendRes);
        setFollowing(followingRes.following ?? []);
        setSuggested(suggestedRes.suggested ?? []);
        setMyCity(typeof meRes?.city === "string" ? meRes.city : null);
        if (typeof referralRes?.shareMessage === "string") setShareMessage(referralRes.shareMessage);
      })
      .catch(() => {
        setFriendData(null);
        setFollowing([]);
        setSuggested([]);
      })
      .finally(() => {
        setLoading(false);
        setLoadingSuggested(false);
      });
  }, []);

  useEffect(() => {
    if (loading || tabSeeded || !friendData) return;
    if (friendData.incoming.length > 0) setTab("requests");
    setTabSeeded(true);
  }, [loading, friendData, tabSeeded]);

  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    const q = searchQuery.trim();
    fetch(`/api/members?q=${encodeURIComponent(q)}&limit=30`)
      .then((r) => r.json())
      .then((data) => setSearchResults(data.members ?? []))
      .catch(() => setSearchResults([]))
      .finally(() => setSearching(false));
  }, [searchQuery]);

  function getFriendStatus(memberId: string): FriendStatus {
    if (!friendData) return "none";
    if (friendData.friends.some((f) => f.id === memberId)) return "friends";
    if (friendData.outgoing.some((r) => r.addressee.id === memberId)) return "pending_outgoing";
    if (friendData.incoming.some((r) => r.requester.id === memberId)) return "pending_incoming";
    return "none";
  }

  function refreshFriends() {
    fetch("/api/friend-requests")
      .then((r) => r.json())
      .then(setFriendData)
      .catch(() => {});
    fetch("/api/me/suggested-friends")
      .then((r) => r.json())
      .then((data) => setSuggested(data.suggested ?? []))
      .catch(() => {});
  }

  async function handleAccept(id: string) {
    const res = await fetch(`/api/friend-requests/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "accepted" }),
    });
    if (res.ok) refreshFriends();
  }

  async function handleDecline(id: string) {
    const res = await fetch(`/api/friend-requests/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "declined" }),
    });
    if (res.ok) {
      const d = await fetch("/api/friend-requests").then((r) => r.json());
      setFriendData(d);
    }
  }

  async function handleUnfollow(memberId: string) {
    const res = await fetch("/api/follow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memberId, action: "unfollow" }),
    });
    if (res.ok) {
      setFollowing((prev) => prev.filter((m) => m.id !== memberId));
    } else {
      const err = await res.json().catch(() => ({}));
      alert(err.error ?? "Failed to unfollow");
    }
  }

  async function handleUnfriend(person: Person) {
    if (!confirm(`Unfriend ${fullName(person)}?`)) return;
    const res = await fetch(`/api/members/${person.id}/unfriend`, { method: "POST" });
    if (res.ok) {
      setFriendData((prev) =>
        prev ? { ...prev, friends: prev.friends.filter((f) => f.id !== person.id) } : prev
      );
      setMenuOpenId(null);
    } else {
      const err = await res.json().catch(() => ({}));
      alert(err.error ?? "Could not unfriend");
    }
  }

  async function handleInvite() {
    const text = shareMessage || "Join me on Northwest Community!";
    try {
      if (navigator.share) {
        await navigator.share({ text });
        return;
      }
    } catch {
      /* fall through to copy */
    }
    try {
      await navigator.clipboard.writeText(text);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    } catch {
      alert("Could not copy invite. Share the app from your profile instead.");
    }
  }

  const myCityKey = myCity?.toLowerCase().trim() || null;

  const friendsFiltered = useMemo(() => {
    if (!friendData) return [];
    let list = [...friendData.friends];
    const q = friendQuery.trim().toLowerCase();
    if (q) {
      list = list.filter((f) => {
        const name = fullName(f).toLowerCase();
        return name.includes(q) || (f.city ?? "").toLowerCase().includes(q);
      });
    }
    if (friendFilter === "nearby" && myCityKey) {
      list = list.filter((f) => (f.city ?? "").toLowerCase().trim() === myCityKey);
    }
    if (friendFilter === "recent") {
      list.sort((a, b) => {
        const ta = a.friendsSince ? new Date(a.friendsSince).getTime() : 0;
        const tb = b.friendsSince ? new Date(b.friendsSince).getTime() : 0;
        return tb - ta;
      });
    } else {
      list.sort((a, b) => fullName(a).localeCompare(fullName(b)));
    }
    return list;
  }, [friendData, friendQuery, friendFilter, myCityKey]);

  if (loading) return <p className="text-gray-500">Loading…</p>;
  if (!friendData) return <p className="text-gray-500">Failed to load friends.</p>;

  const requestCount = friendData.incoming.length;

  return (
    <div>
      <BackToProfileLink />
      <h1 className="text-2xl font-bold mb-4">My Friends</h1>

      <div className="flex flex-wrap gap-2 mb-6">
        <TabButton active={tab === "friends"} onClick={() => setTab("friends")}>
          Friends ({friendData.friends.length})
        </TabButton>
        <TabButton
          active={tab === "requests"}
          onClick={() => setTab("requests")}
          badge={requestCount}
        >
          Requests
        </TabButton>
        <TabButton active={tab === "discover"} onClick={() => setTab("discover")}>
          Discover
        </TabButton>
      </div>

      {tab === "friends" && (
        <div>
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <input
              type="search"
              value={friendQuery}
              onChange={(e) => setFriendQuery(e.target.value)}
              placeholder="Search friends…"
              className="flex-1 border border-gray-300 rounded-lg px-4 py-2"
            />
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["all", "All"],
                  ["nearby", myCity ? `Near you` : "Nearby"],
                  ["az", "A–Z"],
                  ["recent", "Recent"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFriendFilter(key)}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium ${
                    friendFilter === key
                      ? "text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                  style={friendFilter === key ? { backgroundColor: "var(--color-primary)" } : undefined}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {friendData.friends.length === 0 ? (
            <div className="text-center py-10 px-4 border rounded-xl bg-[var(--color-section-alt)]/40">
              <p className="font-semibold text-lg mb-1">No friends yet</p>
              <p className="text-gray-600 mb-4">
                Search for people you know, or invite someone from the Inland Northwest.
              </p>
              <div className="flex flex-wrap justify-center gap-3">
                <button
                  type="button"
                  onClick={() => setTab("discover")}
                  className="btn"
                >
                  Find members
                </button>
                <button type="button" onClick={handleInvite} className="btn-outline">
                  {shareCopied ? "Invite copied" : "Invite to NWC"}
                </button>
              </div>
            </div>
          ) : friendsFiltered.length === 0 ? (
            <p className="text-gray-500">
              {friendFilter === "nearby"
                ? myCity
                  ? `No friends in ${myCity} yet.`
                  : "Add a city to your profile to see nearby friends."
                : "No friends match that search."}
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {friendsFiltered.map((p) => (
                <FriendCard
                  key={p.id}
                  person={p}
                  menuOpen={menuOpenId === p.id}
                  onToggleMenu={() => setMenuOpenId((id) => (id === p.id ? null : p.id))}
                  onUnfriend={() => handleUnfriend(p)}
                />
              ))}
            </div>
          )}

          {friendData.friends.length > 0 && (
            <div className="mt-8 p-4 rounded-xl border-2 border-dashed flex flex-col sm:flex-row sm:items-center gap-3"
              style={{ borderColor: "var(--color-primary)" }}
            >
              <div className="flex-1">
                <p className="font-semibold">Invite someone from the Inland Northwest</p>
                <p className="text-sm text-gray-600">Share the app so friends can join and connect here.</p>
              </div>
              <button type="button" onClick={handleInvite} className="btn shrink-0">
                {shareCopied ? "Copied" : "Share Invite"}
              </button>
            </div>
          )}
        </div>
      )}

      {tab === "requests" && (
        <div className="space-y-8">
          <div>
            <h2 className="text-lg font-semibold mb-3">Incoming</h2>
            {friendData.incoming.length === 0 ? (
              <p className="text-gray-500">No pending friend requests.</p>
            ) : (
              <ul className="space-y-3">
                {friendData.incoming.map((r) => (
                  <li
                    key={r.id}
                    className="flex flex-col sm:flex-row sm:items-center gap-4 p-4 border-2 rounded-xl bg-[var(--color-section-alt)]/50"
                    style={{ borderColor: "var(--color-primary)" }}
                  >
                    <Link href={`/members/${r.requester.id}`}>
                      <PersonAvatar person={r.requester} size={56} />
                    </Link>
                    <div className="flex-1 min-w-0">
                      <Link href={`/members/${r.requester.id}`} className="font-semibold hover:underline">
                        {fullName(r.requester)}
                      </Link>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <CityChip city={r.requester.city} />
                        <span className="text-sm text-gray-600">wants to be friends</span>
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleAccept(r.id)}
                        className="rounded-lg text-white text-sm font-semibold py-2 px-4 hover:opacity-90"
                        style={{ backgroundColor: "var(--color-primary)" }}
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDecline(r.id)}
                        className="rounded-lg border-2 text-sm font-semibold py-2 px-4 hover:bg-white"
                        style={{ borderColor: "var(--color-primary)", color: "var(--color-primary)" }}
                      >
                        Decline
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {friendData.outgoing.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold mb-3">Sent</h2>
              <ul className="space-y-3">
                {friendData.outgoing.map((r) => (
                  <li key={r.id} className="flex items-center gap-4 p-3 border rounded-xl bg-white">
                    <PersonAvatar person={r.addressee} size={48} />
                    <div className="flex-1 min-w-0">
                      <Link href={`/members/${r.addressee.id}`} className="font-medium hover:underline">
                        {fullName(r.addressee)}
                      </Link>
                      <CityChip city={r.addressee.city} />
                    </div>
                    <span className="text-sm text-gray-500">Request sent</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {tab === "discover" && (
        <div>
          <label htmlFor="find-members-search" className="block text-sm font-medium text-gray-700 mb-2">
            Search by name
          </label>
          <input
            id="find-members-search"
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Type at least 2 characters…"
            className="w-full max-w-xl border border-gray-300 rounded-lg px-4 py-2 mb-4"
          />
          {searching && <p className="text-sm text-gray-500 mb-4">Searching…</p>}
          {searchQuery.length > 0 && searchQuery.length < 2 && (
            <p className="text-sm text-gray-500 mb-4">Type at least 2 characters to search.</p>
          )}
          {searchResults.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
              {searchResults.map((m) => (
                <DiscoverCard
                  key={m.id}
                  person={m}
                  friendStatus={getFriendStatus(m.id)}
                  onFriendAction={refreshFriends}
                />
              ))}
            </div>
          )}
          {searchQuery.length >= 2 && !searching && searchResults.length === 0 && (
            <p className="text-gray-500 mb-6">No members found.</p>
          )}

          {!searchQuery.trim() && (
            <>
              <h2 className="text-lg font-semibold mb-1">People you may know</h2>
              <p className="text-gray-600 text-sm mb-4">
                Suggested from mutual friends, groups, and your city.
              </p>
              {loadingSuggested ? (
                <p className="text-gray-500">Loading…</p>
              ) : suggested.length === 0 ? (
                <p className="text-gray-500 mb-6">
                  No suggestions right now. Add some friends first, and we’ll suggest others they know.
                </p>
              ) : (
                <div className="flex gap-4 overflow-x-auto pb-3 mb-8 -mx-1 px-1">
                  {suggested.map((m) => (
                    <DiscoverCard
                      key={m.id}
                      person={m}
                      reasons={
                        m.reasons?.length
                          ? m.reasons
                          : m.mutualCount
                            ? [`${m.mutualCount} mutual friend${m.mutualCount !== 1 ? "s" : ""}`]
                            : undefined
                      }
                      friendStatus={getFriendStatus(m.id)}
                      onFriendAction={refreshFriends}
                      carousel
                    />
                  ))}
                </div>
              )}

              {following.length > 0 && (
                <div>
                  <h2 className="text-lg font-semibold mb-2">Following ({following.length})</h2>
                  <p className="text-gray-600 text-sm mb-4">
                    People you follow. Their blog posts may appear in your feed.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {following.map((m) => (
                      <div key={m.id} className="flex items-center gap-3 p-3 border rounded-xl bg-white">
                        <PersonAvatar person={m} size={48} />
                        <div className="flex-1 min-w-0">
                          <Link href={`/members/${m.id}`} className="font-medium hover:underline">
                            {fullName(m)}
                          </Link>
                          <div className="mt-1">
                            <CityChip city={m.city} />
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleUnfollow(m.id)}
                          className="text-sm text-gray-600 hover:text-red-600"
                        >
                          Unfollow
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
