import { describe, expect, it } from "vitest";
import { isShopifyConcurrentModification } from "./client";

describe("isShopifyConcurrentModification", () => {
  it("matches Shopify's 422 product-lock copy", () => {
    expect(
      isShopifyConcurrentModification(
        422,
        "This product is currently being modified. Please try again later."
      )
    ).toBe(true);
  });

  it("does not treat other 422s as a lock", () => {
    expect(isShopifyConcurrentModification(422, "Title can't be blank")).toBe(false);
    expect(
      isShopifyConcurrentModification(429, "This product is currently being modified.")
    ).toBe(false);
  });
});
