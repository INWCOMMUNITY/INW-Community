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
 * Decode HTML entities (numeric, hex, and common named entities).
 * Handles marketplace descriptions that encode apostrophes, quotes, dashes, etc.
 */
function decodeHtmlEntities(html: string): string {
  // Decode numeric decimal entities: &#39; &#8217; etc.
  let result = html.replace(/&#(\d+);/g, (_, code) => {
    const n = parseInt(code, 10);
    return n > 0 && n < 0x10ffff ? String.fromCodePoint(n) : "";
  });

  // Decode numeric hex entities: &#x27; &#x2019; etc.
  result = result.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
    const n = parseInt(hex, 16);
    return n > 0 && n < 0x10ffff ? String.fromCodePoint(n) : "";
  });

  // Decode common named entities used in marketplace descriptions
  const namedEntities: Record<string, string> = {
    nbsp: " ",
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    // Curly quotes and apostrophes (using unicode codepoints for clarity)
    lsquo: "\u2018", // '
    rsquo: "\u2019", // '
    ldquo: "\u201c", // "
    rdquo: "\u201d", // "
    sbquo: "\u201a", // ‚
    bdquo: "\u201e", // „
    // Dashes
    ndash: "–",
    mdash: "—",
    minus: "−",
    // Other common entities
    hellip: "…",
    bull: "•",
    middot: "·",
    copy: "©",
    reg: "®",
    trade: "™",
    deg: "°",
    plusmn: "±",
    frac12: "½",
    frac14: "¼",
    frac34: "¾",
    times: "×",
    divide: "÷",
    cent: "¢",
    pound: "£",
    euro: "€",
    yen: "¥",
  };

  result = result.replace(/&([a-zA-Z]+);/g, (match, name) => {
    const lower = name.toLowerCase();
    return namedEntities[lower] ?? match;
  });

  return result;
}

/**
 * Simple HTML sanitizer that keeps only allowed tags.
 * Strips all attributes and disallowed tags while preserving their text content.
 * Converts block-level elements (div, span with display:block) to paragraphs.
 * Preserves line breaks by converting newlines to <br> before processing.
 */
function sanitizeHtml(html: string): string {
  // Decode HTML entities first (handles &#39;, &apos;, &#8217;, etc.)
  let result = decodeHtmlEntities(html);

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

  // Decode HTML entities first (handles &#39;, &apos;, &#8217;, etc.)
  let normalized = decodeHtmlEntities(description);

  // Normalize common eBay/marketplace line-break and formatting patterns before sanitization.
  normalized = normalized
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
  
  // Plain text: use <br> for line breaks; avoid wrapping the whole description in <p>.
  if (!descriptionLooksLikeHtml(normalized)) {
    const lines = normalized
      .split("\n")
      .map((line) => line.trim())
      .filter((line, i, arr) => line.length > 0 || (i > 0 && i < arr.length - 1));
    if (lines.length === 0) return null;
    return lines.join("<br>");
  }

  // HTML: normalize multi-break paragraphs, then sanitize (no forced outer <p> wrap).
  normalized = normalized.replace(/(<br\s*\/?>\s*){2,}/gi, "</p><p>");

  let clean = sanitizeHtml(normalized).trim();
  clean = unwrapSingleOuterParagraph(clean);

  return clean || null;
}

/** Remove one redundant outer <p>...</p> when inner content has no nested paragraphs. */
function unwrapSingleOuterParagraph(html: string): string {
  const t = html.trim();
  const m = t.match(/^<p>([\s\S]*)<\/p>$/i);
  if (!m) return t;
  const inner = m[1].trim();
  if (/<\/?p>/i.test(inner)) return t;
  return inner;
}

/** Plain text snippet for storefront cards and search previews (never show raw HTML tags). */
export function listingDescriptionPreview(
  description: string | null | undefined
): string | null {
  return listingDescriptionToPlainText(description);
}

/** Plain text for the seller edit textarea (no visible HTML tags). */
export function listingDescriptionForEditForm(description: string | null | undefined): string {
  return listingDescriptionToPlainText(description) ?? "";
}

/** Convert seller edit textarea value back to storable listing HTML. */
export function listingDescriptionFromEditForm(plainText: string): string | null {
  const trimmed = plainText.trim();
  if (!trimmed) return null;
  return sanitizeListingDescription(listingDescriptionForHtmlChannel(trimmed));
}

/** Plain text for channels that reject HTML (e.g. some Etsy fields). */
export function listingDescriptionToPlainText(
  description: string | null | undefined
): string | null {
  if (!description?.trim()) return null;
  // Decode HTML entities first (handles &#39;, &apos;, &#8217;, etc.)
  const decoded = decodeHtmlEntities(description);
  const text = decoded
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
