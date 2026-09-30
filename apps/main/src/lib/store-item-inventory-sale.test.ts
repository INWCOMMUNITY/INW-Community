import { describe, expect, it, vi, beforeEach } from "vitest";

const {
  assertLegacyDrainFinalizerAllowed,
  CommerceFoundationCutoverBlockedError,
} = vi.hoisted(() => {
  class CommerceFoundationCutoverBlockedError extends Error {
    code = "inventory_cutover_frozen";
    retryable = true as const;
    httpStatus = 503 as const;
    constructor() {
      super("blocked");
      this.name = "CommerceFoundationCutoverBlockedError";
    }
  }
  return {
    assertLegacyDrainFinalizerAllowed: vi.fn(async () => {}),
    CommerceFoundationCutoverBlockedError,
  };
});

vi.mock("database", () => ({
  assertLegacyDrainFinalizerAllowed,
  CommerceFoundationCutoverBlockedError,
}));

import { applyStoreItemDecrementAfterSale } from "./store-item-inventory-sale";

describe("applyStoreItemDecrementAfterSale", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertLegacyDrainFinalizerAllowed.mockResolvedValue(undefined);
  });

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
      { quantity: 1, variant: { Size: "M" } },
      { startedAt: new Date("2026-01-01T00:00:00.000Z") }
    );
    expect(updateMany).not.toHaveBeenCalled();
    expect(assertLegacyDrainFinalizerAllowed).not.toHaveBeenCalled();
  });

  it("LEGACY drain still decrements when the cutover assert allows", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    await applyStoreItemDecrementAfterSale(
      { storeItem: { updateMany, findUnique: vi.fn() } } as never,
      {
        id: "item-1",
        variants: null,
        quantity: 4,
        updatedAt: new Date("2026-01-02T00:00:00.000Z"),
        inventoryTracking: "tracked",
      },
      { quantity: 1, variant: null },
      { startedAt }
    );
    expect(assertLegacyDrainFinalizerAllowed).toHaveBeenCalledWith(expect.anything(), startedAt);
    expect(updateMany).toHaveBeenCalled();
  });

  it("FROZEN drain with blocked assert does not mutate quantity", async () => {
    assertLegacyDrainFinalizerAllowed.mockRejectedValue(new CommerceFoundationCutoverBlockedError());
    const updateMany = vi.fn();
    await expect(
      applyStoreItemDecrementAfterSale(
        { storeItem: { updateMany, findUnique: vi.fn() } } as never,
        {
          id: "item-1",
          variants: null,
          quantity: 4,
          updatedAt: new Date(),
          inventoryTracking: "tracked",
        },
        { quantity: 1, variant: null },
        { startedAt: new Date("2026-09-18T20:00:00.000Z") }
      )
    ).rejects.toMatchObject({ code: "inventory_cutover_frozen", retryable: true });
    expect(updateMany).not.toHaveBeenCalled();
  });
});
