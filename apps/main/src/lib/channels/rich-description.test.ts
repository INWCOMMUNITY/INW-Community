import { describe, expect, it } from "vitest";
import {
  listingDescriptionForHtmlChannel,
  listingDescriptionPreview,
  listingDescriptionToPlainText,
  sanitizeListingDescription,
} from "./rich-description";

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
    // &#8217; is the right single quotation mark (curly apostrophe)
    expect(out).toBe("Grandma\u2019s recipe");
  });
});

describe("listingDescriptionPreview", () => {
  it("strips HTML tags for card previews", () => {
    const out = listingDescriptionPreview("<p>Up for sale-</p><p>1937 NGC Medal</p>");
    expect(out).toBe("Up for sale-\n1937 NGC Medal");
    expect(out).not.toContain("<p>");
  });
});

describe("listingDescriptionToPlainText", () => {
  it("preserves line breaks from br/p", () => {
    const out = listingDescriptionToPlainText("<p>A</p><br><p>B</p>");
    expect(out).toContain("A");
    expect(out).toContain("B");
    expect(out?.includes("\n")).toBe(true);
  });

  it("decodes HTML entities in plain text output", () => {
    const out = listingDescriptionToPlainText("Bob&#39;s &amp; Jane&apos;s store");
    expect(out).toBe("Bob's & Jane's store");
  });

  it("decodes curly quotes in plain text output", () => {
    const out = listingDescriptionToPlainText("&ldquo;Quote&rdquo;");
    expect(out).toBe("\u201cQuote\u201d");
  });
});

describe("listingDescriptionForHtmlChannel", () => {
  it("wraps plain text paragraphs", () => {
    const out = listingDescriptionForHtmlChannel("Line one\n\nLine two");
    expect(out).toContain("<p>");
    expect(out).toContain("Line one");
    expect(out).toContain("Line two");
  });
});
