/**
 * Tracks where the user came from when viewing an event, enabling adaptive back navigation.
 * Share URLs, sitemaps, and Open Graph stay canonical (no `from=`).
 */

import { CALENDAR_TYPES } from "types";

export type EventReferrerType =
  | "calendars"
  | "local-events"
  | "my-events"
  | "feed"
  | "invites"
  | "my-business-events";

export type EventReferrerTab = "saved" | "going" | "posted" | "ended";

export type EventReferrer = {
  type: EventReferrerType;
  calendarType?: string;
  tab?: EventReferrerTab;
};

type ParamSource = { get(name: string): string | null } | null | undefined;

function paramGet(params: ParamSource, key: string): string | null {
  if (!params) return null;
  const v = params.get(key);
  return v && v.length > 0 ? v : null;
}

function parseTab(value: string | null): EventReferrerTab | undefined {
  if (value === "saved" || value === "going" || value === "posted" || value === "ended") return value;
  return undefined;
}

function parseCalendarType(value: string | null): string | undefined {
  if (!value) return undefined;
  return CALENDAR_TYPES.some((c) => c.value === value) ? value : undefined;
}

export function getEventReferrer(searchParams: ParamSource): EventReferrer {
  const from = paramGet(searchParams, "from");
  if (from === "my-events") {
    return { type: "my-events", tab: parseTab(paramGet(searchParams, "tab")) };
  }
  if (from === "feed") return { type: "feed" };
  if (from === "invites") return { type: "invites" };
  if (from === "my-business-events") return { type: "my-business-events" };
  if (from === "local-events") {
    return { type: "local-events", calendarType: parseCalendarType(paramGet(searchParams, "calendarType")) };
  }
  if (from === "calendars") return { type: "calendars" };
  return { type: "calendars" };
}

export function referrerToSearchParams(ref: EventReferrer): URLSearchParams {
  const params = new URLSearchParams();
  if (ref.type === "calendars") return params;
  params.set("from", ref.type);
  if (ref.calendarType) params.set("calendarType", ref.calendarType);
  if (ref.tab && ref.tab !== "saved") params.set("tab", ref.tab);
  return params;
}

export function buildEventHref(slug: string, ref: EventReferrer): string {
  const q = referrerToSearchParams(ref).toString();
  return q ? `/events/${slug}?${q}` : `/events/${slug}`;
}

export function buildEventBackLink(ref: EventReferrer): { href: string; label: string } {
  switch (ref.type) {
    case "my-events": {
      const href =
        ref.tab && ref.tab !== "saved"
          ? `/my-community/events?tab=${ref.tab}`
          : "/my-community/events";
      return { href, label: "Back to My Events" };
    }
    case "feed":
      return { href: "/my-community/feed", label: "Back to Feed" };
    case "invites":
      return { href: "/my-community/feed", label: "Back to Feed" };
    case "my-business-events":
      return { href: "/business-hub/my-business-events", label: "Back to My Business Events" };
    case "local-events": {
      if (ref.calendarType) {
        const label = CALENDAR_TYPES.find((c) => c.value === ref.calendarType)?.label ?? "Local Events";
        return { href: `/my-community/local-events/${ref.calendarType}`, label: `Back to ${label}` };
      }
      return { href: "/my-community/local-events", label: "Back to Local Events" };
    }
    default:
      return { href: "/calendars", label: "Back to Calendars" };
  }
}
