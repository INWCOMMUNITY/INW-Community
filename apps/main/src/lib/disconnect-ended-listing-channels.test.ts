import { beforeEach, describe, expect, it, vi } from "vitest";

const { tx, prisma } = vi.hoisted(() => {
  const tx = {
    etsyVariantMap: { deleteMany: vi.fn() },
    etsyListingLink: { deleteMany: vi.fn() },
    shopifyVariantMap: { deleteMany: vi.fn() },
    shopifyListingLink: { deleteMany: vi.fn() },
  };
  const prisma = {
    $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<void>) => fn(tx)),
    etsyListingLink: { findMany: vi.fn(async () => []) },
    etsyListingImportAttempt: { updateMany: vi.fn() },
    shopifyListingLink: { findMany: vi.fn(async () => []) },
    shopifyListingImportAttempt: { updateMany: vi.fn() },
    etsySyncJob: { updateMany: vi.fn() },
    shopifySyncJob: { updateMany: vi.fn() },
    storeItem: { findMany: vi.fn() },
  };
  return { tx, prisma };
});

vi.mock("database", () => ({ prisma }));

import {
  disconnectChannelsForEndedStoreItems,
  disconnectStoreItemChannels,
} from "./disconnect-ended-listing-channels";

describe("disconnectStoreItemChannels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<void>) => fn(tx));
    prisma.etsyListingLink.findMany.mockResolvedValue([]);
    prisma.shopifyListingLink.findMany.mockResolvedValue([]);
  });

  it("deletes channel links and cancels open sync jobs without calling Etsy or Shopify", async () => {
    await disconnectStoreItemChannels("item-1");

    expect(tx.etsyVariantMap.deleteMany).toHaveBeenCalledWith({ where: { storeItemId: "item-1" } });
    expect(tx.etsyListingLink.deleteMany).toHaveBeenCalledWith({ where: { storeItemId: "item-1" } });
    expect(tx.shopifyVariantMap.deleteMany).toHaveBeenCalledWith({ where: { storeItemId: "item-1" } });
    expect(tx.shopifyListingLink.deleteMany).toHaveBeenCalledWith({ where: { storeItemId: "item-1" } });
    expect(prisma.etsySyncJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          payload: { path: ["storeItemId"], equals: "item-1" },
        }),
        data: expect.objectContaining({ state: "DEAD", lastErrorCode: "INW_ENDED" }),
      })
    );
    expect(prisma.shopifySyncJob.updateMany).toHaveBeenCalled();
    expect(prisma.etsyListingImportAttempt.updateMany).not.toHaveBeenCalled();
    expect(prisma.shopifyListingImportAttempt.updateMany).not.toHaveBeenCalled();
  });

  it("marks the Shopify import ended so the product is not imported again", async () => {
    prisma.shopifyListingLink.findMany.mockResolvedValue([
      { shopifyConnectionId: "conn-1", shopifyProductId: "gid://shopify/Product/300" },
    ]);
    await disconnectStoreItemChannels("item-1");
    expect(prisma.shopifyListingImportAttempt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [{ shopifyConnectionId: "conn-1", shopifyProductId: "gid://shopify/Product/300" }],
        },
        data: expect.objectContaining({
          status: "FAILED",
          failureCode: "INW_ENDED",
          listingLinkId: null,
        }),
      })
    );
  });

  it("marks the Etsy import ended so the listing is not imported again", async () => {
    prisma.etsyListingLink.findMany.mockResolvedValue([
      { etsyConnectionId: "conn-1", etsyListingId: "4586600415" },
    ]);
    await disconnectStoreItemChannels("item-1");
    expect(prisma.etsyListingImportAttempt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [{ etsyConnectionId: "conn-1", etsyListingId: "4586600415" }],
        },
        data: expect.objectContaining({ status: "FAILED", failureCode: "INW_ENDED" }),
      })
    );
  });

  it("unlinks every ended INW listing that still has a channel row", async () => {
    prisma.storeItem.findMany.mockResolvedValue([{ id: "ended-1" }]);
    await disconnectChannelsForEndedStoreItems("member-1");
    expect(prisma.storeItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ memberId: "member-1", status: "inactive" }),
      })
    );
    expect(tx.etsyListingLink.deleteMany).toHaveBeenCalledWith({ where: { storeItemId: "ended-1" } });
    expect(tx.shopifyListingLink.deleteMany).toHaveBeenCalledWith({ where: { storeItemId: "ended-1" } });
  });
});
