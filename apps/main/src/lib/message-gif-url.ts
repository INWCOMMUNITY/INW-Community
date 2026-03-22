const LIST_PREVIEW_MAX = 80;

/** Hostnames allowed for standalone GIF <img src> (Giphy CDN). */
function isAllowedGifHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === "giphy.com" || h.endsWith(".giphy.com") || h === "media.tenor.com" || h.endsWith(".tenor.com");
}

/**
 * If the entire message body is a single allowlisted https image URL (e.g. Giphy),
 * return it for rendering as <img>. Otherwise null.
 */
export function getStandaloneGifImageUrl(content: string): string | null {
  let s = content.trim();
  if (!s) return null;
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  if (!s || /\s/.test(s)) return null;
  if (!/^https:\/\//i.test(s)) return null;
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (!isAllowedGifHost(url.hostname)) return null;
  const path = url.pathname.toLowerCase();
  const looksLikeGifAsset =
    path.endsWith(".gif") || path.includes("/media/") || path.includes("/gifs/");
  if (!looksLikeGifAsset) return null;
  return url.href;
}

/** Short line for conversation list subtitles. */
export function messageListPreview(content: string): string {
  if (getStandaloneGifImageUrl(content)) return "GIF";
  const t = content.trim();
  if (!t) return "";
  if (t.length <= LIST_PREVIEW_MAX) return t;
  return `${t.slice(0, LIST_PREVIEW_MAX)}…`;
}
