import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  channelListingLink: {
    findUnique: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: "link-1", ...data })
    ),
  },
  storeItem: {
    findUnique: vi.fn(),
  },
  memberSyncPreferences: {
    findUnique: vi.fn().mockResolvedValue(null),
  },
};

vi.mock("database", () => ({
  prisma: mockPrisma,
  Prisma: { JsonNull: null },
}));

const mockAdapter = {
  createListing: vi.fn().mockResolvedValue({
    externalListingId: "ext-123",
    externalShopId: "shop-1",
    live: true,
  }),
};

vi.mock("../registry", () => ({
  getAdapter: () => mockAdapter,
}));

const mockGetActiveConnectionsForMember = vi.fn();

vi.mock("../connection", () => ({
  getActiveConnectionsForMember: (...args: unknown[]) => mockGetActiveConnectionsForMember(...args),
  withConnectionAuthRetry: vi.fn(),
}));

vi.mock("../ebay/aspects", () => ({
  getItemAspectsForCategory: vi.fn().mockResolvedValue([]),
}));

vi.mock("../sentry", () => ({
  captureChannelSyncError: vi.fn(),
}));

function makeStoreItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "item-1",
    sku: null,
    title: "Test Item",
    description: "A test item",
    photos: ["https://example.com/photo.jpg"],
    priceCents: 1500,
    quantity: 5,
    variants: null,
    status: "active",
    condition: "used",
    category: "Home & Living",
    subcategory: null,
    secondaryCategory: null,
    shippingCostCents: 500,
    etsyWhoMade: "i_did",
    etsyWhenMade: "made_to_order",
    etsyIsSupply: false,
    etsyTaxonomyId: 891,
    ebayCategoryId: 11450,
    ebayConditionEnum: null,
    aspects: [{ name: "Brand", value: "Nike" }],
    acceptOffers: true,
    minOfferCents: null,
    ...overrides,
  };
}

function makeConn(overrides: Record<string, unknown> = {}) {
  return {
    id: "conn-1",
    memberId: "member-1",
    provider: "wix" as const,
    externalShopId: "shop-1",
    accessToken: "token",
    etsyShippingProfileId: "ship-1",
    config: { locationId: "1", shop: "demo.myshopify.com" },
    ...overrides,
  };
}

describe("publishStoreItemToChannels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.memberSyncPreferences.findUnique.mockResolvedValue(null);
    mockPrisma.channelListingLink.findUnique.mockResolvedValue(null);
    mockPrisma.channelListingLink.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: "link-1", ...data })
    );
    mockAdapter.createListing.mockResolvedValue({
      externalListingId: "ext-123",
      externalShopId: "shop-1",
      live: true,
    });
  });

  it("returns a failure row when sync is disabled instead of an empty array", async () => {
    const { publishStoreItemToChannels } = await import("../outbound");
    mockPrisma.memberSyncPreferences.findUnique.mockResolvedValueOnce({ syncEnabled: false });
    mockPrisma.storeItem.findUnique.mockResolvedValueOnce(makeStoreItem());
    mockGetActiveConnectionsForMember.mockResolvedValueOnce([makeConn()]);

    const results = await publishStoreItemToChannels("item-1", "member-1", { providers: ["wix"] });

    expect(results).toEqual([
      expect.objectContaining({ provider: "wix", ok: false, error: expect.stringMatching(/turned off/i) }),
    ]);
    expect(mockAdapter.createListing).not.toHaveBeenCalled();
    expect(mockPrisma.channelListingLink.create).not.toHaveBeenCalled();
  });

  it("returns a failure row when the channel is pull-only", async () => {
    const { publishStoreItemToChannels } = await import("../outbound");
    mockPrisma.storeItem.findUnique.mockResolvedValueOnce(makeStoreItem());
    mockGetActiveConnectionsForMember.mockResolvedValueOnce([
      makeConn({ config: { syncDirection: "pull_only" } }),
    ]);

    const results = await publishStoreItemToChannels("item-1", "member-1", { providers: ["wix"] });

    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.error).toMatch(/pull-only/i);
    expect(mockAdapter.createListing).not.toHaveBeenCalled();
  });

  it("does not create a ChannelListingLink when createListing throws", async () => {
    const { publishStoreItemToChannels } = await import("../outbound");
    mockPrisma.storeItem.findUnique.mockResolvedValueOnce(makeStoreItem());
    mockGetActiveConnectionsForMember.mockResolvedValueOnce([
      makeConn({
        provider: "ebay",
        config: {
          canPublish: true,
          fulfillmentPolicyId: "f",
          paymentPolicyId: "p",
          returnPolicyId: "r",
          merchantLocationKey: "loc",
        },
      }),
    ]);
    mockAdapter.createListing.mockRejectedValueOnce(new Error("eBay publish failed: missing Grade"));

    const results = await publishStoreItemToChannels("item-1", "member-1", { providers: ["ebay"] });

    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.error).toMatch(/publish failed|Grade/i);
    expect(mockPrisma.channelListingLink.create).not.toHaveBeenCalled();
  });

  it("blocks Etsy create when who_made is missing", async () => {
    const { publishStoreItemToChannels } = await import("../outbound");
    mockPrisma.storeItem.findUnique.mockResolvedValueOnce(
      makeStoreItem({ etsyWhoMade: null, etsyWhenMade: "made_to_order", etsyTaxonomyId: 891 })
    );
    mockGetActiveConnectionsForMember.mockResolvedValueOnce([
      makeConn({ provider: "etsy", etsyShippingProfileId: "ship-1" }),
    ]);

    const results = await publishStoreItemToChannels("item-1", "member-1", { providers: ["etsy"] });

    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.error).toMatch(/who made/i);
    expect(mockAdapter.createListing).not.toHaveBeenCalled();
  });

  it("creates a Wix listing when title, price, quantity, and photos are present", async () => {
    const { publishStoreItemToChannels } = await import("../outbound");
    mockPrisma.storeItem.findUnique.mockResolvedValueOnce(makeStoreItem());
    mockGetActiveConnectionsForMember.mockResolvedValueOnce([makeConn({ provider: "wix" })]);

    const results = await publishStoreItemToChannels("item-1", "member-1", { providers: ["wix"] });

    expect(results[0]).toEqual({ provider: "wix", ok: true });
    expect(mockAdapter.createListing).toHaveBeenCalledOnce();
    expect(mockPrisma.channelListingLink.create).toHaveBeenCalledOnce();
  });

  it("creates a Shopify listing when the connection has a shop and location", async () => {
    const { publishStoreItemToChannels } = await import("../outbound");
    mockPrisma.storeItem.findUnique.mockResolvedValueOnce(makeStoreItem());
    mockGetActiveConnectionsForMember.mockResolvedValueOnce([
      makeConn({
        provider: "shopify",
        config: { locationId: "gid://shopify/Location/1", shop: "demo.myshopify.com" },
      }),
    ]);

    const results = await publishStoreItemToChannels("item-1", "member-1", { providers: ["shopify"] });

    expect(results[0]).toEqual({ provider: "shopify", ok: true });
    expect(mockAdapter.createListing).toHaveBeenCalledOnce();
  });

  it("records an Etsy draft as a failed List on result while still linking", async () => {
    const { publishStoreItemToChannels } = await import("../outbound");
    mockPrisma.storeItem.findUnique.mockResolvedValueOnce(makeStoreItem());
    mockGetActiveConnectionsForMember.mockResolvedValueOnce([
      makeConn({ provider: "etsy", etsyShippingProfileId: "ship-1" }),
    ]);
    mockAdapter.createListing.mockResolvedValueOnce({
      externalListingId: "etsy-1",
      externalShopId: "123",
      live: false,
      warning: "Created as an Etsy draft — add a shipping profile in Sync Stores to go live.",
    });

    const results = await publishStoreItemToChannels("item-1", "member-1", { providers: ["etsy"] });

    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.error).toMatch(/draft/i);
    expect(mockPrisma.channelListingLink.create).toHaveBeenCalledOnce();
  });

  it("returns an ok row when the item is already listed on that store", async () => {
    const { publishStoreItemToChannels } = await import("../outbound");
    mockPrisma.storeItem.findUnique.mockResolvedValueOnce(makeStoreItem());
    mockGetActiveConnectionsForMember.mockResolvedValueOnce([makeConn({ provider: "wix" })]);
    mockPrisma.channelListingLink.findUnique.mockResolvedValueOnce({
      id: "link-existing",
      externalListingId: "wix-1",
    });

    const results = await publishStoreItemToChannels("item-1", "member-1", { providers: ["wix"] });

    expect(results).toEqual([{ provider: "wix", ok: true }]);
    expect(mockAdapter.createListing).not.toHaveBeenCalled();
  });

  it("creates an Etsy draft result when the connection has no shipping profile", async () => {
    const { publishStoreItemToChannels } = await import("../outbound");
    mockPrisma.storeItem.findUnique.mockResolvedValueOnce(makeStoreItem());
    mockGetActiveConnectionsForMember.mockResolvedValueOnce([
      makeConn({ provider: "etsy", etsyShippingProfileId: null }),
    ]);
    mockAdapter.createListing.mockResolvedValueOnce({
      externalListingId: "etsy-draft-1",
      externalShopId: "123",
      live: false,
      warning: "Created as an Etsy draft — add a shipping profile in Sync Stores to go live.",
    });

    const results = await publishStoreItemToChannels("item-1", "member-1", { providers: ["etsy"] });

    expect(mockAdapter.createListing).toHaveBeenCalledOnce();
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.error).toMatch(/draft/i);
    expect(mockPrisma.channelListingLink.create).toHaveBeenCalledOnce();
  });
});
