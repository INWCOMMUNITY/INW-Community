"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface EventInvite {
  id: string;
  status: string;
  event: {
    id: string;
    title: string;
    slug: string;
    date: string;
    time: string | null;
    location: string | null;
  };
  inviter: {
    id: string;
    firstName: string;
    lastName: string;
    profilePhotoUrl: string | null;
  };
  createdAt: string;
}

function statusLabel(status: string): string {
  if (status === "accepted") return "Going";
  if (status === "maybe") return "Maybe";
  if (status === "declined") return "Can't make it";
  return status;
}

export function EventInvitationsSidebar() {
  const [invites, setInvites] = useState<EventInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [responding, setResponding] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/me/event-invites?scope=all")
      .then((r) => r.json())
      .then((data) => {
        setInvites(data.invites ?? []);
      })
      .catch(() => setInvites([]))
      .finally(() => setLoading(false));
  }, []);

  async function respond(
    inviteId: string,
    status: "accepted" | "declined" | "maybe"
  ) {
    setResponding(inviteId);
    try {
      const res = await fetch(`/api/event-invites/${inviteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        setInvites((prev) =>
          prev.map((i) => (i.id === inviteId ? { ...i, status } : i))
        );
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error ?? "Failed to respond");
      }
    } finally {
      setResponding(null);
    }
  }

  if (loading) return null;
  if (invites.length === 0) return null;

  const pending = invites.filter((i) => i.status === "pending");
  const responded = invites.filter((i) => i.status !== "pending");

  return (
    <aside className="w-full lg:w-64 shrink-0 order-3">
      <div className="border rounded-lg p-4 bg-gray-50 sticky top-24">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Event Invitations</h2>
        {pending.length > 0 ? (
          <>
            <p className="text-xs text-gray-500 mb-2 font-medium">Needs your response</p>
            <ul className="space-y-3 mb-4">
              {pending.map((inv) => (
                <li
                  key={inv.id}
                  className="border-b border-gray-200 pb-3 last:border-0 last:pb-0"
                >
                  <Link
                    href={`/events/${inv.event.slug}`}
                    className="font-medium text-gray-900 hover:underline block mb-1"
                  >
                    {inv.event.title}
                  </Link>
                  <p className="text-xs text-gray-500 mb-1">
                    {new Date(inv.event.date).toLocaleDateString()}
                    {inv.event.location && ` · ${inv.event.location}`}
                  </p>
                  <p className="text-sm text-gray-600 mb-2">
                    Invited by {inv.inviter.firstName} {inv.inviter.lastName}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => respond(inv.id, "accepted")}
                      disabled={responding === inv.id}
                      className="text-sm px-2 py-1 rounded bg-green-100 text-green-800 hover:bg-green-200 disabled:opacity-50"
                    >
                      {responding === inv.id ? "…" : "Accept"}
                    </button>
                    <button
                      type="button"
                      onClick={() => respond(inv.id, "maybe")}
                      disabled={responding === inv.id}
                      className="text-sm px-2 py-1 rounded bg-amber-50 text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                    >
                      Maybe
                    </button>
                    <button
                      type="button"
                      onClick={() => respond(inv.id, "declined")}
                      disabled={responding === inv.id}
                      className="text-sm px-2 py-1 rounded bg-gray-200 text-gray-700 hover:bg-gray-300 disabled:opacity-50"
                    >
                      Decline
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {responded.length > 0 ? (
          <>
            <p className="text-xs text-gray-500 mb-2 font-medium">Your responses</p>
            <ul className="space-y-3">
              {responded.map((inv) => (
                <li
                  key={inv.id}
                  className="border-b border-gray-200 pb-3 last:border-0 last:pb-0"
                >
                  <Link
                    href={`/events/${inv.event.slug}`}
                    className="font-medium text-gray-900 hover:underline block mb-1"
                  >
                    {inv.event.title}
                  </Link>
                  <p className="text-xs text-gray-500 mb-1">
                    {new Date(inv.event.date).toLocaleDateString()}
                  </p>
                  <p className="text-xs font-medium text-gray-700">
                    {statusLabel(inv.status)}
                  </p>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </aside>
  );
}
