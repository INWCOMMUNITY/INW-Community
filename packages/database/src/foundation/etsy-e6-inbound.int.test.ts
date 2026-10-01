import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMember, createStoreItem, createVariant } from "./fixtures";
import { foundationTestDatabaseUrl } from "./local-url";
import { persistEtsyInstall } from "../etsy/connection";
import { applyEtsyListingContentInbound } from "../etsy/content-inbound";
import { createEtsyImportedListingMapping } from "../etsy/import-mapping";
import { etsyProductContentFingerprint, etsyVariantContentFingerprint } from "../etsy/content-fingerprint";
import { persistShopifyInstall } from "../shopify/connection";
import { createShopifyListingMapping } from "../shopify/mapping";

let prisma: PrismaClient;

beforeAll(() => {
  prisma = new PrismaClient({
    datasources: { db: { url: foundationTestDatabaseUrl() } },
    log: ["error"],
  });
});

afterAll(async () => {
  await prisma?.$disconnect();
});

describe("etsy E6 inbound listing content", () => {
  it("applies REMOTE_ONLY to StoreItem and records Shopify desire without Etsy outbound job", async () => {
    const seller = await createMember(prisma, "etsy-e6");
    const shopId = `9${seller.id.replace(/\D/g, "").slice(-7) || "3344556"}`;
    const etsyConn = await persistEtsyInstall(prisma, {
      memberId: seller.id,
      etsyUserId: `6${shopId.slice(-6)}`,
      shopId,
      shopName: "Poll Shop",
      accessTokenEncrypted: "cipher-a",
      refreshTokenEncrypted: "cipher-r",
      accessTokenExpiresAt: new Date("2026-09-30T13:00:00Z"),
      refreshTokenExpiresAt: new Date("2026-12-29T00:00:00Z"),
      grantedScopes: "listings_r listings_w shops_r transactions_r",
    });

    const item = await createStoreItem(prisma, seller.id, "Local Title", {
      priceCents: 1000,
      sku: "E6-SKU",
    });
    await prisma.storeItem.update({
      where: { id: item.id },
      data: { description: "Local desc", photos: [] },
    });
    const variant = await createVariant(prisma, {
      memberId: seller.id,
      storeItemId: item.id,
      isDefault: true,
      sku: "E6-SKU",
      priceCents: 1000,
    });

    const listingId = `77${shopId.slice(-5)}`;
    const mapping = await createEtsyImportedListingMapping(prisma, {
      memberId: seller.id,
      connectionId: etsyConn.id,
      storeItemId: item.id,
      etsyListingId: listingId,
      remoteListingState: "active",
      importBootstrapStartedAt: new Date("2026-09-30T12:00:00Z"),
      variants: [
        {
          storeVariantId: variant.id,
          etsyProductId: "801",
          etsyOfferingId: "802",
          remoteSku: "E6-SKU",
          remoteAvailable: 2,
        },
      ],
    });

    // Seed applied fingerprints so remote-only is detectable.
    const baseProduct = etsyProductContentFingerprint({
      title: "Local Title",
      description: "Local desc",
      photos: [],
    });
    const baseVariant = etsyVariantContentFingerprint({ priceCents: 1000, sku: "E6-SKU" });
    await prisma.etsyListingLink.update({
      where: { id: mapping.listingLinkId },
      data: {
        appliedProductFingerprint: baseProduct,
        desiredProductFingerprint: baseProduct,
        appliedProductContentVersion: 1,
        desiredProductContentVersion: 1,
      },
    });
    await prisma.etsyVariantMap.updateMany({
      where: { etsyListingLinkId: mapping.listingLinkId },
      data: {
        appliedVariantFingerprint: baseVariant,
        desiredVariantFingerprint: baseVariant,
        appliedVariantContentVersion: 1,
        desiredVariantContentVersion: 1,
      },
    });

    const shopDomain = `e6-${seller.id.slice(-8)}.myshopify.com`;
    const shopifyConn = await persistShopifyInstall(prisma, {
      memberId: seller.id,
      shopDomain,
      shopId: `gid://shopify/Shop/${seller.id.replace(/\D/g, "").slice(0, 8) || "6601"}`,
      accessTokenEncrypted: "cipher-access",
      refreshTokenEncrypted: "cipher-refresh",
      accessTokenExpiresAt: new Date("2099-01-01T00:00:00Z"),
      refreshTokenExpiresAt: new Date("2099-06-01T00:00:00Z"),
      grantedScopes: "write_products,write_inventory,read_orders,read_locations",
      primaryLocationId: "gid://shopify/Location/1",
      connectedAt: new Date("2026-09-25T12:00:00Z"),
    });
    await createShopifyListingMapping(prisma, {
      memberId: seller.id,
      connectionId: shopifyConn.id,
      storeItemId: item.id,
      shopifyProductId: `gid://shopify/Product/${listingId}`,
      variants: [
        {
          storeVariantId: variant.id,
          shopifyVariantId: `gid://shopify/ProductVariant/${listingId}`,
          shopifyInventoryItemId: `gid://shopify/InventoryItem/${listingId}`,
        },
      ],
    });

    const beforeEtsyJobs = await prisma.etsySyncJob.count({
      where: { etsyConnectionId: etsyConn.id, kind: "UPDATE_LISTING_CONTENT" },
    });
    const beforeShopifyJobs = await prisma.shopifySyncJob.count({
      where: { shopifyConnectionId: shopifyConn.id, kind: "UPDATE_LISTING_CONTENT" },
    });

    const result = await prisma.$transaction((tx) =>
      applyEtsyListingContentInbound(tx, {
        connectionId: etsyConn.id,
        memberId: seller.id,
        listingLinkId: mapping.listingLinkId,
        remote: {
          etsyListingId: listingId,
          title: "Remote Title",
          description: "Remote desc",
          photos: ["https://cdn.example/remote.jpg"],
          variants: [
            {
              etsyProductId: "801",
              etsyOfferingId: "802",
              priceCents: 2200,
              sku: "E6-REMOTE",
            },
          ],
        },
      })
    );

    expect(result.status).toBe("APPLIED");
    if (result.status === "APPLIED") {
      expect(result.productClass).toBe("REMOTE_ONLY");
      expect(result.shopifyDesireRecorded).toBe(true);
    }

    const updated = await prisma.storeItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(updated.title).toBe("Remote Title");
    expect(updated.description).toBe("Remote desc");
    expect(updated.priceCents).toBe(2200);
    expect(updated.sku).toBe("E6-REMOTE");

    expect(
      await prisma.etsySyncJob.count({
        where: { etsyConnectionId: etsyConn.id, kind: "UPDATE_LISTING_CONTENT" },
      })
    ).toBe(beforeEtsyJobs);

    expect(
      await prisma.shopifySyncJob.count({
        where: { shopifyConnectionId: shopifyConn.id, kind: "UPDATE_LISTING_CONTENT" },
      })
    ).toBeGreaterThan(beforeShopifyJobs);
  });

  it("does not rewrite StoreItem on LOCAL_ONLY echo", async () => {
    const seller = await createMember(prisma, "etsy-e6b");
    const shopId = `8${seller.id.replace(/\D/g, "").slice(-7) || "4455667"}`;
    const etsyConn = await persistEtsyInstall(prisma, {
      memberId: seller.id,
      etsyUserId: `7${shopId.slice(-6)}`,
      shopId,
      shopName: "Echo Shop",
      accessTokenEncrypted: "cipher-a",
      refreshTokenEncrypted: "cipher-r",
      accessTokenExpiresAt: new Date("2026-09-30T13:00:00Z"),
      refreshTokenExpiresAt: new Date("2026-12-29T00:00:00Z"),
      grantedScopes: "listings_r listings_w shops_r transactions_r",
    });
    const item = await createStoreItem(prisma, seller.id, "Desired Title", {
      priceCents: 1500,
      sku: "ECHO",
    });
    await prisma.storeItem.update({
      where: { id: item.id },
      data: { description: "Desired" },
    });
    const variant = await createVariant(prisma, {
      memberId: seller.id,
      storeItemId: item.id,
      isDefault: true,
      sku: "ECHO",
      priceCents: 1500,
    });
    const listingId = `88${shopId.slice(-5)}`;
    const mapping = await createEtsyImportedListingMapping(prisma, {
      memberId: seller.id,
      connectionId: etsyConn.id,
      storeItemId: item.id,
      etsyListingId: listingId,
      remoteListingState: "active",
      importBootstrapStartedAt: new Date("2026-09-30T12:00:00Z"),
      variants: [
        {
          storeVariantId: variant.id,
          etsyProductId: "901",
          etsyOfferingId: "902",
          remoteSku: "ECHO",
          remoteAvailable: 1,
        },
      ],
    });

    const appliedProduct = etsyProductContentFingerprint({
      title: "Old",
      description: "Old",
      photos: [],
    });
    const desiredProduct = etsyProductContentFingerprint({
      title: "Desired Title",
      description: "Desired",
      photos: [],
    });
    await prisma.etsyListingLink.update({
      where: { id: mapping.listingLinkId },
      data: {
        appliedProductFingerprint: appliedProduct,
        desiredProductFingerprint: desiredProduct,
        appliedProductContentVersion: 1,
        desiredProductContentVersion: 2,
      },
    });

    const result = await prisma.$transaction((tx) =>
      applyEtsyListingContentInbound(tx, {
        connectionId: etsyConn.id,
        memberId: seller.id,
        listingLinkId: mapping.listingLinkId,
        remote: {
          etsyListingId: listingId,
          title: "Old",
          description: "Old",
          photos: [],
          variants: [
            {
              etsyProductId: "901",
              etsyOfferingId: "902",
              priceCents: 1500,
              sku: "ECHO",
            },
          ],
        },
      })
    );

    expect(result.status).toBe("OBSERVED");
    if (result.status === "OBSERVED") expect(result.productClass).toBe("LOCAL_ONLY");
    const unchanged = await prisma.storeItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(unchanged.title).toBe("Desired Title");
  });

  it("rolls StoreItem.priceCents to min ACTIVE variant after multi-variant REMOTE_ONLY price pull", async () => {
    const seller = await createMember(prisma, "etsy-e6-mv-price");
    const shopId = `7${seller.id.replace(/\D/g, "").slice(-7) || "5566778"}`;
    const etsyConn = await persistEtsyInstall(prisma, {
      memberId: seller.id,
      etsyUserId: `8${shopId.slice(-6)}`,
      shopId,
      shopName: "MV Price Shop",
      accessTokenEncrypted: "cipher-a",
      refreshTokenEncrypted: "cipher-r",
      accessTokenExpiresAt: new Date("2026-09-30T13:00:00Z"),
      refreshTokenExpiresAt: new Date("2026-12-29T00:00:00Z"),
      grantedScopes: "listings_r listings_w shops_r transactions_r",
    });

    // Stale listing facade (600) while variants are cheaper — mirrors Bro drift.
    const item = await createStoreItem(prisma, seller.id, "MV Price Item", {
      priceCents: 600,
      sku: null,
    });
    await prisma.storeItem.update({
      where: { id: item.id },
      data: { description: "MV", photos: [] },
    });
    const vSmall = await createVariant(prisma, {
      memberId: seller.id,
      storeItemId: item.id,
      isDefault: true,
      sku: null,
      priceCents: 300,
      options: { Size: "Small" },
    });
    const vLarge = await createVariant(prisma, {
      memberId: seller.id,
      storeItemId: item.id,
      isDefault: false,
      sku: null,
      priceCents: 500,
      options: { Size: "Large" },
    });

    const listingId = `99${shopId.slice(-5)}`;
    const mapping = await createEtsyImportedListingMapping(prisma, {
      memberId: seller.id,
      connectionId: etsyConn.id,
      storeItemId: item.id,
      etsyListingId: listingId,
      remoteListingState: "active",
      importBootstrapStartedAt: new Date("2026-09-30T12:00:00Z"),
      variants: [
        {
          storeVariantId: vSmall.id,
          etsyProductId: "1001",
          etsyOfferingId: "1002",
          remoteSku: null,
          remoteAvailable: 2,
        },
        {
          storeVariantId: vLarge.id,
          etsyProductId: "1003",
          etsyOfferingId: "1004",
          remoteSku: null,
          remoteAvailable: 2,
        },
      ],
    });

    const baseProduct = etsyProductContentFingerprint({
      title: "MV Price Item",
      description: "MV",
      photos: [],
    });
    const baseSmall = etsyVariantContentFingerprint({ priceCents: 300, sku: null });
    const baseLarge = etsyVariantContentFingerprint({ priceCents: 500, sku: null });
    await prisma.etsyListingLink.update({
      where: { id: mapping.listingLinkId },
      data: {
        appliedProductFingerprint: baseProduct,
        desiredProductFingerprint: baseProduct,
        appliedProductContentVersion: 1,
        desiredProductContentVersion: 1,
      },
    });
    await prisma.etsyVariantMap.updateMany({
      where: { etsyListingLinkId: mapping.listingLinkId, storeVariantId: vSmall.id },
      data: {
        appliedVariantFingerprint: baseSmall,
        desiredVariantFingerprint: baseSmall,
        appliedVariantContentVersion: 1,
        desiredVariantContentVersion: 1,
      },
    });
    await prisma.etsyVariantMap.updateMany({
      where: { etsyListingLinkId: mapping.listingLinkId, storeVariantId: vLarge.id },
      data: {
        appliedVariantFingerprint: baseLarge,
        desiredVariantFingerprint: baseLarge,
        appliedVariantContentVersion: 1,
        desiredVariantContentVersion: 1,
      },
    });

    const result = await prisma.$transaction((tx) =>
      applyEtsyListingContentInbound(tx, {
        connectionId: etsyConn.id,
        memberId: seller.id,
        listingLinkId: mapping.listingLinkId,
        remote: {
          etsyListingId: listingId,
          title: "MV Price Item",
          description: "MV",
          photos: [],
          variants: [
            {
              etsyProductId: "1001",
              etsyOfferingId: "1002",
              priceCents: 350,
              sku: null,
              options: { Size: "Small" },
            },
            {
              etsyProductId: "1003",
              etsyOfferingId: "1004",
              priceCents: 550,
              sku: null,
              options: { Size: "Large" },
            },
          ],
        },
      })
    );

    expect(result.status).toBe("APPLIED");
    const updatedSmall = await prisma.storeVariant.findUniqueOrThrow({ where: { id: vSmall.id } });
    const updatedLarge = await prisma.storeVariant.findUniqueOrThrow({ where: { id: vLarge.id } });
    expect(updatedSmall.priceCents).toBe(350);
    expect(updatedLarge.priceCents).toBe(550);

    const updatedItem = await prisma.storeItem.findUniqueOrThrow({ where: { id: item.id } });
    // Listing facade must follow min ACTIVE variant so Airport price column moves with Etsy edits.
    expect(updatedItem.priceCents).toBe(350);
  });
});
