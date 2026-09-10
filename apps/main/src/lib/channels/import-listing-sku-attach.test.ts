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
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn(),
  },
  channelCategoryMapping: {
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(1),
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
  Prisma: {
    JsonNull: null,
    PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {},
    PrismaClientValidationError: class PrismaClientValidationError extends Error {},
  },
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
    mockPrisma.storeItem.findUnique.mockResolvedValue(null);
    mockPrisma.storeItem.findMany.mockResolvedValue([]);
    mockPrisma.storeItem.update.mockResolvedValue({});
    mockPrisma.channelCategoryMapping.findMany.mockResolvedValue([]);
    mockPrisma.channelCategoryMapping.count.mockResolvedValue(1);
  });

  it("attaches to an existing item when remote sku is the StoreItem id", async () => {
    const { importRemoteListing } = await import("./import-listing");
    mockPrisma.storeItem.findFirst.mockResolvedValueOnce({
      id: "cmt8zc266000dw2tzrmx9rie1",
      category: "Clothing",
      subcategory: "Tops & Tees",
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
    expect(mockPrisma.storeItem.update).not.toHaveBeenCalled();
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
      { id: "item-sku", category: null, subcategory: null, channelLinks: [] },
    ]);

    const result = await importRemoteListing({
      memberId: "member-1",
      connectionId: "conn-1",
      provider: "wix",
      listing: {
        externalListingId: "wix-2",
        title: "Handmade lavender soap bar",
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
    expect(mockPrisma.storeItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "item-sku" },
        data: expect.objectContaining({
          category: expect.any(String),
        }),
      })
    );
    expect(mockPrisma.channelListingLink.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          storeItemId: "item-sku",
          linkOrigin: "import",
        }),
      })
    );
  });

  it("baselines the link to the item's content when attaching", async () => {
    const { importRemoteListing } = await import("./import-listing");
    mockPrisma.storeItem.findMany.mockResolvedValueOnce([
      { id: "item-sku", category: "Clothing", subcategory: "Tops & Tees", channelLinks: [] },
    ]);
    mockPrisma.storeItem.findUnique.mockResolvedValueOnce({
      id: "item-sku",
      title: "Handmade lavender soap bar",
      description: "nice",
      photos: [],
      priceCents: 1500,
      quantity: 4,
      category: "Clothing",
      subcategory: "Tops & Tees",
      secondaryCategory: null,
      shippingCostCents: null,
      variants: null,
    });

    await importRemoteListing({
      memberId: "member-1",
      connectionId: "conn-1",
      provider: "wix",
      listing: {
        externalListingId: "wix-9",
        title: "Handmade lavender soap bar",
        sku: "COIN-777",
        description: null,
        photos: ["https://example.com/p.jpg"],
        priceCents: 1500,
        quantity: 4,
        quantityKnown: true,
      },
      externalShopId: "shop-1",
    });

    expect(mockPrisma.storeItem.create).not.toHaveBeenCalled();
    const createArg = mockPrisma.channelListingLink.create.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(createArg.data.syncBaselineHash).toEqual(expect.any(String));
    expect(createArg.data.syncBaselineQty).toBe(4);
    expect(createArg.data.lastPushedHash).toEqual(expect.any(String));
  });

  it("skips (does not mint) when the SKU maps to multiple unlinked items", async () => {
    const { importRemoteListing } = await import("./import-listing");
    mockPrisma.storeItem.findMany.mockResolvedValueOnce([
      { id: "item-a", category: null, subcategory: null, channelLinks: [] },
      { id: "item-b", category: null, subcategory: null, channelLinks: [] },
    ]);

    const result = await importRemoteListing({
      memberId: "member-1",
      connectionId: "conn-1",
      provider: "wix",
      listing: {
        externalListingId: "wix-dup",
        title: "Ambiguous SKU item",
        sku: "DUP-1",
        description: null,
        photos: ["https://example.com/p.jpg"],
        priceCents: 1500,
        quantity: 1,
        quantityKnown: true,
      },
      externalShopId: "shop-1",
    });

    expect(result).toEqual({
      ok: false,
      externalListingId: "wix-dup",
      reason: "ambiguous_sku",
    });
    expect(mockPrisma.storeItem.create).not.toHaveBeenCalled();
    expect(mockPrisma.channelListingLink.create).not.toHaveBeenCalled();
  });
});
