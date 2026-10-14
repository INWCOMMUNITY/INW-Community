import { describe, expect, it } from "vitest";
import { listingDescriptionPlainText } from "./listing-description-plain";

describe("listingDescriptionPlainText", () => {
  it("drops a Shopify paragraph wrapper", () => {
    expect(listingDescriptionPlainText("<p>Hello</p>")).toBe("Hello");
    expect(listingDescriptionPlainText("<p>Hello</p>\n\n")).toBe("Hello");
  });

  it("keeps paragraph breaks and line breaks", () => {
    expect(listingDescriptionPlainText("<p>One</p><p>Two</p>")).toBe("One\nTwo");
    expect(listingDescriptionPlainText("Line one<br>Line two")).toBe("Line one\nLine two");
  });

  it("leaves plain text unchanged", () => {
    expect(listingDescriptionPlainText("price < 5")).toBe("price < 5");
    expect(listingDescriptionPlainText("  Hello  ")).toBe("Hello");
  });
});
