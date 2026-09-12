import { describe, expect, it } from "vitest";
import {
  cartLinesAreSameItem,
  cartLinesAreSameSku,
  cartVariantFingerprint,
  findCartRowForCheckoutLine,
  findMatchingCartLine,
  maxQuantityForCartLine,
  quantityOnSameSku,
} from "./cart-line-identity";

describe("cartVariantFingerprint", () => {
  it("treats key order and casing as the same SKU", () => {
    expect(cartVariantFingerprint({ Size: "Large", Color: "Blue" })).toBe(
      cartVariantFingerprint({ color: "blue", size: "Large" })
    );
  });

  it("distinguishes different options", () => {
    expect(cartVariantFingerprint({ Size: "Large", Color: "Blue" })).not.toBe(
      cartVariantFingerprint({ Size: "Medium", Color: "Blue" })
    );
  });

  it("treats empty / missing variant the same", () => {
    expect(cartVariantFingerprint(null)).toBe("");
    expect(cartVariantFingerprint({})).toBe("");
  });
});

describe("cart line matching", () => {
  it("merges only the exact same listing, options, and fulfillment", () => {
    const largeShip = {
      storeItemId: "shirt",
      variant: { Size: "Large", Color: "Blue" },
      fulfillmentType: "ship" as const,
    };
    expect(
      cartLinesAreSameItem(largeShip, {
        storeItemId: "shirt",
        variant: { Color: "Blue", Size: "Large" },
        fulfillmentType: "ship",
      })
    ).toBe(true);
    expect(
      cartLinesAreSameItem(largeShip, {
        storeItemId: "shirt",
        variant: { Size: "Medium", Color: "Blue" },
        fulfillmentType: "ship",
      })
    ).toBe(false);
    expect(
      cartLinesAreSameItem(largeShip, {
        storeItemId: "shirt",
        variant: { Size: "Large", Color: "Blue" },
        fulfillmentType: "pickup",
      })
    ).toBe(false);
  });

  it("shares stock across fulfillment for the same options", () => {
    expect(
      cartLinesAreSameSku(
        { storeItemId: "shirt", variant: { Size: "Large" } },
        { storeItemId: "shirt", variant: { Size: "Large" } }
      )
    ).toBe(true);
  });

  it("finds an existing row to increment", () => {
    const rows = [
      { id: "a", storeItemId: "shirt", variant: { Size: "Large" }, fulfillmentType: "ship", quantity: 1 },
      { id: "b", storeItemId: "shirt", variant: { Size: "Medium" }, fulfillmentType: "ship", quantity: 1 },
    ];
    expect(
      findMatchingCartLine(rows, {
        storeItemId: "shirt",
        variant: { Size: "Medium" },
        fulfillmentType: "ship",
      })?.id
    ).toBe("b");
  });
});

describe("quantity caps", () => {
  it("counts other lines of the same SKU against remaining stock", () => {
    const lines = [
      { id: "ship", storeItemId: "shirt", variant: { Size: "L" }, quantity: 2 },
      { id: "pickup", storeItemId: "shirt", variant: { Size: "L" }, quantity: 1 },
      { id: "m", storeItemId: "shirt", variant: { Size: "M" }, quantity: 4 },
    ];
    expect(quantityOnSameSku(lines, { storeItemId: "shirt", variant: { Size: "L" } })).toBe(3);
    expect(maxQuantityForCartLine(5, lines, { id: "ship", storeItemId: "shirt", variant: { Size: "L" } })).toBe(4);
    expect(maxQuantityForCartLine(5, lines, { id: "m", storeItemId: "shirt", variant: { Size: "M" } })).toBe(5);
  });
});

describe("findCartRowForCheckoutLine", () => {
  it("matches by variant and fulfillment, not listing id alone", () => {
    const rows = [
      { storeItemId: "shirt", variant: { Size: "Large" }, fulfillmentType: "ship", resaleOfferId: null },
      { storeItemId: "shirt", variant: { Size: "Medium" }, fulfillmentType: "ship", resaleOfferId: "offer1" },
    ];
    expect(
      findCartRowForCheckoutLine(rows, {
        storeItemId: "shirt",
        variant: { Size: "Medium" },
        fulfillmentType: "ship",
      })?.resaleOfferId
    ).toBe("offer1");
  });
});
