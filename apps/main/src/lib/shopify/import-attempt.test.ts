import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginShopifyListingImportAttempt,
  failShopifyListingImportAttempt,
} from "database";

describe("ShopifyListingImportAttempt durability", () => {
  const executeRaw = vi.fn();
  const findUnique = vi.fn();
  const findFirst = vi.fn();
  const create = vi.fn();
  const update = vi.fn();
  const updateMany = vi.fn();

  const tx = {
    $executeRaw: executeRaw,
    shopifyListingImportAttempt: { findUnique, create, update, updateMany },
    shopifyListingLink: { findFirst },
  };

  const db = {
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    shopifyListingImportAttempt: { findUnique, updateMany },
  } as never;

  beforeEach(() => {
    executeRaw.mockReset();
    findUnique.mockReset();
    findFirst.mockReset();
    create.mockReset();
    update.mockReset();
    updateMany.mockReset();
    vi.mocked(db.$transaction).mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
  });

  it("preserves bootstrapStartedAt when mapping already exists (no new cutoff)", async () => {
    const originalCutoff = new Date("2026-09-28T11:00:00.000Z");
    findUnique.mockResolvedValue({
      id: "attempt-1",
      status: "FAILED",
      bootstrapStartedAt: originalCutoff,
      storeItemId: null,
      listingLinkId: null,
    });
    findFirst.mockResolvedValue({
      id: "link-1",
      storeItemId: "item-1",
      importBootstrapStartedAt: originalCutoff,
      variantMaps: [
        {
          shopifyVariantId: "gid://shopify/ProductVariant/4",
          shopifyInventoryItemId: "gid://shopify/InventoryItem/4",
        },
      ],
    });
    update.mockResolvedValue({
      id: "attempt-1",
      status: "COMPLETED",
      bootstrapStartedAt: originalCutoff,
      storeItemId: "item-1",
      listingLinkId: "link-1",
      shopifyVariantId: "gid://shopify/ProductVariant/4",
    });

    const result = await beginShopifyListingImportAttempt(db, {
      memberId: "member-a",
      connectionId: "conn-1",
      shopifyProductId: "gid://shopify/Product/300",
      stockMode: "PHYSICAL",
      now: new Date("2026-09-28T13:00:00.000Z"),
    });

    expect(result.status).toBe("ALREADY_COMPLETED");
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "COMPLETED",
          bootstrapStartedAt: originalCutoff,
        }),
      })
    );
  });

  it("failShopifyListingImportAttempt never downgrades COMPLETED", async () => {
    updateMany.mockResolvedValue({ count: 0 });
    findUnique.mockResolvedValue({ id: "attempt-1", status: "COMPLETED" });
    const result = await failShopifyListingImportAttempt(db, {
      attemptId: "attempt-1",
      code: "IMPORT_FAILED",
      message: "boom",
    });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "attempt-1", status: "STARTED" },
      })
    );
    expect(result).toBeNull();
  });
});
