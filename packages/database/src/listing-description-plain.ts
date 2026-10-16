/**
 * Listing descriptions are plain text in INW. Channel HTML such as Shopify's
 * `<p>` wrapper must not be stored or sent as visible characters.
 */
export function listingDescriptionPlainText(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  let text = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  text = decodeListingHtmlEntities(text);
  if (!/<\/?[a-z][^>]*>/i.test(text)) return text.trim();

  text = text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "");
  text = decodeListingHtmlEntities(text);
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeListingHtmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code) => {
      const n = Number.parseInt(code, 10);
      return n > 0 && n < 0x10ffff ? String.fromCodePoint(n) : "";
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      const n = Number.parseInt(hex, 16);
      return n > 0 && n < 0x10ffff ? String.fromCodePoint(n) : "";
    })
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'");
}
