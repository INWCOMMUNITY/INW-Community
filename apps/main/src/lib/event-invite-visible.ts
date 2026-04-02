/**
 * Whether an event should be hidden from invite lists (sidebar, app invites, popups).
 * Uses UTC calendar dates; for "today", uses endTime / time range end / start + 3h / end of UTC day.
 */
export function eventInviteEventHasPassed(event: {
  date: Date;
  time: string | null;
  endTime: string | null;
}): boolean {
  const now = Date.now();
  const y = event.date.getUTCFullYear();
  const mo = event.date.getUTCMonth();
  const d = event.date.getUTCDate();
  const eventDayStart = Date.UTC(y, mo, d);
  const t = new Date();
  const startOfToday = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());

  if (eventDayStart < startOfToday) return true;
  if (eventDayStart > startOfToday) return false;

  const endMs = resolveApproximateEventEndUtcMs(y, mo, d, event.time, event.endTime);
  return now > endMs;
}

function resolveApproximateEventEndUtcMs(
  y: number,
  mo: number,
  d: number,
  time: string | null,
  endTime: string | null
): number {
  const fromEndTime = parseHmOnDayUtc(y, mo, d, endTime);
  if (fromEndTime != null) return fromEndTime;

  const timeTrim = time?.trim() ?? "";
  if (timeTrim) {
    const rangeParts = timeTrim.split(/\s*[-–—]\s*/);
    if (rangeParts.length >= 2) {
      const endPart = rangeParts[rangeParts.length - 1]?.trim() ?? "";
      const fromRangeEnd = parseHmOnDayUtc(y, mo, d, endPart);
      if (fromRangeEnd != null) return fromRangeEnd;
    } else {
      const fromStart = parseHmOnDayUtc(y, mo, d, timeTrim);
      if (fromStart != null) return fromStart + 3 * 60 * 60 * 1000;
    }
  }

  return Date.UTC(y, mo, d, 23, 59, 59, 999);
}

function parseHmOnDayUtc(
  y: number,
  mo: number,
  d: number,
  s: string | null | undefined
): number | null {
  if (!s || typeof s !== "string") return null;
  const trimmed = s.trim();
  if (!trimmed) return null;

  const ampm = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)\s*$/i);
  if (ampm) {
    let h = parseInt(ampm[1], 10);
    const min = parseInt(ampm[2], 10);
    const ap = ampm[3].toUpperCase();
    if (ap === "PM" && h !== 12) h += 12;
    if (ap === "AM" && h === 12) h = 0;
    if (h < 0 || h > 23 || min > 59 || Number.isNaN(h) || Number.isNaN(min)) return null;
    return Date.UTC(y, mo, d, h, min, 0, 0);
  }

  const m24 = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (m24) {
    const h = parseInt(m24[1], 10);
    const min = parseInt(m24[2], 10);
    if (h < 0 || h > 23 || min > 59 || Number.isNaN(h) || Number.isNaN(min)) return null;
    return Date.UTC(y, mo, d, h, min, 0, 0);
  }

  return null;
}
