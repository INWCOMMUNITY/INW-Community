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

function remoteObs(input: {
  title: string;
  descriptionHtml: string;
  price: string;
  sku: string;
  productUpdatedAt?: Date;
  variantUpdatedAt?: Date;
}) {
  return {
    productId: "gid://shopify/Product/900",
    status: "DRAFT",
    title: input.title,
    descriptionHtml: input.descriptionHtml,
    updatedAt: input.productUpdatedAt ?? new Date("2026-09-25T12:00:00Z"),
    variants: [
      {
        id: "gid://shopify/ProductVariant/800",
        price: input.price,
        sku: input.sku,
        updatedAt: input.variantUpdatedAt ?? new Date("2026-09-25T12:00:00Z"),
        inventoryItemId: "gid://shopify/InventoryItem/700",
      },
    ],
  };
}

describe("shopify S6 semantic three-way inbound", () => {
  it("echo, remote/local-only, conflict, clocks ignored, split groups, gates, no inventory", async () => {
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

    // S4 seeds applied BASE.
    const baseProductFp = shopifyProductContentFingerprint({
      title: "S6 Title",
      description: "Original description",
    });
    expect(listing.appliedProductFingerprint).toBe(baseProductFp);
    expect(variantMap.appliedVariantFingerprint).toBe(
      shopifyVariantContentFingerprint({ priceCents: 1000, sku: "S6-SKU" })
    );

    // Local S5 title edit → LOCAL_ONLY pending
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
    expect(afterDesire.desiredProductFingerprint).toBe(
      shopifyProductContentFingerprint({ title: "INW Title v2", description: "Original description" })
    );

    // Mark applied as if S5 outbound succeeded (BASE advances to C)
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

    // SELF ECHO → CONVERGED / UNCHANGED
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
      remote: remoteObs({
        title: "INW Title v2",
        descriptionHtml: "Original description",
        price: "10.00",
        sku: "S6-SKU",
      }),
    });
    expect(echo).toMatchObject({ status: "PROCESSED", productAction: "UNCHANGED" });
    expect(
      await prisma.shopifySyncJob.count({
        where: { shopifyConnectionId: gen1.id, kind: "UPDATE_LISTING_CONTENT" },
      })
    ).toBe(jobsBefore);

    // LOST APPLIED MARKER recovery via CONVERGED
    const v3Fp = shopifyProductContentFingerprint({
      title: "INW Title v3",
      description: "Original description",
    });
    await prisma.shopifyListingLink.update({
      where: { id: listing.id },
      data: {
        desiredProductContentVersion: 2,
        desiredProductFingerprint: v3Fp,
        appliedProductContentVersion: 1,
        appliedProductFingerprint: afterDesire.desiredProductFingerprint,
        productDesiredAt: new Date("2026-09-25T13:00:00Z"),
      },
    });
    await prisma.storeItem.update({ where: { id: item.id }, data: { title: "INW Title v3" } });
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
      remote: remoteObs({
        title: "INW Title v3",
        descriptionHtml: "Original description",
        price: "10.00",
        sku: "S6-SKU",
      }),
    });
    expect(lost).toMatchObject({ status: "PROCESSED", productAction: "CONVERGED" });
    const afterLost = await prisma.shopifyListingLink.findUniqueOrThrow({ where: { id: listing.id } });
    expect(afterLost.appliedProductContentVersion).toBe(2);
    expect(afterLost.appliedProductFingerprint).toBe(v3Fp);

    // REMOTE_ONLY: LOCAL == BASE, REMOTE != BASE
    const baseAfterLost = afterLost.appliedProductFingerprint!;
    const remoteOnlyEvidence = await createEvidence({
      connectionId: gen1.id,
      shopDomain: shop,
      webhookId: `wh-remote-${seller.id}`,
      productId: "gid://shopify/Product/900",
    });
    const jobsBeforeRemote = await prisma.shopifySyncJob.count({
      where: { shopifyConnectionId: gen1.id, kind: "UPDATE_LISTING_CONTENT" },
    });
    const remoteOnly = await applyShopifyProductsUpdateObservation(prisma, {
      evidenceId: remoteOnlyEvidence.id,
      connectionId: gen1.id,
      listingLinkId: listing.id,
      mappedVariantId: "gid://shopify/ProductVariant/800",
      mappedStoreVariantId: variant.id,
      remote: remoteObs({
        title: "Shopify Title",
        descriptionHtml: "Shopify Desc",
        price: "10.00",
        sku: "S6-SKU",
        productUpdatedAt: new Date("2026-09-25T15:00:00Z"),
      }),
    });
    expect(remoteOnly).toMatchObject({ status: "PROCESSED", productAction: "REMOTE_ONLY" });
    const afterRemote = await prisma.storeItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(afterRemote.title).toBe("Shopify Title");
    expect(afterRemote.description).toBe("Shopify Desc");
    const linkAfterRemote = await prisma.shopifyListingLink.findUniqueOrThrow({
      where: { id: listing.id },
    });
    expect(linkAfterRemote.desiredProductContentVersion).toBe(
      linkAfterRemote.appliedProductContentVersion
    );
    expect(linkAfterRemote.desiredProductFingerprint).toBe(
      shopifyProductContentFingerprint({ title: "Shopify Title", description: "Shopify Desc" })
    );
    expect(linkAfterRemote.appliedProductFingerprint).not.toBe(baseAfterLost);
    expect(
      await prisma.shopifySyncJob.count({
        where: { shopifyConnectionId: gen1.id, kind: "UPDATE_LISTING_CONTENT" },
      })
    ).toBe(jobsBeforeRemote);

    // Seller edit after remote → durable S5 job + clears conflict if any
    const afterRemoteSnapshot = {
      title: afterRemote.title,
      description: afterRemote.description,
      priceCents: afterRemote.priceCents,
      sku: afterRemote.sku,
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
    const afterSellerDesire = await prisma.shopifyListingLink.findUniqueOrThrow({
      where: { id: listing.id },
    });
    expect(afterSellerDesire.productContentConflict).toBe(false);

    // LOCAL_ONLY: remote still at BASE (Shopify Title), local moved to Seller After Remote
    // First advance applied to match the remote-only state as BASE for next classification.
    // Actually after seller edit: LOCAL=Seller, BASE=Shopify Title (applied), REMOTE if still Shopify Title → LOCAL_ONLY
    const localOnlyEvidence = await createEvidence({
      connectionId: gen1.id,
      shopDomain: shop,
      webhookId: `wh-local-${seller.id}`,
      productId: "gid://shopify/Product/900",
    });
    const beforeLocal = await prisma.storeItem.findUniqueOrThrow({ where: { id: item.id } });
    const localOnly = await applyShopifyProductsUpdateObservation(prisma, {
      evidenceId: localOnlyEvidence.id,
      connectionId: gen1.id,
      listingLinkId: listing.id,
      mappedVariantId: "gid://shopify/ProductVariant/800",
      mappedStoreVariantId: variant.id,
      remote: remoteObs({
        title: "Shopify Title",
        descriptionHtml: "Shopify Desc",
        price: "10.00",
        sku: "S6-SKU",
        // Newer updatedAt must NOT flip winner when fingerprint == BASE.
        productUpdatedAt: new Date("2099-01-01T00:00:00Z"),
      }),
    });
    expect(localOnly).toMatchObject({ status: "PROCESSED", productAction: "LOCAL_ONLY" });
    expect((await prisma.storeItem.findUniqueOrThrow({ where: { id: item.id } })).title).toBe(
      beforeLocal.title
    );

    // CONFLICT: both diverge — BASE=Shopify Title applied, set applied explicitly, local C, remote B
    const conflictBase = shopifyProductContentFingerprint({
      title: "Shopify Title",
      description: "Shopify Desc",
    });
    const localC = shopifyProductContentFingerprint({
      title: "INW Conflict C",
      description: "Shopify Desc",
    });
    await prisma.storeItem.update({
      where: { id: item.id },
      data: { title: "INW Conflict C" },
    });
    await prisma.shopifyListingLink.update({
      where: { id: listing.id },
      data: {
        desiredProductFingerprint: localC,
        appliedProductFingerprint: conflictBase,
        desiredProductContentVersion: 10,
        appliedProductContentVersion: 9,
        productDesiredAt: new Date("2026-09-25T16:00:00Z"),
        productContentConflict: false,
      },
    });
    const conflictEvidence = await createEvidence({
      connectionId: gen1.id,
      shopDomain: shop,
      webhookId: `wh-conflict-${seller.id}`,
      productId: "gid://shopify/Product/900",
    });
    const conflict = await applyShopifyProductsUpdateObservation(prisma, {
      evidenceId: conflictEvidence.id,
      connectionId: gen1.id,
      listingLinkId: listing.id,
      mappedVariantId: "gid://shopify/ProductVariant/800",
      mappedStoreVariantId: variant.id,
      remote: remoteObs({
        title: "Shopify Conflict B",
        descriptionHtml: "Shopify Desc",
        price: "10.00",
        sku: "S6-SKU",
      }),
    });
    expect(conflict).toMatchObject({ status: "PROCESSED", productAction: "CONFLICT" });
    const afterConflict = await prisma.shopifyListingLink.findUniqueOrThrow({
      where: { id: listing.id },
    });
    expect(afterConflict.productContentConflict).toBe(true);
    expect(afterConflict.productConflictRemoteFingerprint).toBe(
      shopifyProductContentFingerprint({
        title: "Shopify Conflict B",
        description: "Shopify Desc",
      })
    );
    expect(afterConflict.productConflictEvidenceId).toBe(conflictEvidence.id);
    expect((await prisma.storeItem.findUniqueOrThrow({ where: { id: item.id } })).title).toBe(
      "INW Conflict C"
    );
    expect(afterConflict.appliedProductFingerprint).toBe(conflictBase);

    // Same fingerprint + newer updatedAt during conflict does not change semantics / invent winner
    const clockEvidence = await createEvidence({
      connectionId: gen1.id,
      shopDomain: shop,
      webhookId: `wh-clock-${seller.id}`,
      productId: "gid://shopify/Product/900",
    });
    const clock = await applyShopifyProductsUpdateObservation(prisma, {
      evidenceId: clockEvidence.id,
      connectionId: gen1.id,
      listingLinkId: listing.id,
      mappedVariantId: "gid://shopify/ProductVariant/800",
      mappedStoreVariantId: variant.id,
      remote: remoteObs({
        title: "Shopify Conflict B",
        descriptionHtml: "Shopify Desc",
        price: "10.00",
        sku: "S6-SKU",
        productUpdatedAt: new Date("2099-12-31T00:00:00Z"),
      }),
    });
    expect(clock).toMatchObject({ status: "PROCESSED", productAction: "CONFLICT" });
    expect((await prisma.storeItem.findUniqueOrThrow({ where: { id: item.id } })).title).toBe(
      "INW Conflict C"
    );

    // REMOTE CONVERGES TO LOCAL during conflict
    const convergeEvidence = await createEvidence({
      connectionId: gen1.id,
      shopDomain: shop,
      webhookId: `wh-conv-${seller.id}`,
      productId: "gid://shopify/Product/900",
    });
    const converge = await applyShopifyProductsUpdateObservation(prisma, {
      evidenceId: convergeEvidence.id,
      connectionId: gen1.id,
      listingLinkId: listing.id,
      mappedVariantId: "gid://shopify/ProductVariant/800",
      mappedStoreVariantId: variant.id,
      remote: remoteObs({
        title: "INW Conflict C",
        descriptionHtml: "Shopify Desc",
        price: "10.00",
        sku: "S6-SKU",
      }),
    });
    expect(converge).toMatchObject({ status: "PROCESSED", productAction: "CONVERGED" });
    const afterConverge = await prisma.shopifyListingLink.findUniqueOrThrow({
      where: { id: listing.id },
    });
    expect(afterConverge.productContentConflict).toBe(false);
    expect(afterConverge.appliedProductFingerprint).toBe(localC);

    // Re-seed CONFLICT then REMOTE RETURNS TO BASE → LOCAL_ONLY + ensure job
    await prisma.shopifyListingLink.update({
      where: { id: listing.id },
      data: {
        desiredProductFingerprint: localC,
        appliedProductFingerprint: conflictBase,
        desiredProductContentVersion: 11,
        appliedProductContentVersion: 9,
        productContentConflict: true,
        productConflictRemoteFingerprint: shopifyProductContentFingerprint({
          title: "Shopify Conflict B",
          description: "Shopify Desc",
        }),
        productConflictDetectedAt: new Date(),
      },
    });
    await prisma.storeItem.update({
      where: { id: item.id },
      data: { title: "INW Conflict C" },
    });
    const jobsBeforeReturn = await prisma.shopifySyncJob.count({
      where: { shopifyConnectionId: gen1.id, kind: "UPDATE_LISTING_CONTENT" },
    });
    const returnEvidence = await createEvidence({
      connectionId: gen1.id,
      shopDomain: shop,
      webhookId: `wh-return-${seller.id}`,
      productId: "gid://shopify/Product/900",
    });
    const returned = await applyShopifyProductsUpdateObservation(prisma, {
      evidenceId: returnEvidence.id,
      connectionId: gen1.id,
      listingLinkId: listing.id,
      mappedVariantId: "gid://shopify/ProductVariant/800",
      mappedStoreVariantId: variant.id,
      remote: remoteObs({
        title: "Shopify Title",
        descriptionHtml: "Shopify Desc",
        price: "10.00",
        sku: "S6-SKU",
      }),
    });
    expect(returned).toMatchObject({ status: "PROCESSED", productAction: "LOCAL_ONLY" });
    const afterReturn = await prisma.shopifyListingLink.findUniqueOrThrow({
      where: { id: listing.id },
    });
    expect(afterReturn.productContentConflict).toBe(false);
    expect(afterReturn.desiredProductContentVersion).toBe(11); // no bump solely to re-enqueue
    expect(
      await prisma.shopifySyncJob.count({
        where: { shopifyConnectionId: gen1.id, kind: "UPDATE_LISTING_CONTENT" },
      })
    ).toBeGreaterThanOrEqual(jobsBeforeReturn);
    expect(
      await prisma.shopifySyncJob.findUnique({
        where: {
          dedupeKey: shopifyUpdateListingContentDedupeKey({
            connectionId: gen1.id,
            storeItemId: item.id,
            productDesiredVersion: 11,
            variantDesiredVersion: variantMap.desiredVariantContentVersion,
          }),
        },
      })
    ).toBeTruthy();

    // PRODUCT CONFLICT + VARIANT LOCAL_ONLY independence
    const splitBaseProduct = shopifyProductContentFingerprint({
      title: "P-Base",
      description: "D",
    });
    const splitLocalProduct = shopifyProductContentFingerprint({
      title: "P-Local",
      description: "D",
    });
    const splitRemoteProduct = shopifyProductContentFingerprint({
      title: "P-Remote",
      description: "D",
    });
    const splitBaseVariant = shopifyVariantContentFingerprint({ priceCents: 1000, sku: "S6-SKU" });
    const splitLocalVariant = shopifyVariantContentFingerprint({ priceCents: 1200, sku: "S6-SKU" });
    await prisma.storeItem.update({
      where: { id: item.id },
      data: { title: "P-Local", description: "D", priceCents: 1200, sku: "S6-SKU" },
    });
    await prisma.storeVariant.update({
      where: { id: variant.id },
      data: { priceCents: 1200, sku: "S6-SKU" },
    });
    await prisma.shopifyListingLink.update({
      where: { id: listing.id },
      data: {
        desiredProductFingerprint: splitLocalProduct,
        appliedProductFingerprint: splitBaseProduct,
        desiredProductContentVersion: 20,
        appliedProductContentVersion: 19,
        productContentConflict: false,
      },
    });
    await prisma.shopifyVariantMap.update({
      where: { id: variantMap.id },
      data: {
        desiredVariantFingerprint: splitLocalVariant,
        appliedVariantFingerprint: splitBaseVariant,
        desiredVariantContentVersion: 5,
        appliedVariantContentVersion: 4,
        variantContentConflict: false,
      },
    });
    const splitEvidence = await createEvidence({
      connectionId: gen1.id,
      shopDomain: shop,
      webhookId: `wh-split-${seller.id}`,
      productId: "gid://shopify/Product/900",
    });
    const split = await applyShopifyProductsUpdateObservation(prisma, {
      evidenceId: splitEvidence.id,
      connectionId: gen1.id,
      listingLinkId: listing.id,
      mappedVariantId: "gid://shopify/ProductVariant/800",
      mappedStoreVariantId: variant.id,
      remote: remoteObs({
        title: "P-Remote",
        descriptionHtml: "D",
        price: "10.00",
        sku: "S6-SKU",
      }),
    });
    expect(split).toMatchObject({
      status: "PROCESSED",
      productAction: "CONFLICT",
      variantAction: "LOCAL_ONLY",
    });
    const afterSplitLink = await prisma.shopifyListingLink.findUniqueOrThrow({
      where: { id: listing.id },
    });
    const afterSplitVar = await prisma.shopifyVariantMap.findUniqueOrThrow({
      where: { id: variantMap.id },
    });
    expect(afterSplitLink.productContentConflict).toBe(true);
    expect(afterSplitVar.variantContentConflict).toBe(false);
    expect((await prisma.storeItem.findUniqueOrThrow({ where: { id: item.id } })).title).toBe(
      "P-Local"
    );
    expect((await prisma.storeVariant.findUniqueOrThrow({ where: { id: variant.id } })).priceCents).toBe(
      1200
    );
    expect(splitRemoteProduct).not.toBe(splitLocalProduct);

    // Seller edit resolves product conflict
    const resolve = await prisma.$transaction(async (tx) => {
      const updated = await tx.storeItem.update({
        where: { id: item.id },
        data: { title: "P-Resolved-D" },
      });
      return recordShopifyListingContentDesire(tx, {
        memberId: seller.id,
        storeItemId: item.id,
        before: {
          title: "P-Local",
          description: "D",
          priceCents: 1200,
          sku: "S6-SKU",
        },
        after: {
          title: updated.title,
          description: updated.description,
          priceCents: updated.priceCents,
          sku: updated.sku,
        },
      });
    });
    expect(resolve).toMatchObject({ status: "RECORDED" });
    const afterResolve = await prisma.shopifyListingLink.findUniqueOrThrow({
      where: { id: listing.id },
    });
    expect(afterResolve.productContentConflict).toBe(false);
    expect(afterResolve.desiredProductContentVersion).toBeGreaterThan(20);
    expect(afterResolve.desiredProductFingerprint).toBe(
      shopifyProductContentFingerprint({ title: "P-Resolved-D", description: "D" })
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
            price: "12.00",
            sku: "S6-SKU",
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
        ...remoteObs({
          title: "Active",
          descriptionHtml: "Active",
          price: "12.00",
          sku: "S6-SKU",
        }),
        status: "ACTIVE",
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

    expect(await prisma.inventoryState.count()).toBe(beforeStates);
    expect(await prisma.inventoryEvent.count()).toBe(beforeEvents);
    expect(await prisma.storeOrder.count()).toBe(beforeOrders);
  });

  it("null-base bootstrap cases without timestamp guessing", async () => {
    const seller = await createMember(prisma, "s6b");
    const shop = `s6b-${seller.id.slice(-8)}.myshopify.com`;
    const shopId = `gid://shopify/Shop/${seller.id.replace(/\D/g, "").slice(0, 8) || "7602"}`;
    const item = await createStoreItem(prisma, seller.id, "Boot Title", {
      priceCents: 500,
      sku: "BOOT",
    });
    await prisma.storeItem.update({
      where: { id: item.id },
      data: { description: "Boot Desc" },
    });
    const variant = await createVariant(prisma, {
      memberId: seller.id,
      storeItemId: item.id,
      isDefault: true,
      sku: "BOOT",
      priceCents: 500,
    });
    const conn = await activeConnection(
      seller.id,
      shop,
      new Date("2026-09-24T12:00:00Z"),
      shopId
    );
    await createShopifyListingMapping(prisma, {
      memberId: seller.id,
      connectionId: conn.id,
      storeItemId: item.id,
      shopifyProductId: "gid://shopify/Product/901",
      variants: [
        {
          storeVariantId: variant.id,
          shopifyVariantId: "gid://shopify/ProductVariant/801",
          shopifyInventoryItemId: "gid://shopify/InventoryItem/701",
        },
      ],
    });
    const listing = await prisma.shopifyListingLink.findUniqueOrThrow({
      where: {
        shopifyConnectionId_storeItemId: { shopifyConnectionId: conn.id, storeItemId: item.id },
      },
    });
    const variantMap = await prisma.shopifyVariantMap.findFirstOrThrow({
      where: { shopifyListingLinkId: listing.id },
    });

    // Force null BASE (simulate pre-seed edge) for case matrix.
    await prisma.shopifyListingLink.update({
      where: { id: listing.id },
      data: {
        appliedProductFingerprint: null,
        desiredProductFingerprint: shopifyProductContentFingerprint({
          title: "Boot Title",
          description: "Boot Desc",
        }),
        desiredProductContentVersion: 0,
        appliedProductContentVersion: 0,
        productDesiredAt: null,
      },
    });

    // Case 1: LOCAL == REMOTE → CONVERGED
    const e1 = await createEvidence({
      connectionId: conn.id,
      shopDomain: shop,
      webhookId: `wh-boot1-${seller.id}`,
      productId: "gid://shopify/Product/901",
    });
    const c1 = await applyShopifyProductsUpdateObservation(prisma, {
      evidenceId: e1.id,
      connectionId: conn.id,
      listingLinkId: listing.id,
      mappedVariantId: "gid://shopify/ProductVariant/801",
      mappedStoreVariantId: variant.id,
      remote: {
        productId: "gid://shopify/Product/901",
        status: "DRAFT",
        title: "Boot Title",
        descriptionHtml: "Boot Desc",
        updatedAt: new Date("2026-09-25T12:00:00Z"),
        variants: [
          {
            id: "gid://shopify/ProductVariant/801",
            price: "5.00",
            sku: "BOOT",
            updatedAt: new Date("2026-09-25T12:00:00Z"),
            inventoryItemId: "gid://shopify/InventoryItem/701",
          },
        ],
      },
    });
    expect(c1).toMatchObject({ status: "PROCESSED", productAction: "CONVERGED" });
    expect(
      (await prisma.shopifyListingLink.findUniqueOrThrow({ where: { id: listing.id } }))
        .appliedProductFingerprint
    ).toBeTruthy();

    // Case 2: null base, no local edit, LOCAL != REMOTE → REMOTE_ONLY
    await prisma.shopifyListingLink.update({
      where: { id: listing.id },
      data: {
        appliedProductFingerprint: null,
        desiredProductFingerprint: shopifyProductContentFingerprint({
          title: "Boot Title",
          description: "Boot Desc",
        }),
        desiredProductContentVersion: 0,
        appliedProductContentVersion: 0,
        productDesiredAt: null,
        productContentConflict: false,
      },
    });
    await prisma.storeItem.update({
      where: { id: item.id },
      data: { title: "Boot Title", description: "Boot Desc" },
    });
    const e2 = await createEvidence({
      connectionId: conn.id,
      shopDomain: shop,
      webhookId: `wh-boot2-${seller.id}`,
      productId: "gid://shopify/Product/901",
    });
    const c2 = await applyShopifyProductsUpdateObservation(prisma, {
      evidenceId: e2.id,
      connectionId: conn.id,
      listingLinkId: listing.id,
      mappedVariantId: "gid://shopify/ProductVariant/801",
      mappedStoreVariantId: variant.id,
      remote: {
        productId: "gid://shopify/Product/901",
        status: "DRAFT",
        title: "Remote Boot",
        descriptionHtml: "Remote Desc",
        updatedAt: new Date("2026-09-25T12:00:00Z"),
        variants: [
          {
            id: "gid://shopify/ProductVariant/801",
            price: "5.00",
            sku: "BOOT",
            updatedAt: new Date("2026-09-25T12:00:00Z"),
            inventoryItemId: "gid://shopify/InventoryItem/701",
          },
        ],
      },
    });
    expect(c2).toMatchObject({ status: "PROCESSED", productAction: "REMOTE_ONLY" });
    expect((await prisma.storeItem.findUniqueOrThrow({ where: { id: item.id } })).title).toBe(
      "Remote Boot"
    );

    // Case 3: null base + local edit + diverge → CONFLICT
    await prisma.shopifyListingLink.update({
      where: { id: listing.id },
      data: {
        appliedProductFingerprint: null,
        desiredProductFingerprint: shopifyProductContentFingerprint({
          title: "Local Edit",
          description: "Boot Desc",
        }),
        desiredProductContentVersion: 1,
        appliedProductContentVersion: 0,
        productDesiredAt: new Date("2026-09-25T14:00:00Z"),
        productContentConflict: false,
      },
    });
    await prisma.storeItem.update({
      where: { id: item.id },
      data: { title: "Local Edit", description: "Boot Desc" },
    });
    // Keep variant map stable for apply path.
    void variantMap;
    const e3 = await createEvidence({
      connectionId: conn.id,
      shopDomain: shop,
      webhookId: `wh-boot3-${seller.id}`,
      productId: "gid://shopify/Product/901",
    });
    const c3 = await applyShopifyProductsUpdateObservation(prisma, {
      evidenceId: e3.id,
      connectionId: conn.id,
      listingLinkId: listing.id,
      mappedVariantId: "gid://shopify/ProductVariant/801",
      mappedStoreVariantId: variant.id,
      remote: {
        productId: "gid://shopify/Product/901",
        status: "DRAFT",
        title: "Other Remote",
        descriptionHtml: "Other",
        updatedAt: new Date("2026-09-25T15:00:00Z"),
        variants: [
          {
            id: "gid://shopify/ProductVariant/801",
            price: "5.00",
            sku: "BOOT",
            updatedAt: new Date("2026-09-25T15:00:00Z"),
            inventoryItemId: "gid://shopify/InventoryItem/701",
          },
        ],
      },
    });
    expect(c3).toMatchObject({ status: "PROCESSED", productAction: "CONFLICT" });
    expect(
      (await prisma.shopifyListingLink.findUniqueOrThrow({ where: { id: listing.id } }))
        .productContentConflict
    ).toBe(true);
    expect((await prisma.storeItem.findUniqueOrThrow({ where: { id: item.id } })).title).toBe(
      "Local Edit"
    );
  });
});
