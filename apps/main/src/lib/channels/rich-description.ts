import DOMPurify from "isomorphic-dompurify";

/**
 * Listing-body HTML subset: keep structure (bold, italics, breaks, lists, headings)
 * and strip font/size/color/style and unsafe tags. Used for StoreItem.description
 * so eBay/Shopify/Wix HTML can round-trip without inheriting marketplace typography.
 */
const LISTING_ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "ul",
  "ol",
  "li",
  "h2",
  "h3",
  "blockquote",
];

/** Sanitize remote or local listing HTML for storage and display. */
export function sanitizeListingDescription(
  description: string | null | undefined
): string | null {
  if (!description?.trim()) return null;

  // Normalize common eBay line-break patterns before purify.
  const normalized = description
    .replace(/\r\n/g, "\n")
    .replace(/<\/?font\b[^>]*>/gi, "")
    .replace(/\s*style\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s*color\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s*face\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s*size\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");

  const clean = DOMPurify.sanitize(normalized, {
    ALLOWED_TAGS: LISTING_ALLOWED_TAGS,
    ALLOWED_ATTR: [],
    KEEP_CONTENT: true,
  }).trim();

  return clean || null;
}

/** Plain text for channels that reject HTML (e.g. some Etsy fields). */
export function listingDescriptionToPlainText(
  description: string | null | undefined
): string | null {
  if (!description?.trim()) return null;
  const text = description
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/h[23]>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  return text || null;
}

/** True when the string looks like it already contains markup we care about. */
export function descriptionLooksLikeHtml(value: string | null | undefined): boolean {
  if (!value) return false;
  return /<\/?[a-z][\s\S]*>/i.test(value);
}

/**
 * Prepare description for outbound HTML-capable channels (eBay, Shopify body_html).
 * Plain text gets paragraph/break conversion so line spacing survives.
 */
export function listingDescriptionForHtmlChannel(
  description: string | null | undefined,
  fallback = ""
): string {
  const raw = (description ?? "").trim() || fallback;
  if (!raw) return fallback;
  if (descriptionLooksLikeHtml(raw)) {
    return sanitizeListingDescription(raw) ?? fallback;
  }
  return raw
    .split(/\n{2,}/)
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
