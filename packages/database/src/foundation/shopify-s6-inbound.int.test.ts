import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMember, createStoreItem, createVariant } from "./fixtures";
import { foundationTestDatabaseUrl } from "./local-url";
import {
  disconnectShopifyConnection,
  persistShopifyInstall,
} from "../shopify/connection";
import {
  applyShopifyProductsUpdateObservation,
  markShopifyEvidenceIgnored,
} from "../shopify/content-inbound";
import { recordShopifyListingContentDesire } from "../shopify/content-desire";
import {
  shopifyProductContentFingerprint,
  shopifyUpdateListingContentDedupeKey,
  shopifyVariantContentFingerprint,
} from "../shopify/content-fingerprint";
import { createShopifyListingMapping } from "../shopify/mapping";
import { hashShopifyWebhookPayload } from "../shopify/evidence";

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

async function createEvidence(input: {
  connectionId: string;
  shopDomain: string;
  webhookId: string;
  productId: string;
}) {
  const rawBody = JSON.stringify({
    admin_graphql_api_id: input.productId,
    id: Number(input.productId.split("/").pop()),
    myshopify_domain: input.shopDomain,
  });
  return prisma.shopifyProviderEvidence.create({
    data: {
      shopifyConnectionId: input.connectionId,
      shopDomain: input.shopDomain,
      topic: "products/update",
      webhookId: input.webhookId,
      triggeredAt: new Date("2026-09-25T12:00:00Z"),
      rawBody,
      payloadHash: hashShopifyWebhookPayload(rawBody),
      processState: "RECEIVED",
    },
  });
}

describe("shopify S6 inbound products/update observation", () => {
  it("handles echo, remote/local wins, split winners, races, generation, and no inventory", async () => {
    const seller = await createMember(prisma, "s6");
    const shop = `s6-${seller.id.slice(-8)}.myshopify.com`;
    const shopId = `gid://shopify/Shop/${seller.id.replace(/\D/g, "").slice(0, 8) || "7601"}`;
    const item = await createStoreItem(prisma, seller.id, "S6 Title", {
      priceCents: 1000,
      sku: "S6-SKU",
    });
    await prisma.storeItem.update({
      where: { id: item.id },
      data: { description: "Original description" },
    });
    const variant = await createVariant(prisma, {
      memberId: seller.id,
      storeItemId: item.id,
      isDefault: true,
      sku: "S6-SKU",
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
      shopifyProductId: "gid://shopify/Product/900",
      variants: [
        {
          storeVariantId: variant.id,
          shopifyVariantId: "gid://shopify/ProductVariant/800",
          shopifyInventoryItemId: "gid://shopify/InventoryItem/700",
        },
      ],
    });
    const listing = await prisma.shopifyListingLink.findUniqueOrThrow({
      where: {
        shopifyConnectionId_storeItemId: { shopifyConnectionId: gen1.id, storeItemId: item.id },
      },
    });
    const variantMap = await prisma.shopifyVariantMap.findFirstOrThrow({
      where: { shopifyListingLinkId: listing.id },
    });

    // Local S5 title edit
    const before = {
      title: "S6 Title",
      description: "Original description",
      priceCents: 1000,
      sku: "S6-SKU",
    };
    const desire = await prisma.$transaction(async (tx) => {
      const updated = await tx.storeItem.update({
        where: { id: item.id },
        data: { title: "INW Title v2" },
      });
      return recordShopifyListingContentDesire(tx, {
        memberId: seller.id,
        storeItemId: item.id,
        before,
        after: {
          title: updated.title,
          description: updated.description,
          priceCents: updated.priceCents,
          sku: updated.sku,
        },
      });
    });
    expect(desire).toMatchObject({ status: "RECORDED", productDesiredVersion: 1 });
    const afterDesire = await prisma.shopifyListingLink.findUniqueOrThrow({ where: { id: listing.id } });
    expect(afterDesire.productDesiredAt).toBeTruthy();
    expect(afterDesire.desiredProductFingerprint).toBe(
      shopifyProductContentFingerprint({ title: "INW Title v2", description: "Original description" })
    );

    // Mark applied as if S5 outbound succeeded
    await prisma.shopifyListingLink.update({
      where: { id: listing.id },
      data: {
        appliedProductContentVersion: 1,
        appliedProductFingerprint: afterDesire.desiredProductFingerprint,
        productContentAppliedAt: new Date(),
      },
    });

    const jobsBefore = await prisma.shopifySyncJob.count({
      where: { shopifyConnectionId: gen1.id, kind: "UPDATE_LISTING_CONTENT" },
    });

    // SELF ECHO
    const echoEvidence = await createEvidence({
      connectionId: gen1.id,
      shopDomain: shop,
      webhookId: `wh-echo-${seller.id}`,
      productId: "gid://shopify/Product/900",
    });
    const echo = await applyShopifyProductsUpdateObservation(prisma, {
      evidenceId: echoEvidence.id,
      connectionId: gen1.id,
      listingLinkId: listing.id,
      mappedVariantId: "gid://shopify/ProductVariant/800",
      mappedStoreVariantId: variant.id,
      remote: {
        productId: "gid://shopify/Product/900",
        status: "DRAFT",
        title: "INW Title v2",
        descriptionHtml: "Original description",
        updatedAt: new Date("2026-09-25T12:30:00Z"),
        variants: [
          {
            id: "gid://shopify/ProductVariant/800",
            price: "10.00",
            sku: "S6-SKU",
            updatedAt: new Date("2026-09-25T12:30:00Z"),
            inventoryItemId: "gid://shopify/InventoryItem/700",
          },
        ],
      },
    });
    expect(echo).toMatchObject({ status: "PROCESSED", productAction: "CONVERGED" });
    const itemAfterEcho = await prisma.storeItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(itemAfterEcho.title).toBe("INW Title v2");
    expect(
      await prisma.shopifySyncJob.count({
        where: { shopifyConnectionId: gen1.id, kind: "UPDATE_LISTING_CONTENT" },
      })
    ).toBe(jobsBefore);

    // LOST APPLIED MARKER recovery
    await prisma.shopifyListingLink.update({
      where: { id: listing.id },
      data: {
        desiredProductContentVersion: 2,
        desiredProductFingerprint: shopifyProductContentFingerprint({
          title: "INW Title v3",
          description: "Original description",
        }),
        appliedProductContentVersion: 1,
        appliedProductFingerprint: afterDesire.desiredProductFingerprint,
        productDesiredAt: new Date("2026-09-25T13:00:00Z"),
      },
    });
    await prisma.storeItem.update({
      where: { id: item.id },
      data: { title: "INW Title v3" },
    });
    const lostEvidence = await createEvidence({
      connectionId: gen1.id,
      shopDomain: shop,
      webhookId: `wh-lost-${seller.id}`,
      productId: "gid://shopify/Product/900",
    });
    const lost = await applyShopifyProductsUpdateObservation(prisma, {
      evidenceId: lostEvidence.id,
      connectionId: gen1.id,
      listingLinkId: listing.id,
      mappedVariantId: "gid://shopify/ProductVariant/800",
      mappedStoreVariantId: variant.id,
      remote: {
        productId: "gid://shopify/Product/900",
        status: "DRAFT",
        title: "INW Title v3",
        descriptionHtml: "Original description",
        updatedAt: new Date("2026-09-25T13:05:00Z"),
        variants: [
          {
            id: "gid://shopify/ProductVariant/800",
            price: "10.00",
            sku: "S6-SKU",
            updatedAt: new Date("2026-09-25T13:05:00Z"),
            inventoryItemId: "gid://shopify/InventoryItem/700",
          },
        ],
      },
    });
    expect(lost).toMatchObject({ status: "PROCESSED", productAction: "CONVERGED" });
    const afterLost = await prisma.shopifyListingLink.findUniqueOrThrow({ where: { id: listing.id } });
    expect(afterLost.appliedProductContentVersion).toBe(2);
    expect(afterLost.appliedProductFingerprint).toBe(afterLost.desiredProductFingerprint);
    expect(
      await prisma.shopifySyncJob.count({
        where: { shopifyConnectionId: gen1.id, kind: "UPDATE_LISTING_CONTENT" },
      })
    ).toBe(jobsBefore);

    // SHOPIFY PRODUCT WINS (remote newer than local desiredAt)
    await prisma.shopifyListingLink.update({
      where: { id: listing.id },
      data: { productDesiredAt: new Date("2026-09-25T14:00:00Z") },
    });
    const remoteWinEvidence = await createEvidence({
      connectionId: gen1.id,
      shopDomain: shop,
      webhookId: `wh-rwin-${seller.id}`,
      productId: "gid://shopify/Product/900",
    });
    const jobsBeforeRemote = await prisma.shopifySyncJob.count({
      where: { shopifyConnectionId: gen1.id, kind: "UPDATE_LISTING_CONTENT" },
    });
    const remoteWin = await applyShopifyProductsUpdateObservation(prisma, {
      evidenceId: remoteWinEvidence.id,
      connectionId: gen1.id,
      listingLinkId: listing.id,
      mappedVariantId: "gid://shopify/ProductVariant/800",
      mappedStoreVariantId: variant.id,
      remote: {
        productId: "gid://shopify/Product/900",
        status: "DRAFT",
        title: "Shopify Title",
        descriptionHtml: "Shopify Desc",
        updatedAt: new Date("2026-09-25T15:00:00Z"),
        variants: [
          {
            id: "gid://shopify/ProductVariant/800",
            price: "10.00",
            sku: "S6-SKU",
            updatedAt: new Date("2026-09-25T12:00:00Z"),
            inventoryItemId: "gid://shopify/InventoryItem/700",
          },
        ],
      },
    });
    expect(remoteWin).toMatchObject({ status: "PROCESSED", productAction: "REMOTE_WIN" });
    const afterRemoteWin = await prisma.storeItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(afterRemoteWin.title).toBe("Shopify Title");
    expect(afterRemoteWin.description).toBe("Shopify Desc");
    const linkAfterRemote = await prisma.shopifyListingLink.findUniqueOrThrow({
      where: { id: listing.id },
    });
    expect(linkAfterRemote.desiredProductContentVersion).toBe(linkAfterRemote.appliedProductContentVersion);
    expect(linkAfterRemote.desiredProductFingerprint).toBe(
      shopifyProductContentFingerprint({ title: "Shopify Title", description: "Shopify Desc" })
    );
    expect(
      await prisma.shopifySyncJob.count({
        where: { shopifyConnectionId: gen1.id, kind: "UPDATE_LISTING_CONTENT" },
      })
    ).toBe(jobsBeforeRemote);

    // Subsequent real seller edit DOES create S5 job
    const afterRemoteSnapshot = {
      title: afterRemoteWin.title,
      description: afterRemoteWin.description,
      priceCents: afterRemoteWin.priceCents,
      sku: afterRemoteWin.sku,
    };
    const sellerEdit = await prisma.$transaction(async (tx) => {
      const updated = await tx.storeItem.update({
        where: { id: item.id },
        data: { title: "Seller After Remote" },
      });
      return recordShopifyListingContentDesire(tx, {
        memberId: seller.id,
        storeItemId: item.id,
        before: afterRemoteSnapshot,
        after: {
          title: updated.title,
          description: updated.description,
          priceCents: updated.priceCents,
          sku: updated.sku,
        },
      });
    });
    expect(sellerEdit).toMatchObject({ status: "RECORDED" });
    if (sellerEdit.status !== "RECORDED") throw new Error("expected RECORDED");
    expect(
      await prisma.shopifySyncJob.findUnique({
        where: {
          dedupeKey: shopifyUpdateListingContentDedupeKey({
            connectionId: gen1.id,
            storeItemId: item.id,
            productDesiredVersion: sellerEdit.productDesiredVersion,
            variantDesiredVersion: sellerEdit.variantDesiredVersion,
          }),
        },
      })
    ).toBeTruthy();

    // INW PRODUCT WINS (remote older)
    const localWinEvidence = await createEvidence({
      connectionId: gen1.id,
      shopDomain: shop,
      webhookId: `wh-lwin-${seller.id}`,
      productId: "gid://shopify/Product/900",
    });
    const beforeLocalWin = await prisma.storeItem.findUniqueOrThrow({ where: { id: item.id } });
    const localWin = await applyShopifyProductsUpdateObservation(prisma, {
      evidenceId: localWinEvidence.id,
      connectionId: gen1.id,
      listingLinkId: listing.id,
      mappedVariantId: "gid://shopify/ProductVariant/800",
      mappedStoreVariantId: variant.id,
      remote: {
        productId: "gid://shopify/Product/900",
        status: "DRAFT",
        title: "Stale Shopify Title",
        descriptionHtml: "Stale",
        updatedAt: new Date("2026-09-25T10:00:00Z"),
        variants: [
          {
            id: "gid://shopify/ProductVariant/800",
            price: "10.00",
            sku: "S6-SKU",
            updatedAt: new Date("2026-09-25T10:00:00Z"),
            inventoryItemId: "gid://shopify/InventoryItem/700",
          },
        ],
      },
    });
    expect(localWin).toMatchObject({ status: "PROCESSED", productAction: "LOCAL_WIN" });
    expect((await prisma.storeItem.findUniqueOrThrow({ where: { id: item.id } })).title).toBe(
      beforeLocalWin.title
    );

    // TIMESTAMP TIE → local wins
    const tieAt = new Date("2026-09-25T16:00:00Z");
    await prisma.shopifyListingLink.update({
      where: { id: listing.id },
      data: { productDesiredAt: tieAt },
    });
    const tieEvidence = await createEvidence({
      connectionId: gen1.id,
      shopDomain: shop,
      webhookId: `wh-tie-${seller.id}`,
      productId: "gid://shopify/Product/900",
    });
    const tie = await applyShopifyProductsUpdateObservation(prisma, {
      evidenceId: tieEvidence.id,
      connectionId: gen1.id,
      listingLinkId: listing.id,
      mappedVariantId: "gid://shopify/ProductVariant/800",
      mappedStoreVariantId: variant.id,
      remote: {
        productId: "gid://shopify/Product/900",
        status: "DRAFT",
        title: "Tie Title",
        descriptionHtml: "Tie Desc",
        updatedAt: tieAt,
        variants: [
          {
            id: "gid://shopify/ProductVariant/800",
            price: "10.00",
            sku: "S6-SKU",
            updatedAt: tieAt,
            inventoryItemId: "gid://shopify/InventoryItem/700",
          },
        ],
      },
    });
    expect(tie).toMatchObject({ status: "PROCESSED", productAction: "LOCAL_WIN" });

    // VARIANT remote win + product local (split)
    await prisma.shopifyVariantMap.update({
      where: { id: variantMap.id },
      data: { variantDesiredAt: new Date("2026-09-25T12:00:00Z") },
    });
    await prisma.shopifyListingLink.update({
      where: { id: listing.id },
      data: { productDesiredAt: new Date("2026-09-25T18:00:00Z") },
    });
    const splitEvidence = await createEvidence({
      connectionId: gen1.id,
      shopDomain: shop,
      webhookId: `wh-split-${seller.id}`,
      productId: "gid://shopify/Product/900",
    });
    const titleBeforeSplit = (await prisma.storeItem.findUniqueOrThrow({ where: { id: item.id } }))
      .title;
    const split = await applyShopifyProductsUpdateObservation(prisma, {
      evidenceId: splitEvidence.id,
      connectionId: gen1.id,
      listingLinkId: listing.id,
      mappedVariantId: "gid://shopify/ProductVariant/800",
      mappedStoreVariantId: variant.id,
      remote: {
        productId: "gid://shopify/Product/900",
        status: "DRAFT",
        title: "Should Not Win Product",
        descriptionHtml: "Nope",
        updatedAt: new Date("2026-09-25T17:00:00Z"),
        variants: [
          {
            id: "gid://shopify/ProductVariant/800",
            price: "10.37",
            sku: "S6-REMOTE",
            updatedAt: new Date("2026-09-25T17:30:00Z"),
            inventoryItemId: "gid://shopify/InventoryItem/700",
          },
        ],
      },
    });
    expect(split).toMatchObject({
      status: "PROCESSED",
      productAction: "LOCAL_WIN",
      variantAction: "REMOTE_WIN",
    });
    const afterSplit = await prisma.storeItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(afterSplit.title).toBe(titleBeforeSplit);
    expect(afterSplit.priceCents).toBe(1037);
    expect(afterSplit.sku).toBe("S6-REMOTE");
    const variantAfter = await prisma.storeVariant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(variantAfter.priceCents).toBe(1037);
    expect(variantAfter.sku).toBe("S6-REMOTE");
    expect(shopifyVariantContentFingerprint({ priceCents: 1037, sku: "S6-REMOTE" })).toBe(
      (
        await prisma.shopifyVariantMap.findUniqueOrThrow({ where: { id: variantMap.id } })
      ).appliedVariantFingerprint
    );

    // MULTI-VARIANT DRIFT → ERROR
    const multiEvidence = await createEvidence({
      connectionId: gen1.id,
      shopDomain: shop,
      webhookId: `wh-multi-${seller.id}`,
      productId: "gid://shopify/Product/900",
    });
    const multi = await applyShopifyProductsUpdateObservation(prisma, {
      evidenceId: multiEvidence.id,
      connectionId: gen1.id,
      listingLinkId: listing.id,
      mappedVariantId: "gid://shopify/ProductVariant/800",
      mappedStoreVariantId: variant.id,
      remote: {
        productId: "gid://shopify/Product/900",
        status: "DRAFT",
        title: "X",
        descriptionHtml: "Y",
        updatedAt: new Date("2026-09-25T19:00:00Z"),
        variants: [
          {
            id: "gid://shopify/ProductVariant/800",
            price: "10.37",
            sku: "S6-REMOTE",
            updatedAt: new Date("2026-09-25T19:00:00Z"),
            inventoryItemId: "gid://shopify/InventoryItem/700",
          },
          {
            id: "gid://shopify/ProductVariant/801",
            price: "1.00",
            sku: "EXTRA",
            updatedAt: new Date("2026-09-25T19:00:00Z"),
            inventoryItemId: "gid://shopify/InventoryItem/701",
          },
        ],
      },
    });
    expect(multi).toMatchObject({ status: "ERROR", code: "VARIANT_CARDINALITY" });

    // NON-DRAFT → ERROR
    const activeEvidence = await createEvidence({
      connectionId: gen1.id,
      shopDomain: shop,
      webhookId: `wh-active-${seller.id}`,
      productId: "gid://shopify/Product/900",
    });
    const active = await applyShopifyProductsUpdateObservation(prisma, {
      evidenceId: activeEvidence.id,
      connectionId: gen1.id,
      listingLinkId: listing.id,
      mappedVariantId: "gid://shopify/ProductVariant/800",
      mappedStoreVariantId: variant.id,
      remote: {
        productId: "gid://shopify/Product/900",
        status: "ACTIVE",
        title: "Active",
        descriptionHtml: "Active",
        updatedAt: new Date("2026-09-25T20:00:00Z"),
        variants: [
          {
            id: "gid://shopify/ProductVariant/800",
            price: "10.37",
            sku: "S6-REMOTE",
            updatedAt: new Date("2026-09-25T20:00:00Z"),
            inventoryItemId: "gid://shopify/InventoryItem/700",
          },
        ],
      },
    });
    expect(active).toMatchObject({ status: "ERROR", code: "PRODUCT_NOT_DRAFT" });

    // OLD GENERATION IGNORED
    await disconnectShopifyConnection(prisma, {
      memberId: seller.id,
      connectionId: gen1.id,
    });
    const gen2 = await activeConnection(
      seller.id,
      shop,
      new Date("2026-09-24T16:00:00Z"),
      shopId
    );
    expect(gen2.generation).toBe(2);
    const staleEvidence = await createEvidence({
      connectionId: gen1.id,
      shopDomain: shop,
      webhookId: `wh-stale-gen-${seller.id}`,
      productId: "gid://shopify/Product/900",
    });
    await markShopifyEvidenceIgnored(
      prisma,
      staleEvidence.id,
      "CONNECTION_INACTIVE",
      "Evidence generation is not an active Shopify connection"
    );
    expect(
      (await prisma.shopifyProviderEvidence.findUniqueOrThrow({ where: { id: staleEvidence.id } }))
        .processState
    ).toBe("IGNORED");
    expect((await prisma.storeItem.findUniqueOrThrow({ where: { id: item.id } })).title).toBe(
      titleBeforeSplit
    );

    expect(await prisma.inventoryState.count()).toBe(beforeStates);
    expect(await prisma.inventoryEvent.count()).toBe(beforeEvents);
    expect(await prisma.storeOrder.count()).toBe(beforeOrders);
  });
});
