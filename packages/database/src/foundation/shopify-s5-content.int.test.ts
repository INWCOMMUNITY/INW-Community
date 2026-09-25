import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMember, createStoreItem, createVariant } from "./fixtures";
import { foundationTestDatabaseUrl } from "./local-url";
import {
  disconnectShopifyConnection,
  persistShopifyInstall,
} from "../shopify/connection";
import {
  markShopifyProductContentApplied,
  markShopifyVariantContentApplied,
  recordShopifyListingContentDesire,
} from "../shopify/content-desire";
import {
  shopifyProductContentFingerprint,
  shopifyUpdateListingContentDedupeKey,
  shopifyVariantContentFingerprint,
} from "../shopify/content-fingerprint";
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

async function activeConnection(
  memberId: string,
  shop: string,
  connectedAt: Date,
  shopId: string
) {
  return persistShopifyInstall(prisma, {
    memberId,
    shopDomain: shop,
    shopId,
    accessTokenEncrypted: "cipher-access",
    refreshTokenEncrypted: "cipher-refresh",
    accessTokenExpiresAt: new Date("2026-09-24T02:00:00Z"),
    refreshTokenExpiresAt: new Date("2026-12-23T00:00:00Z"),
    grantedScopes: "write_products,write_inventory,read_orders,read_locations",
    primaryLocationId: "gid://shopify/Location/1",
    connectedAt,
  });
}

describe("shopify S5 outbound listing content desire", () => {
  it("captures field-group versions, durable jobs, ordering, generation isolation, and no inventory effect", async () => {
    const seller = await createMember(prisma, "s5");
    const shop = `s5-${seller.id.slice(-8)}.myshopify.com`;
    const shopId = `gid://shopify/Shop/${seller.id.replace(/\D/g, "").slice(0, 8) || "6501"}`;
    const item = await createStoreItem(prisma, seller.id, "S5 Title", {
      priceCents: 1000,
      sku: "S5-SKU",
    });
    await prisma.storeItem.update({
      where: { id: item.id },
      data: { description: "Original description" },
    });
    const variant = await createVariant(prisma, {
      memberId: seller.id,
      storeItemId: item.id,
      isDefault: true,
      sku: "S5-SKU",
      priceCents: 1000,
    });

    const beforeStates = await prisma.inventoryState.count();
    const beforeEvents = await prisma.inventoryEvent.count();
    const beforeOrders = await prisma.storeOrder.count();

    const gen1 = await activeConnection(
      seller.id,
      shop,
      new Date("2026-09-24T12:00:00Z"),
      shopId
    );

    await createShopifyListingMapping(prisma, {
      memberId: seller.id,
      connectionId: gen1.id,
      storeItemId: item.id,
      shopifyProductId: "gid://shopify/Product/500",
      variants: [
        {
          storeVariantId: variant.id,
          shopifyVariantId: "gid://shopify/ProductVariant/600",
          shopifyInventoryItemId: "gid://shopify/InventoryItem/700",
        },
      ],
    });

    const snapshot = async () => {
      const row = await prisma.storeItem.findUniqueOrThrow({ where: { id: item.id } });
      return {
        title: row.title,
        description: row.description,
        priceCents: row.priceCents,
        sku: row.sku,
      };
    };

    // 1) Title edit advances product desired version + durable job
    const beforeTitle = await snapshot();
    const titleEdit = await prisma.$transaction(async (tx) => {
      const updated = await tx.storeItem.update({
        where: { id: item.id },
        data: { title: "S5 Title v2" },
      });
      return recordShopifyListingContentDesire(tx, {
        memberId: seller.id,
        storeItemId: item.id,
        before: beforeTitle,
        after: {
          title: updated.title,
          description: updated.description,
          priceCents: updated.priceCents,
          sku: updated.sku,
        },
      });
    });
    expect(titleEdit).toMatchObject({
      status: "RECORDED",
      productDesiredVersion: 1,
      variantDesiredVersion: 0,
    });
    if (titleEdit.status !== "RECORDED") throw new Error("expected RECORDED");
    const linkAfterTitle = await prisma.shopifyListingLink.findUniqueOrThrow({
      where: { shopifyConnectionId_storeItemId: { shopifyConnectionId: gen1.id, storeItemId: item.id } },
    });
    expect(linkAfterTitle.desiredProductContentVersion).toBe(1);
    expect(linkAfterTitle.desiredProductFingerprint).toBe(
      shopifyProductContentFingerprint({ title: "S5 Title v2", description: "Original description" })
    );
    const titleJob = await prisma.shopifySyncJob.findUniqueOrThrow({
      where: { id: titleEdit.jobId },
    });
    expect(titleJob.kind).toBe("UPDATE_LISTING_CONTENT");
    expect(titleJob.dedupeKey).toBe(
      shopifyUpdateListingContentDedupeKey({
        connectionId: gen1.id,
        storeItemId: item.id,
        productDesiredVersion: 1,
        variantDesiredVersion: 0,
      })
    );
    expect(titleJob.payload).toEqual({
      storeItemId: item.id,
      storeVariantId: variant.id,
      productDesiredVersion: 1,
      variantDesiredVersion: 0,
    });
    expect(JSON.stringify(titleJob.payload)).not.toMatch(/shpat_|token|secret/i);

    // 2) Description edit advances product desired version
    const beforeDesc = await snapshot();
    const descEdit = await prisma.$transaction(async (tx) => {
      const updated = await tx.storeItem.update({
        where: { id: item.id },
        data: { description: "Updated description" },
      });
      return recordShopifyListingContentDesire(tx, {
        memberId: seller.id,
        storeItemId: item.id,
        before: beforeDesc,
        after: {
          title: updated.title,
          description: updated.description,
          priceCents: updated.priceCents,
          sku: updated.sku,
        },
      });
    });
    expect(descEdit).toMatchObject({ status: "RECORDED", productDesiredVersion: 2, variantDesiredVersion: 0 });

    // 3) Price edit advances variant desired version (+ mirrors StoreVariant)
    const beforePrice = await snapshot();
    const priceEdit = await prisma.$transaction(async (tx) => {
      const updated = await tx.storeItem.update({
        where: { id: item.id },
        data: { priceCents: 1037 },
      });
      return recordShopifyListingContentDesire(tx, {
        memberId: seller.id,
        storeItemId: item.id,
        before: beforePrice,
        after: {
          title: updated.title,
          description: updated.description,
          priceCents: updated.priceCents,
          sku: updated.sku,
        },
      });
    });
    expect(priceEdit).toMatchObject({
      status: "RECORDED",
      productDesiredVersion: 2,
      variantDesiredVersion: 1,
      syncedVariantPriceSku: true,
    });
    const variantAfterPrice = await prisma.storeVariant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(variantAfterPrice.priceCents).toBe(1037);

    // 4) SKU edit advances variant desired version
    const beforeSku = await snapshot();
    const skuEdit = await prisma.$transaction(async (tx) => {
      const updated = await tx.storeItem.update({
        where: { id: item.id },
        data: { sku: "S5-SKU-2" },
      });
      return recordShopifyListingContentDesire(tx, {
        memberId: seller.id,
        storeItemId: item.id,
        before: beforeSku,
        after: {
          title: updated.title,
          description: updated.description,
          priceCents: updated.priceCents,
          sku: updated.sku,
        },
      });
    });
    expect(skuEdit).toMatchObject({ status: "RECORDED", productDesiredVersion: 2, variantDesiredVersion: 2 });

    // 5) Unrelated field edit does not enqueue S5 work
    const beforeUnrelated = await snapshot();
    const jobsBeforeUnrelated = await prisma.shopifySyncJob.count({
      where: { shopifyConnectionId: gen1.id, kind: "UPDATE_LISTING_CONTENT" },
    });
    const unrelated = await prisma.$transaction(async (tx) => {
      const updated = await tx.storeItem.update({
        where: { id: item.id },
        data: { category: "Widgets" },
      });
      return recordShopifyListingContentDesire(tx, {
        memberId: seller.id,
        storeItemId: item.id,
        before: beforeUnrelated,
        after: {
          title: updated.title,
          description: updated.description,
          priceCents: updated.priceCents,
          sku: updated.sku,
        },
      });
    });
    expect(unrelated).toEqual({ status: "SKIPPED", reason: "NO_CONTENT_CHANGE" });
    expect(
      await prisma.shopifySyncJob.count({
        where: { shopifyConnectionId: gen1.id, kind: "UPDATE_LISTING_CONTENT" },
      })
    ).toBe(jobsBeforeUnrelated);

    // 6) Unmapped listing edit does not create mapping/product
    const unmappedItem = await createStoreItem(prisma, seller.id, "Unmapped", { priceCents: 500 });
    const beforeUnmapped = {
      title: unmappedItem.title,
      description: unmappedItem.description,
      priceCents: unmappedItem.priceCents,
      sku: unmappedItem.sku,
    };
    const unmappedResult = await prisma.$transaction(async (tx) => {
      const updated = await tx.storeItem.update({
        where: { id: unmappedItem.id },
        data: { title: "Unmapped v2" },
      });
      return recordShopifyListingContentDesire(tx, {
        memberId: seller.id,
        storeItemId: unmappedItem.id,
        before: beforeUnmapped,
        after: {
          title: updated.title,
          description: updated.description,
          priceCents: updated.priceCents,
          sku: updated.sku,
        },
      });
    });
    expect(unmappedResult).toEqual({ status: "SKIPPED", reason: "UNMAPPED" });
    expect(
      await prisma.shopifyListingLink.count({
        where: { storeItemId: unmappedItem.id },
      })
    ).toBe(0);

    // 7) Inactive connection does not produce executable outbound work
    await disconnectShopifyConnection(prisma, {
      memberId: seller.id,
      connectionId: gen1.id,
    });
    const beforeInactive = await snapshot();
    const inactiveResult = await prisma.$transaction(async (tx) => {
      const updated = await tx.storeItem.update({
        where: { id: item.id },
        data: { title: "Should not enqueue" },
      });
      return recordShopifyListingContentDesire(tx, {
        memberId: seller.id,
        storeItemId: item.id,
        before: beforeInactive,
        after: {
          title: updated.title,
          description: updated.description,
          priceCents: updated.priceCents,
          sku: updated.sku,
        },
      });
    });
    expect(inactiveResult).toEqual({ status: "SKIPPED", reason: "CONNECTION_INACTIVE" });

    // Generation 2 reconnect — independent versions; gen1 jobs remain gen1-bound
    const gen2 = await activeConnection(
      seller.id,
      shop,
      new Date("2026-09-24T14:00:00Z"),
      shopId
    );
    expect(gen2.generation).toBe(2);
    expect(gen2.id).not.toBe(gen1.id);

    await createShopifyListingMapping(prisma, {
      memberId: seller.id,
      connectionId: gen2.id,
      storeItemId: item.id,
      shopifyProductId: "gid://shopify/Product/501",
      variants: [
        {
          storeVariantId: variant.id,
          shopifyVariantId: "gid://shopify/ProductVariant/601",
          shopifyInventoryItemId: "gid://shopify/InventoryItem/701",
        },
      ],
    });

    const gen2Link = await prisma.shopifyListingLink.findUniqueOrThrow({
      where: {
        shopifyConnectionId_storeItemId: { shopifyConnectionId: gen2.id, storeItemId: item.id },
      },
    });
    expect(gen2Link.desiredProductContentVersion).toBe(0);
    expect(gen2Link.appliedProductContentVersion).toBe(0);

    const beforeGen2 = await snapshot();
    const gen2Edit = await prisma.$transaction(async (tx) => {
      const updated = await tx.storeItem.update({
        where: { id: item.id },
        data: { title: "Gen2 Title" },
      });
      return recordShopifyListingContentDesire(tx, {
        memberId: seller.id,
        storeItemId: item.id,
        before: beforeGen2,
        after: {
          title: updated.title,
          description: updated.description,
          priceCents: updated.priceCents,
          sku: updated.sku,
        },
      });
    });
    expect(gen2Edit).toMatchObject({
      status: "RECORDED",
      connectionId: gen2.id,
      productDesiredVersion: 1,
    });
    if (gen2Edit.status !== "RECORDED") throw new Error("expected RECORDED");
    const gen2Job = await prisma.shopifySyncJob.findUniqueOrThrow({ where: { id: gen2Edit.jobId } });
    expect(gen2Job.shopifyConnectionId).toBe(gen2.id);
    expect(gen2Job.dedupeKey).toContain(gen2.id);
    expect(titleJob.shopifyConnectionId).toBe(gen1.id);
    expect(titleJob.shopifyConnectionId).not.toBe(gen2.id);

    // Applied markers never move backwards
    await markShopifyProductContentApplied(prisma, {
      listingLinkId: gen2Link.id,
      desiredVersion: 1,
      fingerprint: shopifyProductContentFingerprint({
        title: "Gen2 Title",
        description: beforeGen2.description,
      }),
    });
    await markShopifyProductContentApplied(prisma, {
      listingLinkId: gen2Link.id,
      desiredVersion: 0,
      fingerprint: "should-not-apply",
    });
    const afterBackward = await prisma.shopifyListingLink.findUniqueOrThrow({
      where: { id: gen2Link.id },
    });
    expect(afterBackward.appliedProductContentVersion).toBe(1);
    expect(afterBackward.appliedProductFingerprint).not.toBe("should-not-apply");

    const vmap = await prisma.shopifyVariantMap.findFirstOrThrow({
      where: { shopifyConnectionId: gen2.id, storeVariantId: variant.id },
    });
    const variantFp = shopifyVariantContentFingerprint({
      priceCents: 1037,
      sku: "S5-SKU-2",
    });
    await markShopifyVariantContentApplied(prisma, {
      variantMapId: vmap.id,
      desiredVersion: 1,
      fingerprint: variantFp,
    });
    const afterVariantApply = await prisma.shopifyVariantMap.findUniqueOrThrow({
      where: { id: vmap.id },
    });
    expect(afterVariantApply.appliedVariantContentVersion).toBe(1);
    expect(afterVariantApply.appliedVariantFingerprint).toBe(variantFp);

    // Echo fingerprint equality for S6 preparation
    const observedProduct = shopifyProductContentFingerprint({
      title: "Gen2 Title",
      description: beforeGen2.description,
    });
    expect(observedProduct).toBe(afterBackward.appliedProductFingerprint);
    expect(
      shopifyProductContentFingerprint({
        title: "Independent Shopify edit",
        description: beforeGen2.description,
      })
    ).not.toBe(afterBackward.appliedProductFingerprint);

    // Dedupe: same desired versions enqueue once
    const again = await recordShopifyListingContentDesire(prisma, {
      memberId: seller.id,
      storeItemId: item.id,
      before: {
        title: "Gen2 Title",
        description: beforeGen2.description,
        priceCents: 1037,
        sku: "S5-SKU-2",
      },
      after: {
        title: "Gen2 Title",
        description: beforeGen2.description,
        priceCents: 1037,
        sku: "S5-SKU-2",
      },
    });
    expect(again).toEqual({ status: "SKIPPED", reason: "NO_CONTENT_CHANGE" });

    expect(await prisma.inventoryState.count()).toBe(beforeStates);
    expect(await prisma.inventoryEvent.count()).toBe(beforeEvents);
    expect(await prisma.storeOrder.count()).toBe(beforeOrders);
  });
});
