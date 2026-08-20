import { describe, expect, it } from "vitest";
import { etsyListingStateMeansGone } from "./listing-exists";

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
