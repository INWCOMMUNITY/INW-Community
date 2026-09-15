import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = {
  channelListingLink: {
    count: vi.fn().mockResolvedValue(3),
  },
  channelConnection: {
    delete: vi.fn().mockResolvedValue({}),
  },
  channelSyncLog: {
    deleteMany: vi.fn().mockResolvedValue({ count: 10 }),
  },
  syncTrace: {
    deleteMany: vi.fn().mockResolvedValue({ count: 5 }),
  },
  channelSyncEvent: {
    deleteMany: vi.fn().mockResolvedValue({ count: 20 }),
  },
};

vi.mock("database", () => ({
  prisma: mockPrisma,
}));

vi.mock("@/lib/encrypt", () => ({
  decrypt: (v: string) => v,
}));

vi.mock("./ebay/commerce-notifications", () => ({
  disableEbayCommerceNotifications: vi.fn(),
}));

vi.mock("./ebay/trading", () => ({
  unsubscribeFromEbayNotifications: vi.fn().mockResolvedValue({ success: true }),
}));

describe("wipeDisconnectedChannel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.channelListingLink.count.mockResolvedValue(3);
  });

  it("deletes the connection row entirely (zero memory)", async () => {
    const { wipeDisconnectedChannel } = await import("./disconnect-channel");
    const result = await wipeDisconnectedChannel("conn-1");

    expect(result.linksDeleted).toBe(3);
    expect(result.connectionDeleted).toBe(true);
    expect(mockPrisma.channelConnection.delete).toHaveBeenCalledWith({
      where: { id: "conn-1" },
    });
  });

  it("purges historical data when memberId and provider are provided", async () => {
    const { wipeDisconnectedChannel } = await import("./disconnect-channel");
    const result = await wipeDisconnectedChannel("conn-1", {
      memberId: "member-123",
      provider: "ebay",
    });

    expect(result.historicalDataPurged).toBe(true);
    expect(mockPrisma.channelSyncLog.deleteMany).toHaveBeenCalledWith({
      where: { memberId: "member-123", provider: "ebay" },
    });
    expect(mockPrisma.syncTrace.deleteMany).toHaveBeenCalledWith({
      where: { memberId: "member-123", provider: "ebay" },
    });
  });

  it("skips historical data purge when memberId/provider not provided", async () => {
    const { wipeDisconnectedChannel } = await import("./disconnect-channel");
    const result = await wipeDisconnectedChannel("conn-1");

    expect(result.historicalDataPurged).toBe(false);
    expect(mockPrisma.channelSyncLog.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.syncTrace.deleteMany).not.toHaveBeenCalled();
  });

  it("handles Shopify app/uninstalled webhook with full purge", async () => {
    const { wipeDisconnectedChannel } = await import("./disconnect-channel");
    await wipeDisconnectedChannel("conn-shopify", {
      lastError: "Shopify app was uninstalled by the store owner.",
      memberId: "member-456",
      provider: "shopify",
    });

    expect(mockPrisma.channelConnection.delete).toHaveBeenCalledWith({
      where: { id: "conn-shopify" },
    });
    expect(mockPrisma.channelSyncLog.deleteMany).toHaveBeenCalledWith({
      where: { memberId: "member-456", provider: "shopify" },
    });
  });
});

describe("cleanupOldSyncEvents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.channelSyncEvent.deleteMany.mockResolvedValue({ count: 100 });
  });

  it("deletes sync events older than 30 days by default", async () => {
    const { cleanupOldSyncEvents } = await import("./disconnect-channel");
    const result = await cleanupOldSyncEvents();

    expect(result).toBe(100);
    expect(mockPrisma.channelSyncEvent.deleteMany).toHaveBeenCalledWith({
      where: {
        processedAt: { lt: expect.any(Date) },
      },
    });

    // Verify the cutoff date is approximately 30 days ago
    const callArgs = mockPrisma.channelSyncEvent.deleteMany.mock.calls[0][0];
    const cutoffDate = callArgs.where.processedAt.lt as Date;
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    expect(Math.abs(cutoffDate.getTime() - thirtyDaysAgo)).toBeLessThan(1000);
  });

  it("respects custom retention days", async () => {
    const { cleanupOldSyncEvents } = await import("./disconnect-channel");
    await cleanupOldSyncEvents(7);

    const callArgs = mockPrisma.channelSyncEvent.deleteMany.mock.calls[0][0];
    const cutoffDate = callArgs.where.processedAt.lt as Date;
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    expect(Math.abs(cutoffDate.getTime() - sevenDaysAgo)).toBeLessThan(1000);
  });
});

describe("releaseRemoteChannelBindings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns ok for Etsy (no remote bindings to release)", async () => {
    const { releaseRemoteChannelBindings } = await import("./disconnect-channel");
    const result = await releaseRemoteChannelBindings({
      provider: "etsy",
      accessToken: "etsy-token",
      config: {},
      externalShopId: "12345",
    });

    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("returns ok for Wix (no remote bindings to release)", async () => {
    const { releaseRemoteChannelBindings } = await import("./disconnect-channel");
    const result = await releaseRemoteChannelBindings({
      provider: "wix",
      accessToken: "wix-token",
      config: {},
      externalShopId: "site-id",
    });

    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("unsubscribes eBay notifications on disconnect", async () => {
    const { unsubscribeFromEbayNotifications } = await import("./ebay/trading");
    const { disableEbayCommerceNotifications } = await import("./ebay/commerce-notifications");
    const { releaseRemoteChannelBindings } = await import("./disconnect-channel");

    const result = await releaseRemoteChannelBindings({
      provider: "ebay",
      accessToken: "ebay-token",
      config: { commerceNotificationsDestinationId: "dest-123" },
      externalShopId: null,
    });

    expect(result.ok).toBe(true);
    expect(unsubscribeFromEbayNotifications).toHaveBeenCalledWith("ebay-token");
    expect(disableEbayCommerceNotifications).toHaveBeenCalledWith(
      "ebay-token",
      { commerceNotificationsDestinationId: "dest-123" }
    );
  });

  it("returns ok for unknown provider", async () => {
    const { releaseRemoteChannelBindings } = await import("./disconnect-channel");
    const result = await releaseRemoteChannelBindings({
      provider: "unknown",
      accessToken: "token",
      config: {},
      externalShopId: null,
    });

    expect(result.ok).toBe(true);
  });
});
