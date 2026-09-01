import { describe, expect, it } from "vitest";
import { wixListingExistenceFromFetch } from "./listing-exists";

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
});
