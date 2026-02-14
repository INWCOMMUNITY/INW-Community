"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface FriendData {
  incoming: Array<{
    id: string;
    status: string;
    createdAt: string;
    requester: { id: string; firstName: string; lastName: string; profilePhotoUrl: string | null };
  }>;
  outgoing: Array<{
    id: string;
    status: string;
    addressee: { id: string; firstName: string; lastName: string; profilePhotoUrl: string | null };
  }>;
  friends: Array<{
    id: string;
    firstName: string;
    lastName: string;
    profilePhotoUrl: string | null;
  }>;
}

interface FollowingMember {
  id: string;
  firstName: string;
  lastName: string;
  profilePhotoUrl: string | null;
  city: string | null;
}

export default function FriendsFollowingPage() {
  const [friendData, setFriendData] = useState<FriendData | null>(null);
  const [following, setFollowing] = useState<FollowingMember[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/friend-requests").then((r) => r.json()),
      fetch("/api/me/following").then((r) => r.json()),
    ])
      .then(([friendRes, followingRes]) => {
        setFriendData(friendRes);
        setFollowing(followingRes.following ?? []);
      })
      .catch(() => {
        setFriendData(null);
        setFollowing([]);
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleAccept(id: string) {
    const res = await fetch(`/api/friend-requests/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "accepted" }),
    });
    if (res.ok) {
      const d = await fetch("/api/friend-requests").then((r) => r.json());
      setFriendData(d);
    }
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

  if (loading) return <p className="text-gray-500">Loading…</p>;
  if (!friendData) return <p className="text-gray-500">Failed to load friends.</p>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Friends / Following</h1>

      {friendData.incoming.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold mb-4">Friend requests</h2>
          <ul className="space-y-3">
            {friendData.incoming.map((r) => (
              <li key={r.id} className="flex items-center gap-4 p-3 border rounded bg-gray-50">
                {r.requester.profilePhotoUrl ? (
                  <img src={r.requester.profilePhotoUrl} alt="" className="w-10 h-10 rounded-full object-cover" />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-gray-300 flex items-center justify-center text-sm font-medium text-gray-600">
                    {r.requester.firstName?.[0]}{r.requester.lastName?.[0]}
                  </div>
                )}
                <div className="flex-1">
                  <Link href={`/members/${r.requester.id}`} className="font-medium hover:underline">
                    {r.requester.firstName} {r.requester.lastName}
                  </Link>
                  <span className="text-gray-500 text-sm ml-2">wants to be friends</span>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleAccept(r.id)}
                    className="text-green-600 hover:underline text-sm font-medium"
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDecline(r.id)}
                    className="text-gray-600 hover:underline text-sm"
                  >
                    Decline
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {friendData.outgoing.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold mb-4">Pending requests</h2>
          <ul className="space-y-3">
            {friendData.outgoing.map((r) => (
              <li key={r.id} className="flex items-center gap-4 p-3 border rounded bg-gray-50">
                {r.addressee.profilePhotoUrl ? (
                  <img src={r.addressee.profilePhotoUrl} alt="" className="w-10 h-10 rounded-full object-cover" />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-gray-300 flex items-center justify-center text-sm font-medium text-gray-600">
                    {r.addressee.firstName?.[0]}{r.addressee.lastName?.[0]}
                  </div>
                )}
                <div className="flex-1">
                  <Link href={`/members/${r.addressee.id}`} className="font-medium hover:underline">
                    {r.addressee.firstName} {r.addressee.lastName}
                  </Link>
                  <span className="text-gray-500 text-sm ml-2">Pending</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mb-8">
        <h2 className="text-lg font-semibold mb-4">Friends ({friendData.friends.length})</h2>
        {friendData.friends.length === 0 ? (
          <p className="text-gray-500">No friends yet. Add friends from member profiles!</p>
        ) : (
          <ul className="space-y-3">
            {friendData.friends.map((f) => (
              <li key={f.id} className="flex items-center gap-4 p-3 border rounded hover:bg-gray-50">
                {f.profilePhotoUrl ? (
                  <img src={f.profilePhotoUrl} alt="" className="w-10 h-10 rounded-full object-cover" />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-gray-300 flex items-center justify-center text-sm font-medium text-gray-600">
                    {f.firstName?.[0]}{f.lastName?.[0]}
                  </div>
                )}
                <Link href={`/members/${f.id}`} className="font-medium hover:underline flex-1">
                  {f.firstName} {f.lastName}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-4">Following ({following.length})</h2>
        <p className="text-gray-600 mb-4">
          People you follow. Their blog posts may appear in your feed.
        </p>
        {following.length === 0 ? (
          <p className="text-gray-500">You are not following anyone yet. Follow blog authors from their profiles or blog posts!</p>
        ) : (
          <ul className="space-y-3">
            {following.map((m) => (
              <li
                key={m.id}
                className="flex items-center gap-4 p-3 border rounded bg-gray-50 hover:bg-gray-100"
              >
                {m.profilePhotoUrl ? (
                  <img src={m.profilePhotoUrl} alt="" className="w-10 h-10 rounded-full object-cover" />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-gray-300 flex items-center justify-center text-sm font-medium text-gray-600">
                    {m.firstName?.[0]}{m.lastName?.[0]}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <Link href={`/members/${m.id}`} className="font-medium hover:underline">
                    {m.firstName} {m.lastName}
                  </Link>
                  {m.city && <span className="text-gray-500 text-sm ml-2">· {m.city}</span>}
                </div>
                <button
                  type="button"
                  onClick={() => handleUnfollow(m.id)}
                  className="text-sm text-gray-600 hover:text-red-600 hover:underline"
                >
                  Unfollow
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
