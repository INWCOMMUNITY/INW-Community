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
  "h4",
  "blockquote",
]);

/**
 * Simple HTML sanitizer that keeps only allowed tags.
 * Strips all attributes and disallowed tags while preserving their text content.
 * Converts block-level elements (div, span with display:block) to paragraphs.
 * Preserves line breaks by converting newlines to <br> before processing.
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

  // Convert block-level elements (div, section, article, header, footer) to paragraphs
  // This preserves the paragraph structure from eBay/Wix descriptions
  result = result.replace(/<div[^>]*>/gi, "<p>");
  result = result.replace(/<\/div>/gi, "</p>");
  result = result.replace(/<section[^>]*>/gi, "<p>");
  result = result.replace(/<\/section>/gi, "</p>");
  result = result.replace(/<article[^>]*>/gi, "<p>");
  result = result.replace(/<\/article>/gi, "</p>");
  result = result.replace(/<header[^>]*>/gi, "<p>");
  result = result.replace(/<\/header>/gi, "</p>");
  result = result.replace(/<footer[^>]*>/gi, "<p>");
  result = result.replace(/<\/footer>/gi, "</p>");
  
  // Convert h1 and h4+ to h3 (keeping h2/h3)
  result = result.replace(/<h1[^>]*>/gi, "<h2>");
  result = result.replace(/<\/h1>/gi, "</h2>");
  result = result.replace(/<h[5-6][^>]*>/gi, "<h4>");
  result = result.replace(/<\/h[5-6]>/gi, "</h4>");

  // Convert newlines to <br> tags BEFORE processing to preserve line breaks
  // But only newlines that are not already adjacent to block elements
  result = result.replace(/([^>])\n([^<])/g, "$1<br>$2");
  result = result.replace(/([^>])\n(<[a-z])/gi, "$1<br>$2");

  // Process all HTML tags - strip attributes from allowed tags, remove disallowed tags
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
    // Remove disallowed tags (like span, font) but keep the text between them
    return "";
  });

  // Clean up excessive whitespace, but preserve meaningful structure
  // First normalize whitespace around tags
  result = result
    .replace(/\s*<br>\s*/gi, "<br>")  // Clean up around <br> tags
    .replace(/<p>\s+/gi, "<p>")       // Clean start of paragraphs
    .replace(/\s+<\/p>/gi, "</p>")    // Clean end of paragraphs
    .replace(/<p><\/p>/gi, "")        // Remove empty paragraphs
    .replace(/<p><br><\/p>/gi, "")    // Remove paragraphs with only a break
    .replace(/(<br>){3,}/gi, "<br><br>") // Max 2 consecutive breaks
    .replace(/(<\/p>\s*<p>)+/gi, "</p><p>") // Clean up paragraph boundaries
    .replace(/^\s+|\s+$/g, "")        // Trim leading/trailing whitespace
    .replace(/\s{2,}/g, " ")          // Collapse multiple spaces to single space
    .trim();

  return result;
}

/** Sanitize remote or local listing HTML for storage and display. */
export function sanitizeListingDescription(
  description: string | null | undefined
): string | null {
  if (!description?.trim()) return null;

  // Normalize common eBay/marketplace line-break and formatting patterns before sanitization.
  let normalized = description
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  
  // Strip font tags but preserve any line breaks they might contain
  normalized = normalized.replace(/<\/?font\b[^>]*>/gi, "");
  
  // Remove style/color/face/size attributes (these will be stripped by sanitizeHtml anyway)
  normalized = normalized
    .replace(/\s*style\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s*color\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s*face\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s*size\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s*align\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s*class\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s*id\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  
  // Convert common eBay patterns: multiple <br> used as paragraph separators
  // Two or more breaks in a row should become paragraph breaks
  normalized = normalized.replace(/(<br\s*\/?>\s*){2,}/gi, "</p><p>");
  
  // Wrap content in paragraphs if not already wrapped
  // This helps preserve structure for descriptions that are just text with <br> tags
  if (!/<p[^>]*>/i.test(normalized) && !/<div[^>]*>/i.test(normalized)) {
    // No paragraphs or divs - wrap the whole content
    normalized = `<p>${normalized}</p>`;
  }

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
