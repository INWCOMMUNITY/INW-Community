"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { IonIcon } from "@/components/IonIcon";
import { formatTime12h } from "@/lib/format-time";

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

function formatEventDate(dateStr: string, time: string | null): string {
  const line = new Date(dateStr).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  return time ? `${line} · ${formatTime12h(time)}` : line;
}

export function EventInvitationsSidebar() {
  const [invites, setInvites] = useState<EventInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [responding, setResponding] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/me/event-invites?scope=all")
      .then((r) => r.json())
      .then((data) => {
        setInvites(data.invites ?? []);
      })
      .catch(() => setInvites([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!openMenuId) return;
    const handle = (e: MouseEvent) => {
      const el = document.querySelector(`[data-invite-menu="${openMenuId}"]`);
      if (el && !el.contains(e.target as Node)) setOpenMenuId(null);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [openMenuId]);

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

  const cardClass = "rounded-lg border-2 p-3 mb-3 last:mb-0 bg-[#f9f9f9]";

  return (
    <aside className="w-full shrink-0 order-3 lg:pr-5">
      <div
        className="rounded-lg border-2 p-4 bg-white sticky top-24 shadow-sm"
        style={{ borderColor: "var(--color-primary)" }}
      >
        <h2
          className="text-base font-bold mb-1"
          style={{
            fontFamily: "var(--font-heading)",
            color: "var(--color-heading)",
          }}
        >
          Local Event Invites
        </h2>
        <p className="text-xs text-gray-600 mb-3 leading-snug">
          Open an event anytime; update your RSVP from the menu.
        </p>
        {pending.length > 0 ? (
          <>
            <p
              className="text-sm font-bold mb-2"
              style={{ color: "var(--color-heading)" }}
            >
              Needs your response
            </p>
            <ul className="mb-4 list-none p-0 m-0">
              {pending.map((inv) => (
                <li key={inv.id} className={cardClass} style={{ borderColor: "var(--color-primary)" }}>
                  <Link
                    href={`/events/${inv.event.slug}`}
                    className="block font-semibold text-[#333] hover:underline text-sm leading-tight"
                  >
                    {inv.event.title}
                  </Link>
                  <p className="text-sm text-gray-600 mt-1">
                    {formatEventDate(inv.event.date, inv.event.time)}
                  </p>
                  {inv.event.location ? (
                    <p className="text-xs text-gray-500 mt-0.5">{inv.event.location}</p>
                  ) : null}
                  <p
                    className="text-xs mt-2"
                    style={{ color: "var(--color-primary)" }}
                  >
                    Invited by {inv.inviter.firstName} {inv.inviter.lastName}
                  </p>
                  <div className="flex flex-wrap gap-2 mt-3">
                    <button
                      type="button"
                      onClick={() => respond(inv.id, "accepted")}
                      disabled={responding === inv.id}
                      className="flex-1 min-w-[4.5rem] text-xs font-semibold py-2 rounded-md text-white disabled:opacity-50 transition-opacity"
                      style={{ backgroundColor: "var(--color-primary)" }}
                    >
                      {responding === inv.id ? "…" : "Accept"}
                    </button>
                    <button
                      type="button"
                      onClick={() => respond(inv.id, "maybe")}
                      disabled={responding === inv.id}
                      className="flex-1 min-w-[4.5rem] text-xs font-semibold py-2 rounded-md border-2 disabled:opacity-50 transition-opacity"
                      style={{
                        backgroundColor: "var(--color-section-alt)",
                        borderColor: "var(--color-primary)",
                        color: "var(--color-primary)",
                      }}
                    >
                      Maybe
                    </button>
                    <button
                      type="button"
                      onClick={() => respond(inv.id, "declined")}
                      disabled={responding === inv.id}
                      className="flex-1 min-w-[4.5rem] text-xs py-2 rounded-md border border-gray-500 text-gray-600 bg-transparent hover:bg-gray-100 disabled:opacity-50"
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
            <p
              className={`text-sm font-bold mb-2 ${pending.length > 0 ? "mt-4" : ""}`}
              style={{ color: "var(--color-heading)" }}
            >
              Your responses
            </p>
            <ul className="space-y-0 list-none p-0 m-0">
              {responded.map((inv) => (
                <li
                  key={inv.id}
                  data-invite-menu={inv.id}
                  className={`${cardClass} relative`}
                  style={{ borderColor: "var(--color-primary)" }}
                >
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/events/${inv.event.slug}`}
                        className="font-semibold text-[#333] hover:underline block text-sm leading-tight pr-1"
                      >
                        {inv.event.title}
                      </Link>
                      <p className="text-sm text-gray-600 mt-1">
                        {formatEventDate(inv.event.date, inv.event.time)}
                      </p>
                      {inv.event.location ? (
                        <p className="text-xs text-gray-500 mt-0.5">{inv.event.location}</p>
                      ) : null}
                      <p
                        className="text-xs mt-2"
                        style={{ color: "var(--color-primary)" }}
                      >
                        Invited by {inv.inviter.firstName} {inv.inviter.lastName}
                      </p>
                      <span
                        className="inline-block mt-2.5 px-2.5 py-1 rounded-full text-xs font-bold"
                        style={{
                          backgroundColor: "color-mix(in srgb, var(--color-primary) 15%, transparent)",
                          color: "var(--color-primary)",
                        }}
                      >
                        {statusLabel(inv.status)}
                      </span>
                    </div>
                    <div className="relative shrink-0 pt-0.5">
                      <button
                        type="button"
                        aria-label="Change RSVP"
                        aria-expanded={openMenuId === inv.id}
                        onClick={() =>
                          setOpenMenuId((id) => (id === inv.id ? null : inv.id))
                        }
                        className="rounded-md p-1 -m-1 hover:bg-gray-200/80 transition-colors"
                        style={{ color: "var(--color-heading)" }}
                      >
                        <IonIcon name="ellipsis-vertical" size={22} />
                      </button>
                      {openMenuId === inv.id ? (
                        <div
                          className="absolute right-0 z-20 mt-1 w-44 rounded-md border-2 bg-white py-1 shadow-lg"
                          style={{ borderColor: "var(--color-primary)" }}
                          role="menu"
                        >
                          <button
                            type="button"
                            role="menuitem"
                            className="block w-full px-3 py-2 text-left text-sm text-gray-800 hover:bg-[var(--color-section-alt)] disabled:opacity-50"
                            disabled={responding === inv.id}
                            onClick={() => {
                              void respond(inv.id, "accepted");
                              setOpenMenuId(null);
                            }}
                          >
                            Going
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            className="block w-full px-3 py-2 text-left text-sm text-gray-800 hover:bg-[var(--color-section-alt)] disabled:opacity-50"
                            disabled={responding === inv.id}
                            onClick={() => {
                              void respond(inv.id, "maybe");
                              setOpenMenuId(null);
                            }}
                          >
                            Maybe
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            className="block w-full px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
                            disabled={responding === inv.id}
                            onClick={() => {
                              void respond(inv.id, "declined");
                              setOpenMenuId(null);
                            }}
                          >
                            Can&apos;t make it
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </aside>
  );
}
