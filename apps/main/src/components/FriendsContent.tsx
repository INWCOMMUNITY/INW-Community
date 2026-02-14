"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

type Friend = {
  id: string;
  firstName: string;
  lastName: string;
  profilePhotoUrl: string | null;
  city: string | null;
};

type FriendRequestWithUsers = {
  id: string;
  status: string;
  requesterId: string;
  addresseeId: string;
  requester: { id: string; firstName: string; lastName: string; profilePhotoUrl: string | null };
  addressee: { id: string; firstName: string; lastName: string; profilePhotoUrl: string | null };
};

type Member = {
  id: string;
  firstName: string;
  lastName: string;
  profilePhotoUrl: string | null;
  city: string | null;
};

export function FriendsContent() {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [incoming, setIncoming] = useState<FriendRequestWithUsers[]>([]);
  const [outgoing, setOutgoing] = useState<FriendRequestWithUsers[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Member[]>([]);
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(true);
  const [actioning, setActioning] = useState<string | null>(null);

  async function loadFriends() {
    try {
      const res = await fetch("/api/me/friends");
      const data = await res.json();
      if (data?.friends) setFriends(data.friends);
    } catch {
      setFriends([]);
    }
  }

  async function loadRequests() {
    try {
      const res = await fetch("/api/friend-requests");
      const data = await res.json();
      if (data?.incoming) setIncoming(data.incoming);
      if (data?.outgoing) setOutgoing(data.outgoing);
    } catch {
      setIncoming([]);
      setOutgoing([]);
    }
  }

  useEffect(() => {
    setLoading(true);
    Promise.all([loadFriends(), loadRequests()]).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!searchQuery || searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/members?q=${encodeURIComponent(searchQuery)}`);
        const data = await res.json();
        setSearchResults(data?.members ?? []);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  async function sendRequest(addresseeId: string) {
    setActioning(addresseeId);
    try {
      const res = await fetch("/api/friend-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addresseeId }),
      });
      const data = await res.json();
      if (res.ok) {
        loadRequests();
        loadFriends();
        setSearchQuery("");
        setSearchResults([]);
      } else {
        alert(data?.error ?? "Failed");
      }
    } finally {
      setActioning(null);
    }
  }

  async function respondToRequest(id: string, action: "accept" | "decline") {
    setActioning(id);
    try {
      const res = await fetch(`/api/friend-requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        loadFriends();
        loadRequests();
      } else {
        const data = await res.json();
        alert(data?.error ?? "Failed");
      }
    } finally {
      setActioning(null);
    }
  }

  const friendIds = new Set(friends.map((f) => f.id));
  const outgoingIds = new Set(outgoing.filter((r) => r.status === "pending").map((r) => r.addresseeId));
  const incomingIds = new Set(incoming.filter((r) => r.status === "pending").map((r) => r.requesterId));

  function MemberAvatar({ m }: { m: { firstName: string; lastName: string; profilePhotoUrl?: string | null } }) {
    return m.profilePhotoUrl ? (
      <img src={m.profilePhotoUrl} alt="" className="w-12 h-12 rounded-full object-cover shrink-0" />
    ) : (
      <div className="w-12 h-12 rounded-full bg-gray-300 flex items-center justify-center text-sm font-medium text-gray-600 shrink-0">
        {m.firstName?.[0]}{m.lastName?.[0]}
      </div>
    );
  }

  if (loading) {
    return <p className="text-gray-600">Loading…</p>;
  }

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-lg font-semibold mb-3">Find members</h2>
        <input
          type="search"
          placeholder="Search by name (min 2 chars)"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full max-w-md border rounded px-3 py-2"
        />
        {searching && <p className="text-sm text-gray-500 mt-1">Searching…</p>}
        {searchResults.length > 0 && (
          <ul className="mt-3 space-y-2">
            {searchResults.map((m) => (
              <li key={m.id} className="flex items-center gap-3 py-2 border-b border-gray-100">
                <MemberAvatar m={m} />
                <div className="flex-1 min-w-0">
                  <Link href={`/members/${m.id}`} className="font-medium hover:underline">
                    {m.firstName} {m.lastName}
                  </Link>
                  {m.city && <p className="text-sm text-gray-500">{m.city}</p>}
                </div>
                {friendIds.has(m.id) ? (
                  <span className="text-sm text-gray-500">Friends</span>
                ) : outgoingIds.has(m.id) ? (
                  <span className="text-sm text-gray-500">Request sent</span>
                ) : incomingIds.has(m.id) ? (
                  <span className="text-sm text-gray-500">Wants to be friends</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => sendRequest(m.id)}
                    disabled={!!actioning}
                    className="btn text-sm py-1 px-2"
                  >
                    {actioning === m.id ? "Sending…" : "Add friend"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Pending requests</h2>
        {incoming.filter((r) => r.status === "pending").length === 0 &&
        outgoing.filter((r) => r.status === "pending").length === 0 ? (
          <p className="text-gray-500 text-sm">No pending requests.</p>
        ) : (
          <div className="space-y-4">
            {incoming.filter((r) => r.status === "pending").length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-gray-600 mb-2">Incoming</h3>
                <ul className="space-y-2">
                  {incoming
                    .filter((r) => r.status === "pending")
                    .map((r) => (
                      <li key={r.id} className="flex items-center gap-3 py-2">
                        <MemberAvatar m={r.requester} />
                        <div className="flex-1">
                          <Link href={`/members/${r.requester.id}`} className="font-medium hover:underline">
                            {r.requester.firstName} {r.requester.lastName}
                          </Link>
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => respondToRequest(r.id, "accept")}
                            disabled={!!actioning}
                            className="btn text-sm py-1 px-2 bg-green-600 text-white hover:bg-green-700"
                          >
                            {actioning === r.id ? "…" : "Accept"}
                          </button>
                          <button
                            type="button"
                            onClick={() => respondToRequest(r.id, "decline")}
                            disabled={!!actioning}
                            className="btn text-sm py-1 px-2 border"
                          >
                            Decline
                          </button>
                        </div>
                      </li>
                    ))}
                </ul>
              </div>
            )}
            {outgoing.filter((r) => r.status === "pending").length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-gray-600 mb-2">Outgoing</h3>
                <ul className="space-y-2">
                  {outgoing
                    .filter((r) => r.status === "pending")
                    .map((r) => (
                      <li key={r.id} className="flex items-center gap-3 py-2">
                        <MemberAvatar m={r.addressee} />
                        <div className="flex-1">
                          <Link href={`/members/${r.addressee.id}`} className="font-medium hover:underline">
                            {r.addressee.firstName} {r.addressee.lastName}
                          </Link>
                        </div>
                        <span className="text-sm text-gray-500">Pending</span>
                      </li>
                    ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">My friends</h2>
        {friends.length === 0 ? (
          <p className="text-gray-500 text-sm">No friends yet. Search for members above to add friends.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {friends.map((f) => (
              <li key={f.id} className="flex items-center gap-3 p-3 border rounded-lg">
                <MemberAvatar m={f} />
                <div className="flex-1 min-w-0">
                  <Link href={`/members/${f.id}`} className="font-medium hover:underline">
                    {f.firstName} {f.lastName}
                  </Link>
                  {f.city && <p className="text-sm text-gray-500">{f.city}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
