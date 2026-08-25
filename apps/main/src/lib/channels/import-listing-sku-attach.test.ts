import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  channelListingLink: {
    findUnique: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: "link-1", ...data })
    ),
    update: vi.fn(),
    delete: vi.fn(),
  },
  storeItem: {
    findUnique: vi.fn(),
    findFirst: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    delete: vi.fn(),
  },
  memberSyncPreferences: {
    findUnique: vi.fn().mockResolvedValue(null),
  },
  member: {
    findUnique: vi.fn().mockResolvedValue(null),
  },
};

vi.mock("database", () => ({
  prisma: mockPrisma,
  Prisma: { JsonNull: null },
}));

vi.mock("@/lib/shipping-options", () => ({
  attachShippingOptionOnImport: vi.fn().mockResolvedValue(undefined),
}));

describe("importRemoteListing SKU attach", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.channelListingLink.findUnique.mockResolvedValue(null);
    mockPrisma.channelListingLink.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: "link-1", ...data })
    );
    mockPrisma.storeItem.findFirst.mockResolvedValue(null);
    mockPrisma.storeItem.findMany.mockResolvedValue([]);
  });

  it("attaches to an existing item when remote sku is the StoreItem id", async () => {
    const { importRemoteListing } = await import("./import-listing");
    mockPrisma.storeItem.findFirst.mockResolvedValueOnce({
      id: "cmt8zc266000dw2tzrmx9rie1",
      category: "Games",
      channelLinks: [],
    });

    const result = await importRemoteListing({
      memberId: "member-1",
      connectionId: "conn-1",
      provider: "wix",
      listing: {
        externalListingId: "a57a4531-ca63-4a1b-b0ec-e6f9d52fb8d4",
        title: "Shadow Gate Nintendo Entertain",
        sku: "cmt8zc266000dw2tzrmx9rie1",
        description: null,
        photos: ["https://example.com/p.jpg"],
        priceCents: 2000,
        quantity: 1,
        quantityKnown: true,
      },
      externalShopId: "shop-1",
    });

    expect(result).toEqual({
      ok: true,
      storeItemId: "cmt8zc266000dw2tzrmx9rie1",
      externalListingId: "a57a4531-ca63-4a1b-b0ec-e6f9d52fb8d4",
      needsCategoryReview: false,
    });
    expect(mockPrisma.storeItem.create).not.toHaveBeenCalled();
    expect(mockPrisma.channelListingLink.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          storeItemId: "cmt8zc266000dw2tzrmx9rie1",
          externalListingId: "a57a4531-ca63-4a1b-b0ec-e6f9d52fb8d4",
          linkOrigin: "inw_create",
        }),
      })
    );
  });

  it("attaches to the unique unlinked sku match", async () => {
    const { importRemoteListing } = await import("./import-listing");
    mockPrisma.storeItem.findMany.mockResolvedValueOnce([
      { id: "item-sku", category: null, channelLinks: [] },
    ]);

    const result = await importRemoteListing({
      memberId: "member-1",
      connectionId: "conn-1",
      provider: "wix",
      listing: {
        externalListingId: "wix-2",
        title: "Library of Coins",
        sku: "COIN-001",
        description: null,
        photos: ["https://example.com/p.jpg"],
        priceCents: 1500,
        quantity: 1,
        quantityKnown: true,
      },
      externalShopId: "shop-1",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.storeItemId).toBe("item-sku");
      expect(result.needsCategoryReview).toBe(true);
    }
    expect(mockPrisma.storeItem.create).not.toHaveBeenCalled();
    expect(mockPrisma.channelListingLink.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          storeItemId: "item-sku",
          linkOrigin: "import",
        }),
      })
    );
  });
});
