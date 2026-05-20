/**
 * Web calendar helpers (Google Calendar URL + .ics download).
 * Schedule logic aligned with the mobile app event-calendar-export module.
 */

export type EventCalendarInput = {
  title: string;
  slug: string;
  id: string;
  date: string;
  time: string | null;
  endTime: string | null;
  location: string | null;
  city: string | null;
  description: string | null;
  business?: { name: string } | null;
};

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

const DEFAULT_DURATION_HOURS = 1;

export type ParsedEventSchedule = {
  start: Date;
  end: Date;
  allDay: boolean;
};

export function parseEventSchedule(ev: EventCalendarInput): ParsedEventSchedule {
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

export function buildPublicEventUrl(ev: EventCalendarInput, siteBase: string): string {
  const base = siteBase.replace(/\/$/, "");
  const slug = ev.slug?.trim() || ev.id;
  return `${base}/events/${encodeURIComponent(slug)}`;
}

export function buildEventLocation(ev: EventCalendarInput): string {
  const loc = ev.location?.trim() ?? "";
  const city = ev.city?.trim() ?? "";
  if (loc && city) {
    if (loc.toLowerCase().includes(city.toLowerCase())) return loc;
    return `${loc}, ${city}`;
  }
  return loc || city;
}

export function buildEventCalendarNotes(ev: EventCalendarInput, siteBase: string): string {
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

function toGoogleUtcCompact(dt: Date): string {
  return `${dt.getUTCFullYear()}${pad2(dt.getUTCMonth() + 1)}${pad2(dt.getUTCDate())}T${pad2(dt.getUTCHours())}${pad2(dt.getUTCMinutes())}${pad2(dt.getUTCSeconds())}`;
}

function toGoogleAllDayCompact(dt: Date): string {
  return `${dt.getFullYear()}${pad2(dt.getMonth() + 1)}${pad2(dt.getDate())}`;
}

export function buildGoogleCalendarTemplateUrl(ev: EventCalendarInput, siteBase: string): string {
  const { start, end, allDay } = parseEventSchedule(ev);
  const title = ev.title?.trim() || "Event";
  const details = buildEventCalendarNotes(ev, siteBase);
  const location = buildEventLocation(ev);

  let datesParam: string;
  if (allDay) {
    datesParam = `${toGoogleAllDayCompact(start)}/${toGoogleAllDayCompact(end)}`;
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

function formatIcsUtc(dt: Date): string {
  return `${dt.getUTCFullYear()}${pad2(dt.getUTCMonth() + 1)}${pad2(dt.getUTCDate())}T${pad2(dt.getUTCHours())}${pad2(dt.getUTCMinutes())}${pad2(dt.getUTCSeconds())}Z`;
}

function formatIcsAllDay(dt: Date): string {
  return `${dt.getFullYear()}${pad2(dt.getMonth() + 1)}${pad2(dt.getDate())}`;
}

/** Trigger download of a .ics file for the event. */
export function downloadEventIcs(ev: EventCalendarInput, siteBase: string): void {
  const { start, end, allDay } = parseEventSchedule(ev);
  const uid = `${ev.id}@inwcommunity.com`;
  const title = (ev.title?.trim() || "Event").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,");
  const desc = buildEventCalendarNotes(ev, siteBase)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/\n/g, "\\n");
  const loc = buildEventLocation(ev).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,");

  const dtStart = allDay
    ? `DTSTART;VALUE=DATE:${formatIcsAllDay(start)}`
    : `DTSTART:${formatIcsUtc(start)}`;
  const dtEnd = allDay
    ? `DTEND;VALUE=DATE:${formatIcsAllDay(end)}`
    : `DTEND:${formatIcsUtc(end)}`;

  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Northwest Community//Event//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    dtStart,
    dtEnd,
    `SUMMARY:${title}`,
    `DESCRIPTION:${desc}`,
    loc ? `LOCATION:${loc}` : "",
    `URL:${buildPublicEventUrl(ev, siteBase)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .filter(Boolean)
    .join("\r\n");

  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${ev.slug || ev.id}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
