import { describe, expect, it } from "vitest";
import { ebayContentPushShouldWriteVariantQuantities } from "./variant-qty-catchup";
import { variantsStructureQtyFingerprint } from "../variant-sync";

const variants = {
  axes: [{ name: "Size", values: ["S"] }],
  skus: [{ options: { Size: "S" }, quantity: 4, sku: "SKU-S" }],
};

describe("ebayContentPushShouldWriteVariantQuantities", () => {
  it("writes qty on create and when INW qty drifted from baseline", () => {
    expect(
      ebayContentPushShouldWriteVariantQuantities({
        operation: "create",
        baselineQty: 4,
        baselineVariantsHash: "x",
        listingQty: 4,
        variants,
      })
    ).toBe(true);
    expect(
      ebayContentPushShouldWriteVariantQuantities({
        operation: "update",
        baselineQty: 40,
        baselineVariantsHash: variantsStructureQtyFingerprint(variants),
        listingQty: 40,
        variants,
      })
    ).toBe(false);
    expect(
      ebayContentPushShouldWriteVariantQuantities({
        operation: "update",
        baselineQty: 40,
        baselineVariantsHash: variantsStructureQtyFingerprint(variants),
        listingQty: 12,
        variants,
      })
    ).toBe(true);
  });

  it("does not write qty on a linked content update with missing baselines", () => {
    expect(
      ebayContentPushShouldWriteVariantQuantities({
        operation: "update",
        baselineQty: null,
        baselineVariantsHash: null,
        listingQty: 4,
        variants,
      })
    ).toBe(false);
  });
});
