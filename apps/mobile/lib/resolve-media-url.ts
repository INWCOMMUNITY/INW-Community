import { API_BASE } from "./api";

/**
 * Public origin for uploaded media (listing photos, profile photos, etc.).
 * Uses the same base URL logic as `api.ts` so dev/prod hosts match API requests.
 */
export function getMediaOrigin(): string {
  let base = API_BASE.replace(/\/+$/, "");
  if (/\/api$/i.test(base)) {
    base = base.replace(/\/api$/i, "");
  }
  return base.replace(/\/+$/, "") || "https://www.inwcommunity.com";
}

/** Turn a stored path or absolute URL into a fetchable URI for React Native `Image`. */
export function resolveMediaUrl(path: string | undefined | null): string | undefined {
  if (path == null) return undefined;
  const raw = String(path).trim();
  if (!raw) return undefined;
  if (raw.startsWith("//")) return `https:${raw}`;
  if (/^https?:\/\//i.test(raw)) return raw;
  const origin = getMediaOrigin();
  return `${origin}${raw.startsWith("/") ? "" : "/"}${raw}`;
}

/** First usable listing image from `StoreItem.photos`. */
export function firstStorePhotoUrl(photos: unknown): string | undefined {
  if (!Array.isArray(photos)) return undefined;
  for (const p of photos) {
    const u = resolveMediaUrl(typeof p === "string" ? p : p != null ? String(p) : "");
    if (u) return u;
  }
  return undefined;
}
