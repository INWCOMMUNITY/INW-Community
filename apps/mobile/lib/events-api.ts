/**
 * Events API - fetches from NWC backend. Public read, auth required for POST.
 * Uses EXPO_PUBLIC_API_URL. In-memory cache for session persistence.
 */

import { API_BASE, getToken } from "./api";

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

export type EventInviteStats = {
  sent: number;
  attending: number;
  maybe: number;
  declined: number;
};

export interface EventItem {
  id: string;
  slug: string;
  title: string;
  date: string;
  time: string | null;
  endTime: string | null;
  location: string | null;
  city: string | null;
  business: { name: string; slug: string; memberId?: string } | null;
  /** Present when the signed-in user owns this event (profile or business). */
  inviteStats?: EventInviteStats;
}

export interface EventDetail extends EventItem {
  description: string | null;
  photos: string[];
  memberId?: string | null;
  businessId?: string | null;
  inviteStats?: EventInviteStats;
}

const memoryCache = new Map<
  string,
  { events: EventItem[]; fetchedAt: number }
>();

function cacheKey(
  calendarType: string,
  from: string,
  to: string,
  city: string,
  /** Separate cache when signed in so invite stats are not served from public cache. */
  authed: boolean
): string {
  return `nwc_events_${authed ? "1" : "0"}_${calendarType}_${from}_${to}_${city}`;
}

export async function getCachedEvents(
  calendarType: string,
  from: Date,
  to: Date,
  city?: string,
  authed?: boolean
): Promise<EventItem[] | null> {
  return getCachedEventsSync(calendarType, from, to, city, authed);
}

/** Synchronous cache read for instant UI on revisits (no async delay). */
export function getCachedEventsSync(
  calendarType: string,
  from: Date,
  to: Date,
  city?: string,
  authed?: boolean
): EventItem[] | null {
  const key = cacheKey(
    calendarType,
    from.toISOString(),
    to.toISOString(),
    city ?? "all",
    Boolean(authed)
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
  city?: string,
  authed?: boolean
): Promise<void> {
  const key = cacheKey(
    calendarType,
    from.toISOString(),
    to.toISOString(),
    city ?? "all",
    Boolean(authed)
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
  const headers: Record<string, string> = { Accept: "application/json" };
  let authed = false;
  try {
    const token = await getToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
      authed = true;
    }
  } catch {
    /* getToken may fail on some platforms */
  }
  try {
    const res = await fetch(url, { signal: controller.signal, headers });
    if (!res.ok) throw new Error(`Server error: ${res.status}`);
    const ct = res.headers.get("content-type");
    if (!ct?.includes("application/json"))
      throw new Error("Server returned non-JSON response");
    const data = await res.json();
    const events = Array.isArray(data) ? data : [];
    await setCachedEvents(calendarType, from, to, events, city, authed);
    return events;
  } catch (e) {
    throw e instanceof Error ? e : new Error("Failed to load events");
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchEventBySlug(slug: string): Promise<EventDetail | null> {
  const url = `${API_BASE}/api/events?slug=${encodeURIComponent(slug)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  const headers: Record<string, string> = { Accept: "application/json" };
  try {
    const token = await getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch {
    /* ignore */
  }
  try {
    const res = await fetch(url, { signal: controller.signal, headers });
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
