import { CALENDAR_TYPES } from "types";
import { eventInviteEventHasPassed } from "@/lib/event-invite-visible";
import { getCalendarImagePath } from "@/lib/wix-media";
import type { EventInviteStats } from "@/lib/event-invite-stats";

export type MyEventsTab = "saved" | "going" | "posted" | "ended";

export type MyEventListItem = {
  id: string;
  title: string;
  slug: string;
  date: string;
  time: string | null;
  endTime: string | null;
  location: string | null;
  city: string | null;
  description: string | null;
  photos: string[];
  calendarType: string;
  calendarLabel: string;
  business: { name: string; slug: string } | null;
  rsvpStatus?: string;
  inviteStats?: EventInviteStats;
};

type EventRow = {
  id: string;
  title: string;
  slug: string;
  date: Date;
  time: string | null;
  endTime: string | null;
  location: string | null;
  city: string | null;
  description: string | null;
  photos: string[];
  calendarType: string;
  business: { name: string; slug: string } | null;
};

export function toMyEventListItem(
  event: EventRow,
  extra?: Pick<MyEventListItem, "rsvpStatus" | "inviteStats">
): MyEventListItem {
  return {
    id: event.id,
    title: event.title,
    slug: event.slug,
    date: event.date.toISOString(),
    time: event.time,
    endTime: event.endTime,
    location: event.location,
    city: event.city,
    description: event.description,
    photos: event.photos ?? [],
    calendarType: event.calendarType,
    calendarLabel: CALENDAR_TYPES.find((c) => c.value === event.calendarType)?.label ?? event.calendarType,
    business: event.business,
    ...extra,
  };
}

export function eventCoverSrc(event: Pick<MyEventListItem, "photos" | "calendarType">): string {
  const photo = event.photos.find(Boolean);
  if (photo) return photo;
  return getCalendarImagePath(event.calendarType) ?? "";
}

export function splitEventsByUpcoming(events: MyEventListItem[]): {
  upcoming: MyEventListItem[];
  past: MyEventListItem[];
} {
  const upcoming: MyEventListItem[] = [];
  const past: MyEventListItem[] = [];
  for (const event of events) {
    if (eventInviteEventHasPassed({ date: new Date(event.date), time: event.time, endTime: event.endTime })) {
      past.push(event);
    } else {
      upcoming.push(event);
    }
  }
  upcoming.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  past.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return { upcoming, past };
}

export function rsvpStatusLabel(status: string | undefined): string | null {
  if (status === "accepted") return "Going";
  if (status === "maybe") return "Maybe";
  if (status === "declined") return "Can't make it";
  return null;
}

export function partitionMyEvents(
  saved: MyEventListItem[],
  going: MyEventListItem[],
  posted: MyEventListItem[]
): Record<MyEventsTab, MyEventListItem[]> {
  const savedSplit = splitEventsByUpcoming(saved);
  const goingSplit = splitEventsByUpcoming(going);
  const postedSplit = splitEventsByUpcoming(posted);
  const endedById = new Map<string, MyEventListItem>();

  function mergeEnded(event: MyEventListItem) {
    const prev = endedById.get(event.id);
    if (!prev) {
      endedById.set(event.id, event);
      return;
    }
    endedById.set(event.id, {
      ...prev,
      ...event,
      rsvpStatus: event.rsvpStatus ?? prev.rsvpStatus,
      inviteStats: event.inviteStats ?? prev.inviteStats,
    });
  }

  for (const event of savedSplit.past) mergeEnded(event);
  for (const event of goingSplit.past) mergeEnded(event);
  for (const event of postedSplit.past) mergeEnded(event);

  const ended = Array.from(endedById.values()).sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  return {
    saved: savedSplit.upcoming,
    going: goingSplit.upcoming,
    posted: postedSplit.upcoming,
    ended,
  };
}
