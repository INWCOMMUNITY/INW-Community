"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { HeartSaveButton } from "@/components/HeartSaveButton";
import { IonIcon } from "@/components/IonIcon";
import { EventInviteStatsBlocks } from "@/components/event/EventInviteStatsBlocks";
import { buildBusinessHref } from "@/lib/business-referrer";
import {
  buildGoogleCalendarTemplateUrl,
  downloadEventIcs,
  type EventCalendarInput,
} from "@/lib/event-calendar-export-web";
import { formatTime12h } from "@/lib/format-time";
import { buildEventHref } from "@/lib/event-referrer";
import {
  eventCoverSrc,
  rsvpStatusLabel,
  type MyEventListItem,
  type MyEventsTab,
} from "@/lib/my-events-page";

type Friend = { id: string; firstName: string; lastName: string };

function actionClass(extra = "") {
  return `inline-flex items-center justify-center gap-1 rounded-lg border-2 border-[var(--color-primary)] bg-white px-2 py-1 text-[11px] font-semibold text-[var(--color-primary)] hover:opacity-90 sm:px-2.5 sm:py-1.5 sm:text-xs ${extra}`;
}

export function MyEventCard({
  event,
  fromTab,
  showSave,
  onUnsaved,
}: {
  event: MyEventListItem;
  fromTab: MyEventsTab;
  showSave?: boolean;
  onUnsaved?: () => void;
}) {
  const [menu, setMenu] = useState<"calendar" | "invite" | null>(null);
  const [copied, setCopied] = useState(false);
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [inviteSearch, setInviteSearch] = useState("");
  const [inviteMessage, setInviteMessage] = useState("");
  const [selectedFriends, setSelectedFriends] = useState<Set<string>>(new Set());
  const [inviteSubmitting, setInviteSubmitting] = useState(false);

  const cover = eventCoverSrc(event);
  const eventDate = new Date(event.date);
  const month = eventDate.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  const day = eventDate.toLocaleDateString("en-US", { day: "numeric", timeZone: "UTC" });
  const weekday = eventDate.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  const timeStr = event.time
    ? event.endTime
      ? `${formatTime12h(event.time)} – ${formatTime12h(event.endTime)}`
      : formatTime12h(event.time)
    : null;
  const place = [event.location, event.city].filter(Boolean).join(" · ");
  const href = buildEventHref(event.slug, { type: "my-events", tab: fromTab });
  const rsvp = rsvpStatusLabel(event.rsvpStatus);
  const calendarInput: EventCalendarInput = event;

  useEffect(() => {
    if (menu !== "invite" || friends != null) return;
    fetch("/api/me/friends")
      .then((r) => r.json())
      .then((data) => setFriends(Array.isArray(data?.friends) ? data.friends : []))
      .catch(() => setFriends([]));
  }, [menu, friends]);

  const filteredFriends = (friends ?? []).filter((f) => {
    const q = inviteSearch.trim().toLowerCase();
    if (!q) return true;
    return `${f.firstName} ${f.lastName}`.toLowerCase().includes(q);
  });

  async function handleShare() {
    const url = `${window.location.origin}/events/${event.slug}`;
    const text = `${event.title} – ${url}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: event.title, url, text: event.title });
        return;
      } catch {
        /* cancelled */
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      prompt("Copy this link:", text);
    }
  }

  async function submitInvite() {
    if (selectedFriends.size === 0) return;
    setInviteSubmitting(true);
    try {
      const body: { friendIds: string[]; message?: string } = {
        friendIds: Array.from(selectedFriends),
      };
      const note = inviteMessage.trim();
      if (note) body.message = note;
      const res = await fetch(`/api/events/${event.id}/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert((data as { error?: string }).error ?? "Could not send invites.");
        return;
      }
      setMenu(null);
      setSelectedFriends(new Set());
      setInviteMessage("");
      alert(`Invited ${(data as { invited?: number }).invited ?? selectedFriends.size} friend(s).`);
    } finally {
      setInviteSubmitting(false);
    }
  }

  return (
    <article className="flex h-full flex-col overflow-hidden rounded-xl border-2 bg-white" style={{ borderColor: "var(--color-primary)" }}>
      <div className="relative">
        <Link href={href} className="block aspect-square overflow-hidden bg-[#f5f5f5]">
          {cover ? (
            <img src={cover} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full" style={{ backgroundColor: "var(--color-section-alt)" }} />
          )}
        </Link>
        <div className="absolute left-2 bottom-2 w-11 overflow-hidden rounded-md text-center shadow-md sm:w-12">
          <div
            className="px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide sm:text-[10px]"
            style={{ backgroundColor: "#FDEDCC", color: "var(--color-heading)" }}
          >
            {month}
          </div>
          <div className="bg-white py-0.5 text-base font-bold leading-none sm:text-lg" style={{ color: "var(--color-heading)" }}>
            {day}
          </div>
        </div>
        {showSave ? (
          <div className="absolute top-2 right-2 rounded-full bg-white/95 shadow-sm">
            <HeartSaveButton
              type="event"
              referenceId={event.id}
              initialSaved
              onSavedChange={(saved) => {
                if (!saved) onUnsaved?.();
              }}
            />
          </div>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col p-3 sm:p-4">
        <div className="flex flex-wrap items-start gap-2">
          <Link
            href={href}
            className="min-w-0 flex-1 text-sm font-bold leading-snug hover:underline sm:text-base"
            style={{ color: "var(--color-heading)", fontFamily: "var(--font-heading)" }}
          >
            {event.title}
          </Link>
          {rsvp ? (
            <span
              className="shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold text-white"
              style={{ backgroundColor: "var(--color-primary)" }}
            >
              {rsvp}
            </span>
          ) : null}
        </div>
        <span
          className="mt-2 inline-block rounded px-2 py-0.5 text-xs font-medium"
          style={{ backgroundColor: "var(--color-section-alt)", color: "var(--color-primary)" }}
        >
          {event.calendarLabel}
        </span>
        <p className="mt-2 text-xs sm:text-sm" style={{ color: "var(--color-text)" }}>
          {weekday}
          {timeStr ? ` · ${timeStr}` : ""}
        </p>
        {place ? (
          <p className="mt-1 line-clamp-2 text-xs text-gray-600 sm:text-sm">{place}</p>
        ) : null}
        {event.business ? (
          <p className="mt-1 text-xs sm:text-sm">
            <Link
              href={buildBusinessHref(event.business.slug, { type: "event", eventSlug: event.slug })}
              className="font-medium underline"
              style={{ color: "var(--color-primary)" }}
            >
              {event.business.name}
            </Link>
          </p>
        ) : null}

        {event.inviteStats ? (
          <div className="mt-3">
            <EventInviteStatsBlocks stats={event.inviteStats} />
          </div>
        ) : null}

        <div className="mt-auto flex flex-wrap gap-1.5 pt-3">
          <button type="button" onClick={() => void handleShare()} className={actionClass()}>
            <IonIcon name="share-outline" size={16} />
            {copied ? "Copied" : "Share"}
          </button>
          <button
            type="button"
            onClick={() => setMenu((m) => (m === "invite" ? null : "invite"))}
            className={actionClass()}
          >
            <IonIcon name="people-outline" size={16} />
            Invite
          </button>
          <button
            type="button"
            onClick={() => setMenu((m) => (m === "calendar" ? null : "calendar"))}
            className={actionClass()}
          >
            <IonIcon name="calendar-outline" size={16} />
            Calendar
          </button>
        </div>

        {menu === "calendar" ? (
          <div className="mt-3 space-y-2 rounded-lg border p-3" style={{ borderColor: "var(--color-primary)", backgroundColor: "#FFF8E1" }}>
            <button
              type="button"
              className="w-full rounded-lg py-2 text-sm font-semibold text-white"
              style={{ backgroundColor: "var(--color-primary)" }}
              onClick={() => {
                downloadEventIcs(calendarInput, window.location.origin);
                setMenu(null);
              }}
            >
              Download .ics
            </button>
            <button
              type="button"
              className="w-full rounded-lg border-2 py-2 text-sm font-semibold"
              style={{ borderColor: "var(--color-primary)", color: "var(--color-primary)" }}
              onClick={() => {
                window.open(
                  buildGoogleCalendarTemplateUrl(calendarInput, window.location.origin),
                  "_blank",
                  "noopener,noreferrer"
                );
                setMenu(null);
              }}
            >
              Google Calendar
            </button>
          </div>
        ) : null}

        {menu === "invite" ? (
          <div className="mt-3 rounded-lg border p-3" style={{ borderColor: "var(--color-primary)", backgroundColor: "#FFF8E1" }}>
            {friends == null ? (
              <p className="text-sm text-gray-600">Loading friends…</p>
            ) : friends.length === 0 ? (
              <p className="text-sm text-gray-600">No friends to invite yet. Add friends from Community.</p>
            ) : (
              <>
                <textarea
                  className="mb-2 w-full rounded-lg border px-3 py-2 text-sm"
                  placeholder="Add a message (optional)"
                  maxLength={500}
                  value={inviteMessage}
                  onChange={(e) => setInviteMessage(e.target.value)}
                />
                <input
                  type="search"
                  placeholder="Search friends"
                  value={inviteSearch}
                  onChange={(e) => setInviteSearch(e.target.value)}
                  className="mb-2 w-full rounded-lg border px-3 py-2 text-sm"
                />
                <ul className="mb-2 max-h-40 overflow-y-auto">
                  {filteredFriends.map((f) => (
                    <li key={f.id}>
                      <label className="flex cursor-pointer items-center gap-2 py-1.5 text-sm">
                        <input
                          type="checkbox"
                          checked={selectedFriends.has(f.id)}
                          onChange={() => {
                            setSelectedFriends((prev) => {
                              const next = new Set(prev);
                              if (next.has(f.id)) next.delete(f.id);
                              else next.add(f.id);
                              return next;
                            });
                          }}
                          style={{ accentColor: "var(--color-primary)" }}
                        />
                        {f.firstName} {f.lastName}
                      </label>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  disabled={inviteSubmitting || selectedFriends.size === 0}
                  onClick={() => void submitInvite()}
                  className="w-full rounded-lg py-2 text-sm font-semibold text-white disabled:opacity-50"
                  style={{ backgroundColor: "var(--color-primary)" }}
                >
                  {inviteSubmitting ? "Sending…" : `Invite ${selectedFriends.size || ""} friend(s)`.trim()}
                </button>
              </>
            )}
          </div>
        ) : null}
      </div>
    </article>
  );
}
