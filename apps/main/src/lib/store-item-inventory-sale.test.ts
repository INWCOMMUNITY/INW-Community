import { beforeEach, describe, expect, it, vi } from "vitest";
import { InsufficientStockError } from "@/lib/store-item-inventory-errors";

const mockPrisma = vi.hoisted(() => ({
  storeItem: {
    updateMany: vi.fn(),
    findUnique: vi.fn(),
  },
}));

vi.mock("database", () => ({ prisma: mockPrisma }));

describe("applyStoreItemDecrementAfterSale qty floor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refuses to decrement when quantity < sold (no negative stock)", async () => {
    const { applyStoreItemDecrementAfterSale } = await import("./store-item-inventory-sale");
    mockPrisma.storeItem.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.storeItem.findUnique.mockResolvedValue({
      quantity: 0,
      updatedAt: new Date(),
    });
    await expect(
      applyStoreItemDecrementAfterSale(mockPrisma as never, {
        id: "item-1",
        variants: null,
        quantity: 1,
        updatedAt: new Date(),
      }, { quantity: 1, variant: null })
    ).rejects.toBeInstanceOf(InsufficientStockError);
    expect(mockPrisma.storeItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ quantity: { gte: 1 } }),
      })
    );
  });
});
