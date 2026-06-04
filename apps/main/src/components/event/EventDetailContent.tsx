"use client";

import { useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { IonIcon } from "@/components/IonIcon";
import { EventHeroGallery } from "@/components/event/EventHeroGallery";
import { EventInviteStatsBlocks } from "@/components/event/EventInviteStatsBlocks";
import { useLockBodyScroll } from "@/lib/scroll-lock";
import { formatTime12h } from "@/lib/format-time";
import type { EventInviteStats } from "@/lib/event-invite-stats";
import {
  buildGoogleCalendarTemplateUrl,
  downloadEventIcs,
  type EventCalendarInput,
} from "@/lib/event-calendar-export-web";
import { SiteNavAlignedColumn } from "@/components/SiteNavAlignedColumn";

const EVENT_SECTION_STACK = "flex flex-col gap-2";

export type EventDetailData = {
  id: string;
  slug: string;
  title: string;
  date: string;
  time: string | null;
  endTime: string | null;
  location: string | null;
  city: string | null;
  description: string | null;
  photos: string[];
  business: { name: string; slug: string } | null;
  inviteStats?: EventInviteStats | null;
};

type Friend = { id: string; firstName: string; lastName: string };

function outlineActionClassName(extra = "") {
  return `flex-1 flex items-center justify-center gap-1 py-2 px-1.5 rounded-lg border-2 border-[var(--color-primary)] bg-white text-sm font-semibold text-[var(--color-primary)] hover:opacity-90 transition-opacity ${extra}`;
}

function Sheet({
  open,
  onClose,
  title,
  subtitle,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  useLockBodyScroll(open);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[110] flex items-end justify-center bg-black/50" role="dialog" aria-modal="true">
      <button type="button" className="absolute inset-0" aria-label="Close" onClick={onClose} />
      <div
        className="relative w-full max-w-lg rounded-t-2xl border-2 border-b-0 border-[var(--color-primary)] max-h-[85vh] overflow-y-auto"
        style={{ backgroundColor: "#FFF8E1" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b-2 border-[var(--color-primary)]">
          <h2 className="text-lg font-bold" style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}>
            {title}
          </h2>
          <button type="button" onClick={onClose} className="p-1 hover:opacity-80" aria-label="Close">
            <IonIcon name="close" size={24} className="text-[var(--color-text)]" />
          </button>
        </div>
        {subtitle ? (
          <p className="px-4 pt-3 pb-2 text-sm" style={{ color: "var(--color-text)" }}>
            {subtitle}
          </p>
        ) : null}
        <div className="px-4 pb-5">{children}</div>
      </div>
    </div>
  );
}

export function EventDetailContent({
  event,
  initialSaved,
  backHref = "/calendars",
}: {
  event: EventDetailData;
  initialSaved: boolean;
  backHref?: string;
}) {
  const router = useRouter();
  const { data: session } = useSession();
  const siteBase = typeof window !== "undefined" ? window.location.origin : "";

  const [rsvpOpen, setRsvpOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [rsvpSubmitting, setRsvpSubmitting] = useState(false);
  const [inviteSubmitting, setInviteSubmitting] = useState(false);

  const [friends, setFriends] = useState<Friend[]>([]);
  const [inviteSearch, setInviteSearch] = useState("");
  const [inviteMessage, setInviteMessage] = useState("");
  const [selectedFriends, setSelectedFriends] = useState<Set<string>>(new Set());

  const dateStr = new Date(event.date).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const timeStr = event.time
    ? event.endTime
      ? `${formatTime12h(event.time)} – ${formatTime12h(event.endTime)}`
      : formatTime12h(event.time)
    : "";

  const mapsDestination = event.location?.trim() || event.city?.trim() || "";
  const calendarInput: EventCalendarInput = event;

  const eventUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/events/${event.slug}`
      : `/events/${event.slug}`;

  const filteredFriends = useMemo(() => {
    const q = inviteSearch.trim().toLowerCase();
    if (!q) return friends;
    return friends.filter((f) => {
      const full = `${f.firstName} ${f.lastName}`.toLowerCase();
      return full.includes(q) || f.firstName.toLowerCase().includes(q) || f.lastName.toLowerCase().includes(q);
    });
  }, [friends, inviteSearch]);

  const handleShare = useCallback(async () => {
    const text = `${event.title} – ${eventUrl}`;
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: event.title, url: eventUrl, text: event.title });
        return;
      } catch {
        /* cancelled */
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      alert("Link copied to clipboard.");
    } catch {
      prompt("Copy this link:", text);
    }
  }, [event.title, eventUrl]);

  const submitRsvp = useCallback(
    async (status: "accepted" | "declined" | "maybe") => {
      setRsvpSubmitting(true);
      try {
        const res = await fetch(`/api/events/${event.id}/rsvp`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          alert((data as { error?: string }).error ?? "Could not update RSVP.");
          return;
        }
        setRsvpOpen(false);
        alert("RSVP updated.");
      } finally {
        setRsvpSubmitting(false);
      }
    },
    [event.id]
  );

  const openInvite = useCallback(async () => {
    if (!session?.user) {
      router.push(`/login?callbackUrl=${encodeURIComponent(`/events/${event.slug}`)}`);
      return;
    }
    setInviteOpen(true);
    setInviteSearch("");
    setInviteMessage("");
    setSelectedFriends(new Set());
    try {
      const res = await fetch("/api/me/friends");
      const data = await res.json();
      setFriends(Array.isArray(data?.friends) ? data.friends : []);
    } catch {
      setFriends([]);
    }
  }, [session?.user, router, event.slug]);

  const toggleFriend = (id: string) => {
    setSelectedFriends((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submitInvite = async () => {
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
      const data = await res.json();
      if (!res.ok) {
        alert(data.error ?? "Could not send invites.");
        return;
      }
      setInviteOpen(false);
      alert(`Invited ${data.invited ?? selectedFriends.size} friend(s).`);
    } finally {
      setInviteSubmitting(false);
    }
  };

  const reportEvent = () => {
    const reason = window.prompt(
      "Report this event\n\nEnter: political, nudity, spam, or other"
    );
    if (!reason) return;
    const normalized = reason.trim().toLowerCase();
    const map: Record<string, string> = {
      political: "political",
      nudity: "nudity",
      spam: "spam",
      other: "other",
    };
    const r = map[normalized] ?? "other";
    fetch("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contentType: "event", contentId: event.id, reason: r }),
    })
      .then((res) => {
        if (res.ok) alert("Report submitted. Thank you.");
        else alert("Could not submit report.");
      })
      .catch(() => alert("Could not submit report."));
  };

  const openRsvp = () => {
    if (!session?.user) {
      router.push(`/login?callbackUrl=${encodeURIComponent(`/events/${event.slug}`)}`);
      return;
    }
    setRsvpOpen(true);
  };

  return (
    <div className="bg-white min-h-[50vh]">
      <SiteNavAlignedColumn>
        <div
          className="flex items-center gap-2 py-2 rounded-lg border-b-2 border-black mt-4 md:mt-5"
          style={{ backgroundColor: "var(--color-primary)" }}
        >
          <Link
            href={backHref}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center text-white hover:opacity-90"
            aria-label="Back"
          >
            <IonIcon name="arrow-back" size={22} className="text-white" />
          </Link>
          <span
            className="flex min-w-0 flex-1 items-center justify-center truncate px-1 text-base font-bold leading-snug text-white"
            style={{ fontFamily: "var(--font-heading)" }}
            title={event.title}
          >
            {event.title}
          </span>
          <button
            type="button"
            onClick={reportEvent}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center text-white hover:opacity-90"
            aria-label="Report event"
          >
            <IonIcon name="flag-outline" size={20} className="text-white" />
          </button>
        </div>

        <EventHeroGallery
          photos={event.photos ?? []}
          title={event.title}
          eventId={event.id}
          initialSaved={initialSaved}
          className="rounded-lg overflow-hidden mt-2"
        />

        <div className={`${EVENT_SECTION_STACK} pb-6 pt-2`}>
          <h1
            className="text-center text-3xl font-bold pt-2 mb-1"
            style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}
          >
            {event.title}
          </h1>

          {event.business ? (
            <p className="text-center text-sm -mt-0.5 mb-1.5" style={{ color: "var(--color-text)" }}>
              by{" "}
              <Link
                href={`/support-local/${event.business.slug}`}
                className="font-semibold underline"
                style={{ color: "var(--color-primary)" }}
              >
                {event.business.name}
              </Link>
            </p>
          ) : null}

          <div className="flex gap-2.5 py-2">
            <div className="flex-1 p-2 rounded-lg border-2 border-[var(--color-primary)] bg-white text-center">
              <p className="text-sm font-semibold mb-0.5" style={{ color: "var(--color-primary)" }}>
                Date
              </p>
              <p className="text-sm leading-snug" style={{ color: "var(--color-text)" }}>
                {dateStr}
              </p>
            </div>
            <div className="flex-1 p-2 rounded-lg border-2 border-[var(--color-primary)] bg-white text-center">
              <p className="text-sm font-semibold mb-0.5" style={{ color: "var(--color-primary)" }}>
                Time
              </p>
              <p className="text-sm leading-snug" style={{ color: "var(--color-text)" }}>
                {timeStr || "—"}
              </p>
            </div>
          </div>

          <div className="h-0.5 bg-[var(--color-primary)] my-1.5" />

          <div className="flex gap-2 py-1">
            <button type="button" onClick={handleShare} className={outlineActionClassName()}>
              <IonIcon name="share-outline" size={18} />
              Share
            </button>
            {session?.user ? (
              <button type="button" onClick={openInvite} className={outlineActionClassName()}>
                <IonIcon name="people-outline" size={18} />
                Invite
              </button>
            ) : null}
            <button type="button" onClick={openRsvp} className={outlineActionClassName()}>
              <IonIcon name="ticket-outline" size={18} />
              RSVP
            </button>
          </div>

          <button
            type="button"
            onClick={() => setCalendarOpen(true)}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border-2 border-black text-white font-semibold hover:opacity-90"
            style={{ backgroundColor: "var(--color-primary)" }}
          >
            <IonIcon name="calendar-outline" size={18} className="text-white" />
            Add to Calendar
          </button>

          {event.inviteStats ? (
            <div className="mt-3 rounded-lg border-2 border-[var(--color-primary)] bg-white p-3 text-center">
              <p
                className="mb-2 text-xs font-bold uppercase tracking-wide"
                style={{ color: "var(--color-primary)" }}
              >
                Your invite activity
              </p>
              <EventInviteStatsBlocks stats={event.inviteStats} />
            </div>
          ) : null}

          <div className="h-0.5 bg-[var(--color-primary)] mt-2.5" />

          {event.description ? (
            <div className="pt-2">
              <p className="text-sm font-semibold mb-1" style={{ color: "var(--color-primary)" }}>
                Description
              </p>
              <p className="text-[15px] leading-snug whitespace-pre-wrap" style={{ color: "var(--color-text)" }}>
                {event.description}
              </p>
            </div>
          ) : null}

          {event.city ? (
            <div className="pt-2">
              <p className="text-sm font-semibold mb-1" style={{ color: "var(--color-primary)" }}>
                City
              </p>
              <p className="text-[15px] leading-snug" style={{ color: "var(--color-text)" }}>
                {event.city}
              </p>
            </div>
          ) : null}

          {event.location ? (
            <div className="pt-2">
              <p className="text-sm font-semibold mb-1" style={{ color: "var(--color-primary)" }}>
                Address
              </p>
              <p className="text-[15px] leading-snug" style={{ color: "var(--color-text)" }}>
                {event.location}
              </p>
            </div>
          ) : null}

          {mapsDestination ? (
            <>
              <div className="h-0.5 bg-[var(--color-primary)] mt-2.5 mb-2" />
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsDestination)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border-2 border-black text-white font-semibold hover:opacity-90"
                style={{ backgroundColor: "var(--color-primary)" }}
              >
                <IonIcon name="map" size={18} className="text-white" />
                Open in Maps
              </a>
            </>
          ) : null}
        </div>
      </SiteNavAlignedColumn>

      <Sheet open={rsvpOpen} onClose={() => !rsvpSubmitting && setRsvpOpen(false)} title="RSVP" subtitle="How would you like to respond?">
        {rsvpSubmitting ? (
          <p className="py-5 text-center text-gray-600">Updating…</p>
        ) : (
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => submitRsvp("accepted")}
              className="w-full py-2.5 rounded-lg border-2 font-bold text-white"
              style={{ backgroundColor: "var(--color-primary)", borderColor: "var(--color-secondary)" }}
            >
              Going
            </button>
            <button
              type="button"
              onClick={() => submitRsvp("maybe")}
              className="w-full py-2.5 rounded-lg border-2 border-[var(--color-primary)] font-bold text-[var(--color-primary)]"
              style={{ backgroundColor: "#FFF8E1" }}
            >
              Maybe
            </button>
            <button
              type="button"
              onClick={() => submitRsvp("declined")}
              className="w-full py-2.5 rounded-lg border-2 font-semibold"
              style={{ backgroundColor: "#FFF8E1", borderColor: "var(--color-secondary)", color: "var(--color-secondary)" }}
            >
              Can&apos;t make it
            </button>
          </div>
        )}
      </Sheet>

      <Sheet
        open={calendarOpen}
        onClose={() => setCalendarOpen(false)}
        title="Add to Calendar"
        subtitle="Save date, time, location, and details to your calendar or Google Calendar."
      >
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => {
              downloadEventIcs(calendarInput, siteBase);
              setCalendarOpen(false);
            }}
            className="w-full py-2.5 rounded-lg border-2 font-bold text-white"
            style={{ backgroundColor: "var(--color-primary)", borderColor: "var(--color-secondary)" }}
          >
            Download .ics (My Calendar)
          </button>
          <button
            type="button"
            onClick={() => {
              window.open(buildGoogleCalendarTemplateUrl(calendarInput, siteBase), "_blank", "noopener,noreferrer");
              setCalendarOpen(false);
            }}
            className="w-full py-2.5 rounded-lg border-2 border-[var(--color-primary)] font-bold text-[var(--color-primary)]"
            style={{ backgroundColor: "#FFF8E1" }}
          >
            Open in Google Calendar
          </button>
        </div>
      </Sheet>

      <Sheet open={inviteOpen} onClose={() => !inviteSubmitting && setInviteOpen(false)} title="Invite">
        {friends.length === 0 ? (
          <p className="py-5 text-center text-gray-600">
            No friends to invite. Add friends from Community.
          </p>
        ) : (
          <>
            <div className="mb-4 flex flex-col items-center gap-1.5">
              <label className="text-sm font-semibold text-gray-700 w-[88%] max-w-[340px]">
                Add a Message with Invite
              </label>
              <textarea
                className="w-[88%] max-w-[340px] min-h-[3.5rem] max-h-24 border rounded-lg px-3 py-2 text-sm resize-y"
                placeholder="Say hi or why they might like this event…"
                maxLength={500}
                value={inviteMessage}
                onChange={(e) => setInviteMessage(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2 mb-2.5 px-1 py-2 border-2 border-[var(--color-primary)] rounded-lg bg-white">
              <IonIcon name="search-outline" size={18} className="text-[var(--color-primary)] shrink-0" />
              <input
                type="search"
                placeholder="Search friends"
                value={inviteSearch}
                onChange={(e) => setInviteSearch(e.target.value)}
                className="flex-1 text-sm outline-none bg-transparent"
                style={{ color: "var(--color-text)" }}
              />
            </div>
            <ul className="max-h-56 overflow-y-auto mb-3 divide-y divide-gray-100">
              {filteredFriends.length === 0 ? (
                <li className="py-3 text-center text-gray-500 text-sm">No matches</li>
              ) : (
                filteredFriends.map((f) => (
                  <li key={f.id}>
                    <label className="flex items-center gap-2.5 py-2.5 px-2 cursor-pointer hover:bg-white/60">
                      <input
                        type="checkbox"
                        checked={selectedFriends.has(f.id)}
                        onChange={() => toggleFriend(f.id)}
                        className="rounded"
                        style={{ accentColor: "var(--color-primary)" }}
                      />
                      <span className="font-semibold text-sm text-[var(--color-heading)]">
                        {f.firstName} {f.lastName}
                      </span>
                    </label>
                  </li>
                ))
              )}
            </ul>
            <button
              type="button"
              onClick={submitInvite}
              disabled={inviteSubmitting || selectedFriends.size === 0}
              className="w-full py-2.5 rounded-lg font-semibold text-white disabled:opacity-50"
              style={{ backgroundColor: "var(--color-primary)" }}
            >
              {inviteSubmitting ? "Sending…" : `Invite ${selectedFriends.size || ""} friend(s)`.trim()}
            </button>
          </>
        )}
      </Sheet>
    </div>
  );
}
