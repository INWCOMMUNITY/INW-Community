import { describe, expect, it } from "vitest";
import {
  listingDescriptionForHtmlChannel,
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
});

describe("listingDescriptionToPlainText", () => {
  it("preserves line breaks from br/p", () => {
    const out = listingDescriptionToPlainText("<p>A</p><br><p>B</p>");
    expect(out).toContain("A");
    expect(out).toContain("B");
    expect(out?.includes("\n")).toBe(true);
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
