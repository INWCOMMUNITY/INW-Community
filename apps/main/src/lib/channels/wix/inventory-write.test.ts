import { describe, expect, it } from "vitest";
import { buildWixV1InventoryOnlyBody } from "./mapping";
import { MAX_SANE_INVENTORY_QTY, isCorruptBaselineQty, isSaneInventoryQty } from "../inventory-sanity";

describe("Wix inventory write guards", () => {
  it("refuses aggregate stock on multiple v1 variant rows", () => {
    const body = buildWixV1InventoryOnlyBody(5, {
      id: "p1",
      variants: [
        { id: "v1", stock: { quantity: 1 } },
        { id: "v2", stock: { quantity: 2 } },
      ],
    });
    expect(body).toBeNull();
  });

  it("allows single-variant v1 inventory patch", () => {
    const body = buildWixV1InventoryOnlyBody(3, {
      id: "p1",
      variants: [{ id: "v1", stock: { quantity: 1 } }],
    });
    expect(body).not.toBeNull();
    const variants = (body as { product: { variants: { id: string }[] } }).product.variants;
    expect(variants).toHaveLength(1);
  });

  it("treats poisoned baseline values as corrupt", () => {
    expect(isCorruptBaselineQty(878_906_250)).toBe(true);
    expect(isCorruptBaselineQty(15)).toBe(false);
    expect(isSaneInventoryQty(MAX_SANE_INVENTORY_QTY)).toBe(true);
    expect(isSaneInventoryQty(MAX_SANE_INVENTORY_QTY + 1)).toBe(false);
  });
});
