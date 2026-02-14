import DOMPurify from "isomorphic-dompurify";

/**
 * Sanitize HTML to prevent XSS. Use before dangerouslySetInnerHTML.
 * Allows common formatting tags for blog/content (p, strong, em, a, br, ul, ol, li, etc.)
 */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      "p", "br", "strong", "b", "em", "i", "u", "s", "a", "ul", "ol", "li",
      "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "code", "span", "div",
    ],
    ALLOWED_ATTR: ["href", "target", "rel"],
  });
}
