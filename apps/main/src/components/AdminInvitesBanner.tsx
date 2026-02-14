"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface Invite {
  id: string;
  group: { id: string; name: string; slug: string };
  inviter: { id: string; firstName: string; lastName: string };
}

export function AdminInvitesBanner() {
  const [invites, setInvites] = useState<Invite[]>([]);

  useEffect(() => {
    fetch("/api/me/admin-invites")
      .then((r) => r.json())
      .then((data) => setInvites(data.invites ?? []))
      .catch(() => setInvites([]));
  }, []);

  async function respond(slug: string, action: "accept" | "decline") {
    const res = await fetch(`/api/groups/${slug}/admin-invite`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    if (res.ok) {
      setInvites((prev) => prev.filter((i) => i.group.slug !== slug));
    }
  }

  if (invites.length === 0) return null;

  return (
    <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg">
      <h2 className="font-bold mb-2">Group admin invites</h2>
      <ul className="space-y-2">
        {invites.map((inv) => (
          <li key={inv.id} className="flex items-center justify-between gap-4">
            <span>
              <Link href={`/community-groups/${inv.group.slug}`} className="font-medium hover:underline">
                {inv.group.name}
              </Link>
              {" — "}
              {inv.inviter.firstName} {inv.inviter.lastName} invited you as admin
            </span>
            <div className="flex gap-2 shrink-0">
              <button
                type="button"
                onClick={() => respond(inv.group.slug, "accept")}
                className="text-sm text-green-600 hover:underline font-medium"
              >
                Accept
              </button>
              <button
                type="button"
                onClick={() => respond(inv.group.slug, "decline")}
                className="text-sm text-gray-600 hover:underline"
              >
                Decline
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
