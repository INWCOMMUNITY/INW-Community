import { describe, expect, it } from "vitest";
import { etsyListingIsNotActive, etsyListingStateMeansGone } from "./listing-exists";

describe("etsyListingStateMeansGone", () => {
  it("treats removed/expired/sold_out as gone", () => {
    expect(etsyListingStateMeansGone("removed")).toBe(true);
    expect(etsyListingStateMeansGone("expired")).toBe(true);
    expect(etsyListingStateMeansGone("sold_out")).toBe(true);
  });

  it("keeps active, draft, and inactive listings", () => {
    expect(etsyListingStateMeansGone("active")).toBe(false);
    expect(etsyListingStateMeansGone("draft")).toBe(false);
    expect(etsyListingStateMeansGone("inactive")).toBe(false);
    expect(etsyListingStateMeansGone(null)).toBe(false);
  });
});

describe("etsyListingIsNotActive", () => {
  it("treats inactive, draft, and ended states as off the shop", () => {
    expect(etsyListingIsNotActive("inactive")).toBe(true);
    expect(etsyListingIsNotActive("draft")).toBe(true);
    expect(etsyListingIsNotActive("expired")).toBe(true);
    expect(etsyListingIsNotActive("sold_out")).toBe(true);
    expect(etsyListingIsNotActive("removed")).toBe(true);
  });

  it("treats active as still live", () => {
    expect(etsyListingIsNotActive("active")).toBe(false);
    expect(etsyListingIsNotActive(null)).toBe(false);
  });
});
