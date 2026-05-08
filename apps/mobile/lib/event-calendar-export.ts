/**
 * Build device calendar events and Google Calendar template URLs from EventDetail.
 * Date anchor uses YYYY-MM-DD from API (local calendar day); times are 24h HH:mm.
 */

import * as Calendar from "expo-calendar";
import { Linking, Platform } from "react-native";
import type { EventDetail } from "@/lib/events-api";

function parseYmdLocal(isoDate: string): { y: number; mo: number; d: number } | null {
  const part = (isoDate.split("T")[0] ?? "").trim();
  const m = part.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  if (!Number.isFinite(y) || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const test = new Date(y, mo - 1, d);
  if (test.getFullYear() !== y || test.getMonth() !== mo - 1 || test.getDate() !== d) return null;
  return { y, mo, d };
}

function parseHm24(s: string | null | undefined): { h: number; m: number } | null {
  const t = s?.trim();
  if (!t) return null;
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (Number.isNaN(h) || Number.isNaN(min) || h > 23 || min > 59) return null;
  return { h, m: min };
}

/** Default duration when only start time is known (hours). */
const DEFAULT_DURATION_HOURS = 1;

export type ParsedEventSchedule = {
  start: Date;
  end: Date;
  allDay: boolean;
};

/**
 * Local start/end for the listing; all-day uses exclusive next-day end (Calendar/Google convention).
 */
export function parseEventSchedule(ev: EventDetail): ParsedEventSchedule {
  const ymd = parseYmdLocal(ev.date);
  const now = new Date();
  if (!ymd) {
    const end = new Date(now.getTime() + DEFAULT_DURATION_HOURS * 60 * 60 * 1000);
    return { start: now, end, allDay: false };
  }
  const { y, mo, d } = ymd;
  const hm = parseHm24(ev.time);

  if (!hm) {
    const start = new Date(y, mo - 1, d, 0, 0, 0, 0);
    const end = new Date(y, mo - 1, d + 1, 0, 0, 0, 0);
    return { start, end, allDay: true };
  }

  const start = new Date(y, mo - 1, d, hm.h, hm.m, 0, 0);
  let end: Date;
  const hmEnd = parseHm24(ev.endTime);
  if (hmEnd) {
    end = new Date(y, mo - 1, d, hmEnd.h, hmEnd.m, 0, 0);
    if (end.getTime() <= start.getTime()) {
      end = new Date(start.getTime() + DEFAULT_DURATION_HOURS * 60 * 60 * 1000);
    }
  } else {
    end = new Date(start.getTime() + DEFAULT_DURATION_HOURS * 60 * 60 * 1000);
  }
  return { start, end, allDay: false };
}

export function buildPublicEventUrl(ev: EventDetail, siteBase: string): string {
  const base = siteBase.replace(/\/$/, "");
  const slug = ev.slug?.trim() || ev.id;
  return `${base}/events/${encodeURIComponent(slug)}`;
}

export function buildEventLocation(ev: EventDetail): string {
  const loc = ev.location?.trim() ?? "";
  const city = ev.city?.trim() ?? "";
  if (loc && city) {
    if (loc.toLowerCase().includes(city.toLowerCase())) return loc;
    return `${loc}, ${city}`;
  }
  return loc || city;
}

export function buildEventCalendarNotes(ev: EventDetail, siteBase: string): string {
  const parts: string[] = [];
  if (ev.description?.trim()) parts.push(ev.description.trim());
  if (ev.business?.name?.trim()) {
    parts.push(`Host: ${ev.business.name.trim()}`);
  }
  parts.push(`Details: ${buildPublicEventUrl(ev, siteBase)}`);
  return parts.join("\n\n");
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Google timed segment: UTC instant as YYYYMMDDTHHmmss */
function toGoogleUtcCompact(dt: Date): string {
  return `${dt.getUTCFullYear()}${pad2(dt.getUTCMonth() + 1)}${pad2(dt.getUTCDate())}T${pad2(dt.getUTCHours())}${pad2(dt.getUTCMinutes())}${pad2(dt.getUTCSeconds())}`;
}

/** Google all-day segment YYYYMMDD */
function toGoogleAllDayCompact(dt: Date): string {
  return `${dt.getFullYear()}${pad2(dt.getMonth() + 1)}${pad2(dt.getDate())}`;
}

export function buildGoogleCalendarTemplateUrl(ev: EventDetail, siteBase: string): string {
  const { start, end, allDay } = parseEventSchedule(ev);
  const title = ev.title?.trim() || "Event";
  const details = buildEventCalendarNotes(ev, siteBase);
  const location = buildEventLocation(ev);

  let datesParam: string;
  if (allDay) {
    const startDay = toGoogleAllDayCompact(start);
    const endExclusive = toGoogleAllDayCompact(end);
    datesParam = `${startDay}/${endExclusive}`;
  } else {
    datesParam = `${toGoogleUtcCompact(start)}Z/${toGoogleUtcCompact(end)}Z`;
  }

  const qs = [
    "action=TEMPLATE",
    `text=${encodeURIComponent(title)}`,
    `dates=${datesParam}`,
    `details=${encodeURIComponent(details)}`,
    `location=${encodeURIComponent(location)}`,
  ].join("&");
  return `https://www.google.com/calendar/render?${qs}`;
}

export async function openGoogleCalendarAddEvent(ev: EventDetail, siteBase: string): Promise<void> {
  const url = buildGoogleCalendarTemplateUrl(ev, siteBase);
  await Linking.openURL(url);
}

export type AddToDeviceCalendarResult = "ok" | "denied" | "failed";

export async function addEventToDeviceCalendar(
  ev: EventDetail,
  siteBase: string
): Promise<AddToDeviceCalendarResult> {
  try {
    const perm = await Calendar.requestCalendarPermissionsAsync();
    if (perm.status !== "granted") {
      return "denied";
    }

    const defaultCal = await Calendar.getDefaultCalendarAsync();
    const { start, end, allDay } = parseEventSchedule(ev);
    const location = buildEventLocation(ev);
    const notes = buildEventCalendarNotes(ev, siteBase);

    const eventPayload: Parameters<typeof Calendar.createEventAsync>[1] = {
      title: ev.title?.trim() || "Event",
      startDate: start,
      endDate: end,
      allDay,
      notes,
    };

    if (Platform.OS === "ios") {
      eventPayload.timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      eventPayload.availability = Calendar.Availability.BUSY;
    }

    if (location) {
      eventPayload.location = location;
    }

    const url = buildPublicEventUrl(ev, siteBase);
    if (Platform.OS === "ios") {
      eventPayload.url = url;
    }

    await Calendar.createEventAsync(defaultCal.id, eventPayload);
    return "ok";
  } catch {
    return "failed";
  }
}
