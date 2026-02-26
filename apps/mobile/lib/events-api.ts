/**
 * Events API - fetches from NWC backend. Public read, auth required for POST.
 * Uses EXPO_PUBLIC_API_URL. In-memory cache for session persistence.
 */

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

export interface EventItem {
  id: string;
  slug: string;
  title: string;
  date: string;
  time: string | null;
  endTime: string | null;
  location: string | null;
  city: string | null;
  business: { name: string; slug: string } | null;
}

export interface EventDetail extends EventItem {
  description: string | null;
  photos: string[];
}

const memoryCache = new Map<
  string,
  { events: EventItem[]; fetchedAt: number }
>();

function cacheKey(
  calendarType: string,
  from: string,
  to: string,
  city: string
): string {
  return `nwc_events_${calendarType}_${from}_${to}_${city}`;
}

export async function getCachedEvents(
  calendarType: string,
  from: Date,
  to: Date,
  city?: string
): Promise<EventItem[] | null> {
  return getCachedEventsSync(calendarType, from, to, city);
}

/** Synchronous cache read for instant UI on revisits (no async delay). */
export function getCachedEventsSync(
  calendarType: string,
  from: Date,
  to: Date,
  city?: string
): EventItem[] | null {
  const key = cacheKey(
    calendarType,
    from.toISOString(),
    to.toISOString(),
    city ?? "all"
  );
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
    memoryCache.delete(key);
    return null;
  }
  return entry.events;
}

export async function setCachedEvents(
  calendarType: string,
  from: Date,
  to: Date,
  events: EventItem[],
  city?: string
): Promise<void> {
  const key = cacheKey(
    calendarType,
    from.toISOString(),
    to.toISOString(),
    city ?? "all"
  );
  memoryCache.set(key, { events, fetchedAt: Date.now() });
}

export async function fetchEvents(
  calendarType: string,
  from: Date,
  to: Date,
  city?: string
): Promise<EventItem[]> {
  const params = new URLSearchParams({
    calendarType,
    from: from.toISOString(),
    to: to.toISOString(),
  });
  if (city && city !== "All cities") params.set("city", city);
  const url = `${API_BASE}/api/events?${params}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`Server error: ${res.status}`);
    const ct = res.headers.get("content-type");
    if (!ct?.includes("application/json"))
      throw new Error("Server returned non-JSON response");
    const data = await res.json();
    const events = Array.isArray(data) ? data : [];
    await setCachedEvents(calendarType, from, to, events, city);
    return events;
  } catch {
    clearTimeout(timeout);
    return [];
  }
}

export async function fetchEventBySlug(slug: string): Promise<EventDetail | null> {
  const url = `${API_BASE}/api/events?slug=${encodeURIComponent(slug)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const ct = res.headers.get("content-type");
    if (!ct?.includes("application/json")) return null;
    const data = await res.json();
    return data as EventDetail;
  } catch {
    clearTimeout(timeout);
    return null;
  }
}
