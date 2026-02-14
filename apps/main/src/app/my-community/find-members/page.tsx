"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { AddFriendButton } from "@/components/AddFriendButton";

type FriendStatus = "none" | "friends" | "pending_outgoing" | "pending_incoming";

interface Member {
  id: string;
  firstName: string;
  lastName: string;
  profilePhotoUrl: string | null;
  city?: string | null;
}

interface SuggestedMember extends Member {
  mutualCount: number;
}

export default function FindMembersPage() {
  const { data: session, status } = useSession();
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Member[]>([]);
  const [searching, setSearching] = useState(false);
  const [suggested, setSuggested] = useState<SuggestedMember[]>([]);
  const [loadingSuggested, setLoadingSuggested] = useState(true);
  const [friendData, setFriendData] = useState<{
    friends: Member[];
    incoming: { requester: Member; id: string }[];
    outgoing: { addressee: Member; id: string }[];
  } | null>(null);

  useEffect(() => {
    if (status !== "authenticated") return;
    fetch("/api/friend-requests")
      .then((r) => r.json())
      .then(setFriendData)
      .catch(() => setFriendData(null));
  }, [status]);

  useEffect(() => {
    if (status !== "authenticated") return;
    setLoadingSuggested(true);
    fetch("/api/me/suggested-friends")
      .then((r) => r.json())
      .then((data) => setSuggested(data.suggested ?? []))
      .catch(() => setSuggested([]))
      .finally(() => setLoadingSuggested(false));
  }, [status]);

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

  function onFriendAction() {
    fetch("/api/friend-requests")
      .then((r) => r.json())
      .then(setFriendData)
      .catch(() => {});
    fetch("/api/me/suggested-friends")
      .then((r) => r.json())
      .then((data) => setSuggested(data.suggested ?? []))
      .catch(() => {});
  }

  if (status === "loading") {
    return <p className="text-gray-500">Loading…</p>;
  }
  if (status !== "authenticated") {
    return (
      <div className="max-w-md">
        <p className="text-gray-600 mb-4">Sign in to find and add friends.</p>
        <Link
          href={`/login?callbackUrl=${encodeURIComponent("/my-community/find-members")}`}
          className="btn"
        >
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Find Members</h1>
      <p className="text-gray-600 mb-6">
        Search by name or discover people you may know through mutual friends.
      </p>

      <div className="mb-8">
        <label htmlFor="find-members-search" className="block text-sm font-medium text-gray-700 mb-2">
          Search by name
        </label>
        <input
          id="find-members-search"
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Type at least 2 characters..."
          className="w-full max-w-md border border-gray-300 rounded-lg px-4 py-2"
        />
        {searching && <p className="text-sm text-gray-500 mt-2">Searching…</p>}
        {searchQuery.length > 0 && searchQuery.length < 2 && (
          <p className="text-sm text-gray-500 mt-2">Type at least 2 characters to search.</p>
        )}
        {searchResults.length > 0 && (
          <ul className="mt-4 space-y-3 max-w-2xl">
            {searchResults.map((m) => (
              <li
                key={m.id}
                className="flex items-center gap-4 p-3 border rounded-lg bg-gray-50 hover:bg-gray-100"
              >
                {m.profilePhotoUrl ? (
                  <img
                    src={m.profilePhotoUrl}
                    alt=""
                    className="w-12 h-12 rounded-full object-cover"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-gray-300 flex items-center justify-center text-sm font-medium text-gray-600">
                    {m.firstName?.[0]}
                    {m.lastName?.[0]}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <Link href={`/members/${m.id}`} className="font-medium hover:underline">
                    {m.firstName} {m.lastName}
                  </Link>
                  {m.city && <span className="text-gray-500 text-sm ml-2">· {m.city}</span>}
                </div>
                <AddFriendButton
                  memberId={m.id}
                  initialStatus={getFriendStatus(m.id)}
                  onSuccess={onFriendAction}
                />
              </li>
            ))}
          </ul>
        )}
        {searchQuery.length >= 2 && !searching && searchResults.length === 0 && (
          <p className="text-gray-500 mt-4">No members found.</p>
        )}
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-4">Suggested for you</h2>
        <p className="text-gray-600 text-sm mb-4">
          People with mutual friends. Add them to grow your community.
        </p>
        {loadingSuggested ? (
          <p className="text-gray-500">Loading…</p>
        ) : suggested.length === 0 ? (
          <p className="text-gray-500">
            No suggestions right now. Add some friends first, and we’ll suggest others they know.
          </p>
        ) : (
          <ul className="space-y-3 max-w-2xl">
            {suggested.map((m) => (
              <li
                key={m.id}
                className="flex items-center gap-4 p-3 border rounded-lg bg-gray-50 hover:bg-gray-100"
              >
                {m.profilePhotoUrl ? (
                  <img
                    src={m.profilePhotoUrl}
                    alt=""
                    className="w-12 h-12 rounded-full object-cover"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-gray-300 flex items-center justify-center text-sm font-medium text-gray-600">
                    {m.firstName?.[0]}
                    {m.lastName?.[0]}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <Link href={`/members/${m.id}`} className="font-medium hover:underline">
                    {m.firstName} {m.lastName}
                  </Link>
                  {m.city && <span className="text-gray-500 text-sm ml-2">· {m.city}</span>}
                  <p className="text-xs text-gray-500 mt-0.5">
                    {m.mutualCount} mutual friend{m.mutualCount !== 1 ? "s" : ""}
                  </p>
                </div>
                <AddFriendButton
                  memberId={m.id}
                  initialStatus={getFriendStatus(m.id)}
                  onSuccess={onFriendAction}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
