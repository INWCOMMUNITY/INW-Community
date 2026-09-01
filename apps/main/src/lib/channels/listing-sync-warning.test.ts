import { describe, expect, it } from "vitest";
import { listingChannelSyncWarning, withListingChannelSyncWarning } from "./listing-sync-warning";

describe("listingChannelSyncWarning", () => {
  it("flags listings when the store connection is in error", () => {
    expect(
      listingChannelSyncWarning({
        provider: "ebay",
        syncStatus: "synced",
        syncEnabled: true,
        connectionStatus: "error",
      })
    ).toMatch(/reconnect/i);
  });

  it("flags listings when the store is disconnected", () => {
    expect(
      listingChannelSyncWarning({
        provider: "etsy",
        syncStatus: "synced",
        syncEnabled: true,
        connectionStatus: "disconnected",
      })
    ).toMatch(/disconnected/i);
  });

  it("keeps listing-specific errors after reconnect", () => {
    expect(
      listingChannelSyncWarning({
        provider: "ebay",
        syncStatus: "error",
        syncEnabled: true,
        syncError: "Picture policy",
        connectionStatus: "active",
      })
    ).toMatch(/Picture policy/);
  });

  it("is silent when the link is healthy", () => {
    expect(
      listingChannelSyncWarning({
        provider: "wix",
        syncStatus: "synced",
        syncEnabled: true,
        connectionStatus: "active",
      })
    ).toBeNull();
  });
});

describe("withListingChannelSyncWarning", () => {
  it("exposes the deleted shop so listing tags can hide immediately", () => {
    const mapped = withListingChannelSyncWarning({
      provider: "wix",
      syncStatus: "synced",
      syncEnabled: true,
      externalListingId: "prod-1",
      syncError: null,
      conflictDetails: { remoteDeleted: { provider: "wix", detectedAt: "2026-08-31T00:00:00.000Z" } },
      connection: { status: "active" },
    });
    expect(mapped.remoteDeletedProvider).toBe("wix");
    expect(mapped.syncStatus).toBe("synced");
  });

  it("exposes syncWarning and hides the nested connection object", () => {
    const mapped = withListingChannelSyncWarning({
      provider: "ebay",
      syncStatus: "synced",
      syncEnabled: true,
      externalListingId: "123",
      syncError: null,
      connection: { status: "error" },
    });
    expect(mapped.connectionStatus).toBe("error");
    expect(mapped.syncWarning).toMatch(/reconnect/i);
    expect(mapped).not.toHaveProperty("connection");
  });
});
