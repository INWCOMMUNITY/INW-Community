import { describe, expect, it } from "vitest";
import {
  isWixNotFoundStatus,
  wixDecideGone,
  wixListingExistenceFromFetch,
} from "./listing-exists";

describe("wixListingExistenceFromFetch", () => {
  it("treats 404 as gone", () => {
    expect(wixListingExistenceFromFetch({ status: 404, product: null })).toBe("gone");
  });

  it("does not treat auth or server errors as deletes", () => {
    expect(wixListingExistenceFromFetch({ status: 401, product: null })).toBe("unknown");
    expect(wixListingExistenceFromFetch({ status: 500, product: null })).toBe("unknown");
  });

  it("treats a missing or hidden product as gone", () => {
    expect(wixListingExistenceFromFetch({ status: null, product: null })).toBe("gone");
    expect(wixListingExistenceFromFetch({ status: null, product: { id: "p1", visible: false } })).toBe(
      "gone"
    );
  });

  it("treats a visible product as still listed", () => {
    expect(wixListingExistenceFromFetch({ status: null, product: { id: "p1", visible: true } })).toBe(
      "exists"
    );
  });

  it("treats Wix not-found error copy as gone", () => {
    expect(isWixNotFoundStatus(400, "Product not found")).toBe(true);
    expect(
      wixListingExistenceFromFetch({ status: 400, product: null, message: "PRODUCT_NOT_FOUND" })
    ).toBe("gone");
  });
});

describe("wixDecideGone", () => {
  it("flags GET 404 even if query still lists the product", () => {
    expect(wixDecideGone({ query: "exists", get: "gone" })).toBe(true);
  });

  it("flags a catalog miss even if GET still returns the deleted product", () => {
    expect(wixDecideGone({ query: "gone", get: "unknown" })).toBe(true);
    expect(wixDecideGone({ query: "gone", get: "exists" })).toBe(true);
  });

  it("does not flag when both checks are inconclusive", () => {
    expect(wixDecideGone({ query: "unknown", get: "unknown" })).toBe(false);
    expect(wixDecideGone({ query: "exists", get: "exists" })).toBe(false);
  });
});
