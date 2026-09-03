import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Channel sync integration tests. Uses mocked Prisma and adapters to verify
 * the import -> edit -> sale -> retry flow without needing a real database.
 */

// ---- Prisma mock setup ----

const mockPrisma = {
  channelListingLink: {
    findMany: vi.fn().mockResolvedValue([]),
    findUnique: vi.fn().mockResolvedValue(null),
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: "link-1", ...data })),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
  },
  channelConnection: {
    findFirst: vi.fn().mockResolvedValue(null),
    findUnique: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue({}),
    count: vi.fn().mockResolvedValue(0),
  },
  channelSyncEvent: {
    create: vi.fn().mockResolvedValue({}),
    findFirst: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue({}),
  },
  channelSyncRetry: {
    findFirst: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
  channelSyncLog: {
    create: vi.fn().mockResolvedValue({}),
    findMany: vi.fn().mockResolvedValue([]),
  },
  storeItem: {
    findUnique: vi.fn().mockResolvedValue(null),
    findFirst: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockImplementation(({ data }) =>
      Promise.resolve({ id: "item-1", ...data, updatedAt: new Date() })
    ),
    update: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    delete: vi.fn().mockResolvedValue({}),
  },
  memberSyncPreferences: {
    findUnique: vi.fn().mockResolvedValue(null),
  },
};

class MockPrismaError extends Error {
  code: string;
  meta: Record<string, unknown> | undefined;
  constructor(code: string, meta?: Record<string, unknown>) {
    super(`Prisma error: ${code}`);
    this.code = code;
    this.meta = meta;
  }
}

class MockPrismaValidationError extends Error {
  constructor(message: string) {
    super(message);
  }
}

vi.mock("database", () => ({
  prisma: mockPrisma,
  Prisma: {
    JsonNull: null,
    InputJsonValue: null,
    PrismaClientKnownRequestError: MockPrismaError,
    PrismaClientValidationError: MockPrismaValidationError,
  },
}));

vi.mock("@/lib/encrypt", () => ({
  encrypt: (v: string) => `enc:${v}`,
  decrypt: (v: string) => v.replace(/^enc:/, ""),
}));

vi.mock("@/lib/send-push-notification", () => ({
  sendPushNotification: vi.fn().mockResolvedValue(undefined),
}));

// ---- Mock adapter ----

const mockAdapter = {
  createListing: vi.fn().mockResolvedValue({
    externalListingId: "ext-123",
    externalShopId: "shop-1",
  }),
  updateListing: vi.fn().mockResolvedValue(undefined),
  updateInventory: vi.fn().mockResolvedValue(undefined),
  deleteListing: vi.fn().mockResolvedValue(undefined),
  fetchRecentSales: vi.fn().mockResolvedValue([]),
  fetchListings: vi.fn().mockResolvedValue([]),
  refreshAccessToken: vi.fn().mockResolvedValue({
    accessToken: "new-token",
    refreshToken: "new-refresh",
    expiresInSec: 3600,
  }),
  fetchProductQuantity: vi.fn().mockResolvedValue({ quantity: 5, known: true }),
};

vi.mock("../registry", () => ({
  getAdapter: () => mockAdapter,
}));

vi.mock("../sentry", () => ({
  captureChannelSyncError: vi.fn(),
}));

const makeStoreItem = (overrides: Record<string, unknown> = {}) => ({
  id: "item-1",
  title: "Test Item",
  description: "A test item",
  photos: ["https://example.com/photo.jpg"],
  priceCents: 1500,
  quantity: 5,
  variants: null,
  status: "active",
  condition: "used",
  category: "Clothing",
  subcategory: "Tops",
  secondaryCategory: null,
  shippingCostCents: 500,
  slug: "test-item",
  memberId: "member-1",
  updatedAt: new Date(),
  etsyWhoMade: null,
  etsyWhenMade: null,
  etsyIsSupply: null,
  etsyTaxonomyId: null,
  ebayCategoryId: null,
  ebayConditionEnum: null,
  aspects: null,
  sku: null,
  acceptOffers: true,
  minOfferCents: null,
  ebayItemSpecifics: null,
  ...overrides,
});

const makeConnection = (overrides: Record<string, unknown> = {}) => ({
  id: "conn-1",
  memberId: "member-1",
  provider: "wix",
  externalShopId: "shop-1",
  accessTokenEncrypted: "enc:test-token",
  refreshTokenEncrypted: "enc:test-refresh",
  tokenExpiresAt: new Date(Date.now() + 3600_000),
  status: "active",
  etsyShippingProfileId: null,
  config: null,
  ...overrides,
});

const makeLink = (overrides: Record<string, unknown> = {}) => ({
  id: "link-1",
  storeItemId: "item-1",
  connectionId: "conn-1",
  provider: "wix",
  externalListingId: "ext-123",
  externalShopId: "shop-1",
  syncEnabled: true,
  syncStatus: "synced",
  syncError: null,
  lastPushedHash: null,
  lastPushedAt: null,
  lastInboundAt: null,
  syncBaselineHash: null,
  syncBaselineQty: 5,
  syncBaselineAt: null,
  syncBaselineMetaHash: null,
  syncBaselineVariantsHash: null,
  connection: makeConnection(),
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("sync-inventory", () => {
  it("pushes inventory to linked channels", async () => {
    const { syncInventoryToChannels } = await import("../sync-inventory");

    const link = makeLink();
    mockPrisma.channelListingLink.findMany.mockResolvedValueOnce([link]);
    mockPrisma.storeItem.findUnique.mockResolvedValueOnce(makeStoreItem());

    const results = await syncInventoryToChannels("item-1");

    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(true);
    expect(mockAdapter.updateInventory).toHaveBeenCalledOnce();
    expect(mockPrisma.channelListingLink.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "link-1" },
        data: expect.objectContaining({ syncStatus: "synced" }),
      })
    );
  });

  it("enqueues retry on failure", async () => {
    const { syncInventoryToChannels } = await import("../sync-inventory");

    const link = makeLink();
    mockPrisma.channelListingLink.findMany.mockResolvedValueOnce([link]);
    mockPrisma.storeItem.findUnique.mockResolvedValueOnce(makeStoreItem());
    mockAdapter.updateInventory.mockRejectedValueOnce(new Error("API timeout"));

    const results = await syncInventoryToChannels("item-1");

    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(false);
    expect(results[0].error).toContain("API timeout");
    expect(mockPrisma.channelSyncRetry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          linkId: "link-1",
          retryType: "inventory",
        }),
      })
    );
  });

  it("skips zero-quantity push when syncZeroQuantity is off and item is not sold out", async () => {
    const { syncInventoryToChannels } = await import("../sync-inventory");

    const link = makeLink();
    mockPrisma.channelListingLink.findMany.mockResolvedValueOnce([link]);
    mockPrisma.memberSyncPreferences.findUnique.mockResolvedValueOnce({
      safetyBuffer: 0,
      syncEnabled: true,
      syncZeroQuantity: false,
      lowStockAlertThreshold: 0,
    });
    mockPrisma.storeItem.findUnique.mockResolvedValueOnce(
      makeStoreItem({ quantity: 0, status: "active" })
    );

    const results = await syncInventoryToChannels("item-1");

    expect(results).toHaveLength(0);
    expect(mockAdapter.updateInventory).not.toHaveBeenCalled();
    expect(mockPrisma.channelListingLink.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "link-1" },
        data: expect.objectContaining({
          syncError: "Zero push skipped (syncZeroQuantity disabled)",
        }),
      })
    );
  });

  it("still pushes quantity 0 when the item is sold_out even if syncZeroQuantity is off", async () => {
    const { syncInventoryToChannels } = await import("../sync-inventory");

    const link = makeLink();
    mockPrisma.channelListingLink.findMany.mockResolvedValueOnce([link]);
    mockPrisma.memberSyncPreferences.findUnique.mockResolvedValueOnce({
      safetyBuffer: 0,
      syncEnabled: true,
      syncZeroQuantity: false,
      lowStockAlertThreshold: 0,
    });
    mockPrisma.storeItem.findUnique.mockResolvedValueOnce(
      makeStoreItem({ quantity: 0, status: "sold_out" })
    );

    const results = await syncInventoryToChannels("item-1");

    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(true);
    expect(mockAdapter.updateInventory).toHaveBeenCalledOnce();
  });

  it("skips providers in skipProviders", async () => {
    const { syncInventoryToChannels } = await import("../sync-inventory");

    const link = makeLink({ provider: "wix" });
    mockPrisma.channelListingLink.findMany.mockResolvedValueOnce([link]);

    const results = await syncInventoryToChannels("item-1", { skipProviders: ["wix"] });

    expect(results).toHaveLength(0);
    expect(mockAdapter.updateInventory).not.toHaveBeenCalled();
  });
});

describe("connection token refresh", () => {
  it("refreshes expired token and logs success", async () => {
    const { getConnectionContext } = await import("../connection");

    const expiredConn = makeConnection({
      tokenExpiresAt: new Date(Date.now() - 60_000),
    });

    const ctx = await getConnectionContext(expiredConn);

    expect(ctx).not.toBeNull();
    expect(ctx!.accessToken).toBe("new-token");
    expect(mockPrisma.channelConnection.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "active" }),
      })
    );
    expect(mockPrisma.channelSyncLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "token_refreshed" }),
      })
    );
  });

  it("sets error status on refresh failure", async () => {
    const { getConnectionContext } = await import("../connection");

    mockAdapter.refreshAccessToken.mockRejectedValueOnce(new Error("Invalid grant"));

    const expiredConn = makeConnection({
      tokenExpiresAt: new Date(Date.now() - 60_000),
    });

    const ctx = await getConnectionContext(expiredConn);

    expect(ctx).toBeNull();
    expect(mockPrisma.channelConnection.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "error" }),
      })
    );
    expect(mockPrisma.channelSyncLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "token_expired" }),
      })
    );
  });
});

describe("retry queue", () => {
  it("processes due retries and deletes on success", async () => {
    const { processRetryQueue } = await import("../retry-queue");

    const retryRow = {
      id: "retry-1",
      linkId: "link-1",
      storeItemId: "item-1",
      provider: "wix",
      retryType: "inventory",
      attempts: 0,
      maxAttempts: 5,
      nextRetryAt: new Date(Date.now() - 1000),
      lastError: "previous error",
      createdAt: new Date(),
    };

    mockPrisma.channelSyncRetry.findMany.mockResolvedValueOnce([retryRow]);
    const link = makeLink();
    mockPrisma.channelListingLink.findMany.mockResolvedValueOnce([link]);
    mockPrisma.storeItem.findUnique.mockResolvedValueOnce(makeStoreItem());
    mockAdapter.updateInventory.mockResolvedValueOnce(undefined);

    const result = await processRetryQueue();

    expect(result.processed).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(mockPrisma.channelSyncRetry.delete).toHaveBeenCalledWith({
      where: { id: "retry-1" },
    });
  });

  it("bumps attempt on retry failure", async () => {
    const { processRetryQueue } = await import("../retry-queue");

    const retryRow = {
      id: "retry-1",
      linkId: "link-1",
      storeItemId: "item-1",
      provider: "wix",
      retryType: "inventory",
      attempts: 1,
      maxAttempts: 5,
      nextRetryAt: new Date(Date.now() - 1000),
      lastError: null,
      createdAt: new Date(),
    };

    mockPrisma.channelSyncRetry.findMany.mockResolvedValueOnce([retryRow]);
    const link = makeLink();
    mockPrisma.channelListingLink.findMany.mockResolvedValueOnce([link]);
    mockPrisma.storeItem.findUnique.mockResolvedValueOnce(makeStoreItem());
    mockAdapter.updateInventory.mockRejectedValueOnce(new Error("Still failing"));

    const result = await processRetryQueue();

    expect(result.processed).toBe(1);
    expect(result.failed).toBe(1);
    expect(mockPrisma.channelSyncRetry.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "retry-1" },
        data: expect.objectContaining({ attempts: 2 }),
      })
    );
  });
});

describe("outbound publish photo validation", () => {
  it("rejects ebay publish when no photos", async () => {
    const { publishStoreItemToChannels } = await import("../outbound");

    const conn = makeConnection({ provider: "ebay" });
    mockPrisma.storeItem.findUnique.mockResolvedValueOnce(makeStoreItem({ photos: [] }));
    mockPrisma.channelConnection.findMany.mockResolvedValueOnce([conn]);
    mockPrisma.channelListingLink.findUnique.mockResolvedValueOnce(null);

    const { getActiveConnectionsForMember } = await import("../connection");
    vi.spyOn(
      await import("../connection"),
      "getActiveConnectionsForMember"
    ).mockResolvedValueOnce([
      {
        id: "conn-1",
        memberId: "member-1",
        provider: "ebay" as const,
        externalShopId: "shop-1",
        accessToken: "token",
        etsyShippingProfileId: null,
        config: null,
      },
    ]);

    const results = await publishStoreItemToChannels("item-1", "member-1");

    const ebayResult = results.find((r) => r.provider === "ebay");
    expect(ebayResult?.ok).toBe(false);
    expect(ebayResult?.error).toMatch(/photo/i);
    expect(mockAdapter.createListing).not.toHaveBeenCalled();
  });
});

describe("import validation", () => {
  it("rejects import with empty title", async () => {
    const { importRemoteListing } = await import("../import-listing");

    const result = await importRemoteListing({
      memberId: "member-1",
      connectionId: "conn-1",
      provider: "wix",
      listing: {
        externalListingId: "ext-1",
        title: "   ",
        description: null,
        photos: [],
        priceCents: 1000,
        quantity: 1,
        category: null,
        subcategory: null,
        quantityKnown: true,
      },
      externalShopId: "shop-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid_title");
    }
  });

  it("defaults quantity to 0 when quantityKnown is false", async () => {
    const { importRemoteListing } = await import("../import-listing");

    mockPrisma.channelListingLink.findFirst.mockResolvedValueOnce(null);

    const result = await importRemoteListing({
      memberId: "member-1",
      connectionId: "conn-1",
      provider: "wix",
      listing: {
        externalListingId: "ext-2",
        title: "Unknown Qty Item",
        description: "Test",
        photos: ["https://example.com/p.jpg"],
        priceCents: 2000,
        quantity: 0,
        category: null,
        subcategory: null,
        quantityKnown: false,
      },
      externalShopId: "shop-1",
    });

    if (result.ok) {
      expect(mockPrisma.storeItem.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ quantity: 0, status: "sold_out" }),
        })
      );
    }
  });
});

describe("error classification", () => {
  it("classifies 429 as transient", async () => {
    const { classifyError } = await import("../error-classifier");
    
    const error = { status: 429, message: "Too many requests" };
    expect(classifyError(error)).toBe("transient");
  });

  it("classifies 500 as transient", async () => {
    const { classifyError } = await import("../error-classifier");
    
    const error = { status: 500, message: "Internal server error" };
    expect(classifyError(error)).toBe("transient");
  });

  it("classifies 401 as auth", async () => {
    const { classifyError } = await import("../error-classifier");
    
    const error = { status: 401, message: "Unauthorized" };
    expect(classifyError(error)).toBe("auth");
  });

  it("classifies token expired as auth", async () => {
    const { classifyError } = await import("../error-classifier");
    
    const error = new Error("Access token expired");
    expect(classifyError(error)).toBe("auth");
  });

  it("classifies 404 as permanent", async () => {
    const { classifyError } = await import("../error-classifier");
    
    const error = { status: 404, message: "Not found" };
    expect(classifyError(error)).toBe("permanent");
  });

  it("classifies invalid SKU as permanent", async () => {
    const { classifyError } = await import("../error-classifier");
    
    const error = new Error("Invalid SKU provided");
    expect(classifyError(error)).toBe("permanent");
  });

  it("classifies network timeout as transient", async () => {
    const { classifyError } = await import("../error-classifier");
    
    const error = new Error("ETIMEDOUT");
    expect(classifyError(error)).toBe("transient");
  });

  it("defaults unknown errors to transient", async () => {
    const { classifyError } = await import("../error-classifier");
    
    const error = new Error("Some unusual error");
    expect(classifyError(error)).toBe("transient");
  });

  it("classifies ended eBay item as permanent and #25604 as a retryable miss", async () => {
    const { classifyError, isEbayEndedListingError } = await import("../error-classifier");
    expect(classifyError(new Error("Not allowed to revise an ended item"))).toBe("permanent");
    expect(classifyError(new Error("Availability not found (#25604)"))).toBe("transient");
    const http400 = new Error("Availability not found for this SKU (#25604)") as Error & {
      status: number;
    };
    http400.status = 400;
    expect(classifyError(http400)).toBe("transient");
    expect(isEbayEndedListingError("listing ended")).toBe(true);
    expect(isEbayEndedListingError("revise an ended listing")).toBe(true);
    expect(isEbayEndedListingError("Availability not found for this SKU (#25604)")).toBe(false);
  });

  it("classifies eBay Picture Policy 500px errors as transient so URL upgrades can retry", async () => {
    const { classifyError } = await import("../error-classifier");
    const err = new Error(
      "Listing details didn't update on eBay: [#25002 · API_INVENTORY · Request · HTTP 400] The resolution for provided picture(s) does not meet eBay's Picture Policy requirements. Please only use pictures that are at least 500 pixels on the longest side."
    );
    (err as Error & { status: number }).status = 400;
    expect(classifyError(err)).toBe("transient");
  });
});

describe("circuit breaker", () => {
  beforeEach(async () => {
    const { resetCircuit } = await import("../circuit-breaker");
    await resetCircuit("test-conn-1", "wix");
  });

  it("starts in closed state", async () => {
    const { getCircuitStatus, isCircuitOpen } = await import("../circuit-breaker");
    
    const status = getCircuitStatus("test-conn-1");
    expect(status.state).toBe("CLOSED");
    expect(isCircuitOpen("test-conn-1")).toBe(false);
  });

  it("opens after threshold failures", async () => {
    const { recordCircuitFailure, isCircuitOpen, getCircuitStatus } = await import("../circuit-breaker");
    
    for (let i = 0; i < 5; i++) {
      await recordCircuitFailure("test-conn-1", "wix", "member-1", `503 Service Unavailable ${i}`);
    }
    
    expect(isCircuitOpen("test-conn-1")).toBe(true);
    expect(getCircuitStatus("test-conn-1").state).toBe("OPEN");
  });

  it("transitions to half-open after recovery timeout", async () => {
    const { recordCircuitFailure, isCircuitOpen, getCircuitStatus } = await import("../circuit-breaker");
    
    for (let i = 0; i < 5; i++) {
      await recordCircuitFailure("test-conn-2", "wix", "member-1", `503 Service Unavailable ${i}`);
    }
    
    expect(isCircuitOpen("test-conn-2")).toBe(true);

    vi.useFakeTimers();
    vi.advanceTimersByTime(35_000);

    expect(isCircuitOpen("test-conn-2")).toBe(false);
    expect(getCircuitStatus("test-conn-2").state).toBe("HALF_OPEN");
    
    vi.useRealTimers();
  });

  it("closes after successful half-open requests", async () => {
    const { recordCircuitFailure, recordCircuitSuccess, isCircuitOpen, getCircuitStatus } = await import("../circuit-breaker");
    
    for (let i = 0; i < 5; i++) {
      await recordCircuitFailure("test-conn-3", "wix", "member-1", `503 Service Unavailable ${i}`);
    }
    
    vi.useFakeTimers();
    vi.advanceTimersByTime(35_000);
    isCircuitOpen("test-conn-3");
    
    await recordCircuitSuccess("test-conn-3", "wix", "member-1");
    await recordCircuitSuccess("test-conn-3", "wix", "member-1");
    
    expect(getCircuitStatus("test-conn-3").state).toBe("CLOSED");
    
    vi.useRealTimers();
  });

  it("re-opens if half-open test fails", async () => {
    const { recordCircuitFailure, isCircuitOpen, getCircuitStatus } = await import("../circuit-breaker");
    
    for (let i = 0; i < 5; i++) {
      await recordCircuitFailure("test-conn-4", "wix", "member-1", `503 Service Unavailable ${i}`);
    }
    
    vi.useFakeTimers();
    vi.advanceTimersByTime(35_000);
    isCircuitOpen("test-conn-4");
    expect(getCircuitStatus("test-conn-4").state).toBe("HALF_OPEN");
    
    await recordCircuitFailure("test-conn-4", "wix", "member-1", "503 Service Unavailable");
    
    expect(getCircuitStatus("test-conn-4").state).toBe("OPEN");
    
    vi.useRealTimers();
  });

  it("does not trip the shop on listing-level Etsy verify/validation errors", async () => {
    const { recordCircuitFailure, isCircuitOpen, resetCircuit } = await import("../circuit-breaker");
    await resetCircuit("test-conn-etsy-edit", "etsy");
    for (let i = 0; i < 8; i++) {
      await recordCircuitFailure(
        "test-conn-etsy-edit",
        "etsy",
        "member-1",
        `Etsy inventory verify failed for listing ${i}: expected 3, got 2`
      );
    }
    expect(isCircuitOpen("test-conn-etsy-edit")).toBe(false);
  });

  it("does not re-open half-open on an Etsy listing validation 400", async () => {
    const { recordCircuitFailure, isCircuitOpen, getCircuitStatus } = await import("../circuit-breaker");

    for (let i = 0; i < 5; i++) {
      await recordCircuitFailure("test-conn-5", "etsy", "member-1", `503 Service Unavailable ${i}`);
    }

    vi.useFakeTimers();
    vi.advanceTimersByTime(35_000);
    isCircuitOpen("test-conn-5");
    expect(getCircuitStatus("test-conn-5").state).toBe("HALF_OPEN");

    await recordCircuitFailure(
      "test-conn-5",
      "etsy",
      "member-1",
      "Cannot update 'when_made' without 'who_made' and  without 'is_supply' and vice versa"
    );

    expect(getCircuitStatus("test-conn-5").state).toBe("HALF_OPEN");
    vi.useRealTimers();
  });

  it("does not restore a listing-level pause from saved connection config", async () => {
    const { hydrateCircuitFromConfig, isCircuitOpen, getCircuitStatus } = await import(
      "../circuit-breaker"
    );
    hydrateCircuitFromConfig("test-conn-stale-etsy", {
      circuitBreaker: {
        state: "OPEN",
        openedAt: new Date().toISOString(),
        lastError: "Cannot update 'when_made' without 'who_made' and  without 'is_supply'",
      },
    });
    expect(isCircuitOpen("test-conn-stale-etsy")).toBe(false);
    expect(getCircuitStatus("test-conn-stale-etsy").state).toBe("CLOSED");
  });
});

describe("rate limit tracker", () => {
  it("allows requests within limit", async () => {
    const { checkRateLimit, recordRequest, resetRateLimitTracking } = await import("../rate-limit-tracker");
    
    resetRateLimitTracking("etsy", "conn-1");
    
    const check = checkRateLimit("etsy", "conn-1");
    expect(check.canProceed).toBe(true);
    expect(check.currentRate).toBe(0);
  });

  it("blocks when at rate limit", async () => {
    const { checkRateLimit, recordRequest, resetRateLimitTracking } = await import("../rate-limit-tracker");
    
    resetRateLimitTracking("etsy", "conn-2");
    
    for (let i = 0; i < 10; i++) {
      recordRequest("etsy", "conn-2");
    }
    
    const check = checkRateLimit("etsy", "conn-2");
    expect(check.canProceed).toBe(false);
    expect(check.currentRate).toBe(10);
    expect(check.waitMs).toBeGreaterThan(0);
  });

  it("tracks shopify burst limits", async () => {
    const { getRateLimitStats, recordRequest, resetRateLimitTracking } = await import("../rate-limit-tracker");
    
    resetRateLimitTracking("shopify", "conn-1");
    
    recordRequest("shopify", "conn-1");
    
    const stats = getRateLimitStats("shopify", "conn-1");
    expect(stats.burstLimit).toBe(40);
    expect(stats.burstCount).toBe(1);
  });
});

describe("optimistic locking", () => {
  it("retries on concurrent modification", async () => {
    const { applyStoreItemDecrementAfterSale, ConcurrentModificationError } = await import("@/lib/store-item-inventory-sale");

    const storeItem = {
      id: "item-lock-test",
      variants: null,
      quantity: 10,
      updatedAt: new Date(),
    };

    mockPrisma.storeItem.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });

    mockPrisma.storeItem.findUnique.mockResolvedValueOnce({
      ...storeItem,
      updatedAt: new Date(),
    });

    await applyStoreItemDecrementAfterSale(
      { storeItem: mockPrisma.storeItem } as any,
      storeItem,
      { quantity: 1, variant: null }
    );

    expect(mockPrisma.storeItem.updateMany).toHaveBeenCalledTimes(2);
  });

  it("throws after max retries", async () => {
    const { applyStoreItemDecrementAfterSale, ConcurrentModificationError } = await import("@/lib/store-item-inventory-sale");

    const storeItem = {
      id: "item-lock-fail",
      variants: null,
      quantity: 10,
      updatedAt: new Date(),
    };

    mockPrisma.storeItem.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.storeItem.findUnique.mockResolvedValue({
      ...storeItem,
      updatedAt: new Date(),
    });

    await expect(
      applyStoreItemDecrementAfterSale(
        { storeItem: mockPrisma.storeItem } as any,
        storeItem,
        { quantity: 1, variant: null }
      )
    ).rejects.toThrow(ConcurrentModificationError);
  });
});

describe("eBay passthrough sync (imported listings)", () => {
  it("detects imported eBay link by inw SKU for passthrough path", async () => {
    const { isImportedEbayLink } = await import("@/lib/channels/ebay/listing-origin");
    const { buildPassthroughInventoryBody } = await import("@/lib/channels/ebay/passthrough-push");

    expect(
      isImportedEbayLink({ provider: "ebay", externalListingId: "inw403004607151" })
    ).toBe(true);

    const live = {
      condition: "LIKE_NEW",
      product: {
        aspects: {
          Certification: ["NGC"],
          Grade: ["MS 67"],
          "Letter grade": ["MS"],
        },
      },
    };
    const item = {
      id: "cmsz85hpj0001ahwfa2pmvtun",
      title: "1938 Jefferson Nickel",
      description: null,
      priceCents: 12500,
      quantity: 2,
      photos: [],
      condition: "used" as const,
      ebayConditionEnum: null,
      ebayCategoryId: 41087,
      aspects: [],
      variants: null,
      category: null,
      status: "active" as const,
      sku: null,
    };
    const body = buildPassthroughInventoryBody(live, item, {
      content: false,
      quantity: true,
      price: false,
    });
    const aspects = (body.product as Record<string, unknown>).aspects as Record<string, string[]>;
    expect(aspects["Letter grade"]).toEqual(["MS"]);
    expect(body.availability).toEqual({ shipToLocationAvailability: { quantity: 2 } });
  });
});
