/**
 * Server-side Open Graph metadata fetcher.
 * Parses og:title, og:description, og:image from a remote URL's HTML.
 */

export interface OGPreview {
  title?: string;
  description?: string;
  image?: string;
}

const OG_TAG_REGEX =
  /<meta\s+(?:[^>]*?\s)?property\s*=\s*["']og:(title|description|image)["'][^>]*?\s+content\s*=\s*["']([^"']*)["'][^>]*?>|<meta\s+(?:[^>]*?\s)?content\s*=\s*["']([^"']*)["'][^>]*?\s+property\s*=\s*["']og:(title|description|image)["'][^>]*?>/gi;

export async function fetchOGPreview(url: string): Promise<OGPreview | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "INWCommunity-Bot/1.0",
        Accept: "text/html",
      },
      redirect: "follow",
    });
    clearTimeout(timeout);

    if (!res.ok) return null;

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) return null;

    const html = await res.text();
    const result: OGPreview = {};
    let match: RegExpExecArray | null;

    while ((match = OG_TAG_REGEX.exec(html)) !== null) {
      const prop = (match[1] || match[4])?.toLowerCase();
      const value = match[2] || match[3];
      if (!prop || !value) continue;
      if (prop === "title" && !result.title) result.title = value;
      if (prop === "description" && !result.description) result.description = value;
      if (prop === "image" && !result.image) result.image = value;
    }

    if (!result.title && !result.description && !result.image) return null;
    return result;
  } catch {
    return null;
  }
}
