import { describe, expect, it, vi } from "vitest";
import { applyStoreItemDecrementAfterSale } from "./store-item-inventory-sale";

describe("applyStoreItemDecrementAfterSale", () => {
  it("does not decrement made-to-order listings", async () => {
    const updateMany = vi.fn();
    await applyStoreItemDecrementAfterSale(
      { storeItem: { updateMany, findUnique: vi.fn() } } as never,
      {
        id: "item-1",
        variants: {
          axes: [{ name: "Size", values: ["M"] }],
          skus: [{ options: { Size: "M" }, quantity: 4 }],
        },
        quantity: 999,
        updatedAt: new Date(),
        inventoryTracking: "made_to_order",
      },
      { quantity: 1, variant: { Size: "M" } }
    );
    expect(updateMany).not.toHaveBeenCalled();
  });
});
