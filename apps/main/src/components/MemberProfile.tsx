"use client";

import { useState } from "react";
import Link from "next/link";

interface MemberProfileProps {
  member: {
    id: string;
    firstName: string;
    lastName: string;
    profilePhotoUrl: string | null;
    bio: string | null;
    city: string | null;
  };
  blogs: Array<{
    id: string;
    slug: string;
    title: string;
    createdAt: Date;
  }>;
  favoriteBusinesses?: Array<{
    id: string;
    name: string;
    slug: string;
    logoUrl: string | null;
  }>;
  sessionUserId: string | null;
  isOwnProfile: boolean;
  isFriend?: boolean;
  isFollowing?: boolean;
  pendingFriendRequest?: "incoming" | "outgoing" | null;
  editProfileHref?: string;
  friendsHref?: string;
}

export function MemberProfile({
  member,
  blogs,
  favoriteBusinesses = [],
  sessionUserId,
  isOwnProfile,
  isFriend = false,
  isFollowing = false,
  pendingFriendRequest = null,
  editProfileHref = "/my-community/profile",
  friendsHref = "/my-community/friends",
}: MemberProfileProps) {
  const [following, setFollowing] = useState(isFollowing);
  const [friendPending, setFriendPending] = useState(pendingFriendRequest);
  const [loading, setLoading] = useState<string | null>(null);

  async function handleFollow() {
    if (!sessionUserId || loading) return;
    setLoading("follow");
    try {
      const res = await fetch("/api/follow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId: member.id, action: following ? "unfollow" : "follow" }),
      });
      if (res.ok) {
        const data = await res.json();
        setFollowing(data.following);
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error ?? "Failed");
      }
    } finally {
      setLoading(null);
    }
  }

  async function handleAddFriend() {
    if (!sessionUserId || loading || isFriend || friendPending) return;
    setLoading("friend");
    try {
      const res = await fetch("/api/friend-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addresseeId: member.id }),
      });
      if (res.ok) {
        setFriendPending("outgoing");
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error ?? "Failed to send request");
      }
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="max-w-2xl">
      <div className="flex flex-col sm:flex-row gap-6 items-start">
        {member.profilePhotoUrl ? (
          <img
            src={member.profilePhotoUrl}
            alt=""
            className="w-24 h-24 rounded-full object-cover shrink-0"
          />
        ) : (
          <div className="w-24 h-24 rounded-full bg-gray-300 flex items-center justify-center text-2xl font-medium text-gray-600 shrink-0">
            {member.firstName?.[0]}{member.lastName?.[0]}
          </div>
        )}
        <div>
          <h1 className="text-2xl font-bold">
            {member.firstName} {member.lastName}
          </h1>
          {member.city && (
            <p className="text-gray-600 text-sm mt-1">{member.city}</p>
          )}
          {member.bio && (
            <p className="text-gray-700 mt-2 whitespace-pre-wrap">{member.bio}</p>
          )}
          {sessionUserId && !isOwnProfile && (
            <div className="flex flex-wrap gap-2 mt-4">
              {isFriend ? (
                <span className="btn text-sm opacity-75 cursor-default">Friends</span>
              ) : friendPending === "outgoing" ? (
                <span className="btn text-sm border opacity-75 cursor-default">Request sent</span>
              ) : friendPending === "incoming" ? (
                <Link href="/my-community/friends" className="btn text-sm">
                  Accept request
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={handleAddFriend}
                  disabled={!!loading}
                  className="btn text-sm"
                >
                  {loading === "friend" ? "Sending…" : "Add friend"}
                </button>
              )}
              <button
                type="button"
                onClick={handleFollow}
                disabled={!!loading}
                className="btn text-sm border"
              >
                {loading === "follow" ? "…" : following ? "Following" : "Follow"}
              </button>
            </div>
          )}
          {isOwnProfile && (
            <Link href={editProfileHref} className="btn text-sm mt-4 inline-block">
              Edit profile
            </Link>
          )}
        </div>
      </div>
      {favoriteBusinesses.length > 0 && (
        <div className="mt-8">
          <h2 className="text-xl font-bold mb-4">Favorite Businesses</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {favoriteBusinesses.map((b) => (
              <Link
                key={b.id}
                href={`/support-local/${b.slug}`}
                className="border rounded-lg p-4 hover:bg-gray-50 flex flex-col items-center text-center"
              >
                {b.logoUrl ? (
                  <img src={b.logoUrl} alt="" className="w-16 h-16 object-cover rounded mb-2" />
                ) : (
                  <div className="w-16 h-16 bg-gray-200 rounded flex items-center justify-center text-gray-500 mb-2">
                    {b.name[0]}
                  </div>
                )}
                <span className="font-medium text-sm">{b.name}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
      {blogs.length > 0 && (
        <div className="mt-8">
          <h2 className="text-xl font-bold mb-4">Blogs</h2>
          <ul className="space-y-2">
            {blogs.map((b) => (
              <li key={b.id}>
                <Link href={`/blog/${b.slug}`} className="hover:underline font-medium">
                  {b.title}
                </Link>
                <span className="text-gray-500 text-sm ml-2">
                  {new Date(b.createdAt).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
