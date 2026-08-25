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
