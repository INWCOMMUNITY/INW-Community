"use client";

import { useState, useEffect } from "react";

interface Friend {
  id: string;
  firstName: string;
  lastName: string;
}

interface InviteFriendsToEventProps {
  eventId: string;
}

export function InviteFriendsToEvent({ eventId }: InviteFriendsToEventProps) {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch("/api/me/friends")
      .then((r) => r.json())
      .then((data) => setFriends(data.friends ?? []))
      .catch(() => setFriends([]));
  }, []);

  function toggleFriend(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleInvite() {
    if (selected.size === 0) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/events/${eventId}/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ friendIds: Array.from(selected) }),
      });
      const data = await res.json();
      if (res.ok) {
        setSelected(new Set());
        setOpen(false);
        alert(`Invited ${data.invited ?? selected.size} friend(s)!`);
      } else {
        alert(data.error ?? "Failed to invite");
      }
    } finally {
      setLoading(false);
    }
  }

  if (friends.length === 0) return null;

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="btn border"
      >
        Invite friends
      </button>
      {open && (
        <div className="mt-3 p-4 border rounded-lg bg-gray-50 max-w-md">
          <h3 className="font-semibold mb-2">Select friends to invite</h3>
          <ul className="space-y-1 max-h-48 overflow-y-auto mb-3">
            {friends.map((f) => (
              <li key={f.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id={`friend-${f.id}`}
                  checked={selected.has(f.id)}
                  onChange={() => toggleFriend(f.id)}
                  className="rounded"
                />
                <label htmlFor={`friend-${f.id}`} className="cursor-pointer">
                  {f.firstName} {f.lastName}
                </label>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleInvite}
              disabled={loading || selected.size === 0}
              className="btn text-sm"
            >
              {loading ? "Inviting…" : `Invite ${selected.size} friend(s)`}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="btn border text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
