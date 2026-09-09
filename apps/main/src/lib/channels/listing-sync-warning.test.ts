import { describe, expect, it } from "vitest";
import {
  channelLinkShowsOnItem,
  listingChannelSyncWarning,
  listingVariantChannelWarnings,
  withListingChannelSyncWarning,
} from "./listing-sync-warning";

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

  it("does not flag listings after an intentional store disconnect", () => {
    expect(
      listingChannelSyncWarning({
        provider: "etsy",
        syncStatus: "synced",
        syncEnabled: true,
        connectionStatus: "disconnected",
      })
    ).toBeNull();
  });

  it("hides the shop tag after an intentional store disconnect", () => {
    expect(
      channelLinkShowsOnItem({ connectionStatus: "disconnected" })
    ).toBe(false);
    expect(channelLinkShowsOnItem({ connectionStatus: "active" })).toBe(true);
  });

  it("hides the eBay tag when the listing is ended or inactive on that shop", () => {
    expect(channelLinkShowsOnItem({ ebayListingEnded: true })).toBe(false);
    expect(channelLinkShowsOnItem({ remoteCatalogState: "inactive" })).toBe(false);
    expect(channelLinkShowsOnItem({ remoteCatalogState: "inactive_outside_catalog" })).toBe(false);
    expect(channelLinkShowsOnItem({ remoteCatalogState: "linked_other_channel" })).toBe(false);
    expect(channelLinkShowsOnItem({ connectionStatus: "active" })).toBe(true);
  });

  it("hides the eBay tag until the link has a live eBay Item ID", () => {
    expect(
      channelLinkShowsOnItem({
        provider: "ebay",
        connectionStatus: "active",
      })
    ).toBe(false);
    expect(
      channelLinkShowsOnItem({
        provider: "ebay",
        externalListingId: "cmt7vumcl000dxjujvgwe8dobRedSmall",
        connectionStatus: "active",
      })
    ).toBe(false);
    expect(
      channelLinkShowsOnItem({
        provider: "ebay",
        externalListingId: "cmt7vumcl000dxjujvgwe8dob",
        connectionStatus: "active",
      })
    ).toBe(false);
    expect(
      channelLinkShowsOnItem({
        provider: "ebay",
        externalListingId: "407186363325",
        connectionStatus: "active",
      })
    ).toBe(true);
    expect(
      channelLinkShowsOnItem({
        provider: "ebay",
        externalListingId: "inw407186363325",
        connectionStatus: "active",
      })
    ).toBe(true);
  });

  it("hides eBay photo-host mix errors from the listing badge", () => {
    expect(
      listingChannelSyncWarning({
        provider: "ebay",
        syncStatus: "error",
        syncEnabled: true,
        syncError:
          "[#25014] A mixture of Self Hosted and EPS pictures are not allowed. — eBay already has these photos as eBay-hosted images",
        connectionStatus: "active",
      })
    ).toBeNull();
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

describe("listingVariantChannelWarnings", () => {
  it("allows Etsy on a three-axis listing under the 400-combo cap", () => {
    const notes = listingVariantChannelWarnings({
      variants: {
        axes: [
          { name: "Size", values: ["S"] },
          { name: "Color", values: ["Navy"] },
          { name: "Fit", values: ["Slim"] },
        ],
        skus: [{ options: { Size: "S", Color: "Navy", Fit: "Slim" }, quantity: 1 }],
      },
      linkedProviders: ["etsy"],
    });
    expect(notes.join(" ")).not.toMatch(/cannot be listed on Etsy/i);
  });

  it("warns when Shopify is over 100 combinations", () => {
    const sizes = Array.from({ length: 11 }, (_, i) => String(i));
    const colors = Array.from({ length: 10 }, (_, i) => String(i));
    const notes = listingVariantChannelWarnings({
      variants: {
        axes: [
          { name: "Size", values: sizes },
          { name: "Color", values: colors },
        ],
        skus: sizes.flatMap((s) =>
          colors.map((c) => ({ options: { Size: s, Color: c }, quantity: 1 }))
        ),
      },
      linkedProviders: ["shopify"],
    });
    expect(notes.join(" ")).toMatch(/cannot be listed on Shopify/i);
  });

  it("notes Wix does not carry per-color photos", () => {
    const notes = listingVariantChannelWarnings({
      variants: {
        axes: [
          {
            name: "Color",
            values: ["Navy"],
            photosByValue: { Navy: ["https://cdn.example/navy.jpg"] },
          },
        ],
        imageAxis: "Color",
        skus: [{ options: { Color: "Navy" }, quantity: 1, photos: ["https://cdn.example/navy.jpg"] }],
      },
      linkedProviders: ["wix"],
    });
    expect(notes.join(" ")).toMatch(/Wix will show the main gallery/i);
  });

  it("blocks Etsy when price/qty/SKU vary on all three properties above 400 combinations", () => {
    const a = Array.from({ length: 8 }, (_, i) => String(i));
    const b = Array.from({ length: 8 }, (_, i) => String(i));
    const c = Array.from({ length: 7 }, (_, i) => String(i));
    const notes = listingVariantChannelWarnings({
      variants: {
        axes: [
          { name: "Size", values: a },
          { name: "Color", values: b },
          { name: "Fit", values: c },
        ],
        pricesVary: true,
        quantitiesVary: true,
        skusVary: true,
        skus: a.flatMap((x) =>
          b.flatMap((y) => c.map((z) => ({ options: { Size: x, Color: y, Fit: z }, quantity: 1 })))
        ),
      },
      linkedProviders: ["etsy"],
    });
    expect(notes.join(" ")).toMatch(/cannot be listed on Etsy/i);
  });

  it("notes MTO placeholder quantity on eBay", () => {
    const notes = listingVariantChannelWarnings({
      variants: null,
      inventoryTracking: "made_to_order",
      linkedProviders: ["ebay"],
    });
    expect(notes.join(" ")).toMatch(/placeholder quantity/i);
  });
});

describe("withListingChannelSyncWarning", () => {
  it("does not warn reconnect after an intentional store disconnect", () => {
    const mapped = withListingChannelSyncWarning({
      provider: "etsy",
      syncStatus: "synced",
      syncEnabled: true,
      externalListingId: "123",
      syncError: null,
      connection: { status: "disconnected" },
    });
    expect(mapped.connectionStatus).toBe("disconnected");
    expect(mapped.syncWarning).toBeNull();
  });

  it("keeps the shop tag hidden after Keep on INW (dismissed remote delete)", () => {
    const mapped = withListingChannelSyncWarning({
      provider: "wix",
      syncStatus: "synced",
      syncEnabled: true,
      externalListingId: "prod-1",
      syncError: null,
      conflictDetails: {
        remoteDeleted: {
          provider: "wix",
          detectedAt: "2026-08-31T00:00:00.000Z",
          dismissedAt: "2026-08-31T01:00:00.000Z",
        },
      },
      connection: { status: "active" },
    });
    expect(mapped.remoteDeletedProvider).toBe("wix");
  });

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

  it("exposes ended eBay and inactive catalog so listing banners can hide", () => {
    const ended = withListingChannelSyncWarning({
      provider: "ebay",
      syncStatus: "synced",
      syncEnabled: true,
      externalListingId: "123",
      syncError: null,
      conflictDetails: { ebayListingEnded: true },
      connection: { status: "active" },
    });
    expect(ended.ebayListingEnded).toBe(true);
    expect(channelLinkShowsOnItem(ended)).toBe(false);

    const inactive = withListingChannelSyncWarning({
      provider: "etsy",
      syncStatus: "synced",
      syncEnabled: true,
      externalListingId: "456",
      syncError: null,
      conflictDetails: { remoteCatalogState: "inactive" },
      connection: { status: "active" },
    });
    expect(inactive.remoteCatalogState).toBe("inactive");
    expect(channelLinkShowsOnItem(inactive)).toBe(false);
  });

  it("hides shop tags from Prisma-shaped links that only have conflictDetails", () => {
    expect(
      channelLinkShowsOnItem({
        provider: "ebay",
        conflictDetails: { ebayListingEnded: true },
        connection: { status: "active" },
      })
    ).toBe(false);
    expect(
      channelLinkShowsOnItem({
        provider: "etsy",
        conflictDetails: { remoteCatalogState: "inactive" },
        connection: { status: "active" },
      })
    ).toBe(false);
    expect(
      channelLinkShowsOnItem({
        provider: "wix",
        conflictDetails: null,
        connection: { status: "disconnected" },
      })
    ).toBe(false);
  });
});
