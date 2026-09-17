import { describe, expect, it } from "vitest";
import { sanitizeListingDescription } from "./listing-rich-html";

describe("sanitizeListingDescription", () => {
  it("keeps bold, italics, breaks, and lists", () => {
    const html =
      "<p><b>Bold</b> and <i>italic</i></p><br><ul><li>One</li><li>Two</li></ul>";
    const out = sanitizeListingDescription(html);
    expect(out).toContain("<b>Bold</b>");
    expect(out).toContain("<i>italic</i>");
    expect(out).toContain("<br>");
    expect(out).toContain("<li>One</li>");
  });

  it("strips font, style, color, and scripts", () => {
    const html =
      '<font color="red" size="5" face="Arial">Hi</font>' +
      '<p style="color:blue;font-size:20px">Para</p>' +
      '<script>alert(1)</script><strong>Safe</strong>';
    const out = sanitizeListingDescription(html);
    expect(out).not.toMatch(/font|style|color|script/i);
    expect(out).toContain("<strong>Safe</strong>");
    expect(out).toContain("Hi");
    expect(out).toContain("Para");
  });

  it("does not let script tags survive", () => {
    const out = sanitizeListingDescription('<p>Hi</p><script>alert("xss")</script>');
    expect(out).not.toMatch(/script/i);
    expect(out).not.toContain("alert");
    expect(out).toContain("Hi");
  });

  it("does not let inline event handlers such as onclick survive", () => {
    const out = sanitizeListingDescription('<p onclick="alert(1)">Click</p>');
    expect(out).not.toMatch(/onclick/i);
    expect(out).not.toContain("alert");
    expect(out).toContain("Click");
  });

  it("does not let javascript: links survive", () => {
    const out = sanitizeListingDescription('<a href="javascript:alert(1)">Go</a><p>Safe</p>');
    expect(out).not.toMatch(/javascript:/i);
    expect(out).not.toMatch(/<a\b/i);
    expect(out).toContain("Go");
    expect(out).toContain("Safe");
  });

  it("keeps legitimate storefront listing markup", () => {
    const html =
      "<p><strong>Handmade mug</strong></p><ul><li>Dishwasher safe</li><li>12 oz</li></ul>";
    const out = sanitizeListingDescription(html);
    expect(out).toContain("<strong>Handmade mug</strong>");
    expect(out).toContain("<li>Dishwasher safe</li>");
    expect(out).toContain("<li>12 oz</li>");
  });

  it("returns null for empty input", () => {
    expect(sanitizeListingDescription("")).toBeNull();
    expect(sanitizeListingDescription("   ")).toBeNull();
    expect(sanitizeListingDescription(null)).toBeNull();
  });

  it("uses br for plain text without wrapping in p", () => {
    const out = sanitizeListingDescription("Line one\nLine two");
    expect(out).toBe("Line one<br>Line two");
    expect(out).not.toMatch(/^<p>/);
  });

  it("decodes numeric decimal HTML entities like &#39;", () => {
    const out = sanitizeListingDescription("It&#39;s a nice day");
    expect(out).toBe("It's a nice day");
  });

  it("decodes numeric hex HTML entities like &#x27;", () => {
    const out = sanitizeListingDescription("Don&#x27;t worry");
    expect(out).toBe("Don't worry");
  });

  it("decodes named HTML entities like &apos;", () => {
    const out = sanitizeListingDescription("Bob&apos;s store");
    expect(out).toBe("Bob's store");
  });

  it("decodes curly quote entities", () => {
    const out = sanitizeListingDescription("&ldquo;Hello&rdquo; said &lsquo;Bob&rsquo;");
    expect(out).toBe("\u201cHello\u201d said \u2018Bob\u2019");
  });

  it("decodes dash entities", () => {
    const out = sanitizeListingDescription("A&ndash;B&mdash;C");
    expect(out).toBe("A–B—C");
  });

  it("decodes smart apostrophe &#8217;", () => {
    const out = sanitizeListingDescription("Grandma&#8217;s recipe");
    expect(out).toBe("Grandma\u2019s recipe");
  });
});
