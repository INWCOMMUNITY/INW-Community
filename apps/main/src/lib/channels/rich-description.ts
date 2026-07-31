/**
 * Listing-body HTML subset: keep structure (bold, italics, breaks, lists, headings)
 * and strip font/size/color/style and unsafe tags. Used for StoreItem.description
 * so eBay/Shopify/Wix HTML can round-trip without inheriting marketplace typography.
 * 
 * NOTE: We use a simple regex-based sanitizer instead of DOMPurify to avoid ESM
 * module conflicts in Vercel's serverless environment (html-encoding-sniffer issue).
 */
const LISTING_ALLOWED_TAGS = new Set([
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
]);

/**
 * Simple HTML sanitizer that keeps only allowed tags.
 * Strips all attributes and disallowed tags while preserving their text content.
 */
function sanitizeHtml(html: string): string {
  // First, decode common HTML entities
  let result = html
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"');

  // Remove script, style, and other dangerous tags entirely (including content)
  result = result.replace(/<(script|style|iframe|object|embed|form|input|button)[^>]*>[\s\S]*?<\/\1>/gi, "");
  result = result.replace(/<(script|style|iframe|object|embed|form|input|button)[^>]*\/?>/gi, "");

  // Process all HTML tags
  result = result.replace(/<\/?([a-z][a-z0-9]*)\b[^>]*\/?>/gi, (match, tagName) => {
    const tag = tagName.toLowerCase();
    if (LISTING_ALLOWED_TAGS.has(tag)) {
      // Keep allowed tags but strip all attributes
      if (match.startsWith("</")) {
        return `</${tag}>`;
      }
      // Self-closing tags like <br>
      if (tag === "br") {
        return "<br>";
      }
      return `<${tag}>`;
    }
    // Remove disallowed tags but keep the text between them
    return "";
  });

  // Clean up excessive whitespace
  result = result
    .replace(/\s+/g, " ")
    .replace(/>\s+</g, "><")
    .replace(/\s+>/g, ">")
    .replace(/<\s+/g, "<")
    .trim();

  return result;
}

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

  const clean = sanitizeHtml(normalized).trim();

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
