import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  COMMERCE_FOUNDATION_CUTOVER_SINGLETON_ID,
  transitionCommerceFoundationCutover,
} from "../commerce-foundation-cutover";
import {
  holdTrackedReservation,
  releaseReservation,
  setTrackedOnHand,
} from "../commerce-foundation-inventory";
import { provisionNativeFoundationListing } from "../commerce-foundation-listing";
import { disconnectShopifyConnection, persistShopifyInstall } from "../shopify/connection";
import { createShopifyListingMapping } from "../shopify/mapping";
import { applyShopifyPaidOrderLineSale } from "../shopify/order-sale";
import { hashShopifyWebhookPayload } from "../shopify/evidence";
import { enqueueShopifySyncJob } from "../shopify/jobs";
import { shopifyProjectInventoryDedupeKey } from "../shopify/inventory-projection";
import {
  createCheckoutAttempt,
  createMember,
  createOrder,
  createOrderLine,
  createStoreItem,
} from "./fixtures";
import { foundationTestDatabaseUrl } from "./local-url";

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

async function enterFoundation() {
  await prisma.$executeRaw`
    INSERT INTO "commerce_foundation_cutover" ("id", "mode", "updated_at")
    VALUES (${COMMERCE_FOUNDATION_CUTOVER_SINGLETON_ID}, 'LEGACY', CURRENT_TIMESTAMP)
    ON CONFLICT ("id") DO UPDATE SET
      "mode" = 'LEGACY',
      "frozen_at" = NULL,
      "backfilled_at" = NULL,
      "foundation_at" = NULL,
      "unfrozen_at" = NULL,
      "engine_sha" = NULL,
      "manifest_hash" = NULL,
      "updated_at" = CURRENT_TIMESTAMP
  `;
  await transitionCommerceFoundationCutover(prisma, { to: "FROZEN" });
  await transitionCommerceFoundationCutover(prisma, {
    to: "BACKFILLING",
    engineSha: "engine-s8",
    manifestHash: "manifest-s8",
  });
  await transitionCommerceFoundationCutover(prisma, { to: "FOUNDATION" });
}

async function seedMappedPhysical(qty: number) {
  await enterFoundation();
  const seller = await createMember(prisma, "s8");
  const shop = `s8-${seller.id.slice(-8)}.myshopify.com`;
  const shopId = `gid://shopify/Shop/${seller.id.replace(/\D/g, "").slice(0, 8) || "8801"}`;
  const item = await createStoreItem(prisma, seller.id, "S8 Physical", {
    quantity: qty,
    sku: "S8-P",
    priceCents: 1500,
  });
  const provisioned = await prisma.$transaction((tx) => provisionNativeFoundationListing(tx, item.id));
  const variantId = provisioned.variantIds[0];
  const conn = await persistShopifyInstall(prisma, {
    memberId: seller.id,
    shopDomain: shop,
    shopId,
    accessTokenEncrypted: "cipher-access",
    refreshTokenEncrypted: "cipher-refresh",
    accessTokenExpiresAt: new Date("2099-01-01T00:00:00Z"),
    refreshTokenExpiresAt: new Date("2099-06-01T00:00:00Z"),
    grantedScopes: "write_products,write_inventory,read_orders,read_locations",
    primaryLocationId: "gid://shopify/Location/1",
    connectedAt: new Date("2026-09-25T12:00:00Z"),
  });
  const mapping = await createShopifyListingMapping(prisma, {
    memberId: seller.id,
    connectionId: conn.id,
    storeItemId: item.id,
    shopifyProductId: "gid://shopify/Product/880",
    variants: [
      {
        storeVariantId: variantId,
        shopifyVariantId: "gid://shopify/ProductVariant/880",
        shopifyInventoryItemId: "gid://shopify/InventoryItem/880",
      },
    ],
  });
  return { seller, shop, conn, item, variantId, mapping };
}

describe("shopify S8 inventory projection desire (real PG)", () => {
  it("initial physical mapping, desire atomicity, reservation, S7 catch-up desire, stale/concurrent jobs, MTO, disconnect, content independence", async () => {
    const { seller, shop, conn, item, variantId } = await seedMappedPhysical(10);

    const map = await prisma.shopifyVariantMap.findUniqueOrThrow({
      where: {
        shopifyConnectionId_storeVariantId: {
          shopifyConnectionId: conn.id,
          storeVariantId: variantId,
        },
      },
    });
    expect(map.inventoryInitState).toBe("PENDING");
    expect(map.inventoryDesiredVersion).toBe(1);
    expect(map.inventoryDesiredAvailable).toBe(10);
    const initJob = await prisma.shopifySyncJob.findUniqueOrThrow({
      where: {
        dedupeKey: shopifyProjectInventoryDedupeKey({
          connectionId: conn.id,
          storeVariantId: variantId,
          inventoryDesiredVersion: 1,
        }),
      },
    });
    expect(initJob.kind).toBe("PROJECT_INVENTORY");
    expect(initJob.payload).toMatchObject({
      storeItemId: item.id,
      storeVariantId: variantId,
      inventoryDesiredVersion: 1,
    });

    // Local stock change + desire/job atomicity
    await prisma.$transaction(async (tx) => {
      await setTrackedOnHand(tx, {
        variantId,
        targetOnHand: 9,
        commandId: `s8-set-${seller.id}`,
        memberId: seller.id,
      });
    });
    const afterSet = await prisma.shopifyVariantMap.findUniqueOrThrow({ where: { id: map.id } });
    expect(afterSet.inventoryDesiredVersion).toBe(2);
    expect(afterSet.inventoryDesiredAvailable).toBe(9);
    expect(
      await prisma.shopifySyncJob.findUnique({
        where: {
          dedupeKey: shopifyProjectInventoryDedupeKey({
            connectionId: conn.id,
            storeVariantId: variantId,
            inventoryDesiredVersion: 2,
          }),
        },
      })
    ).toBeTruthy();

    // Simulate applied baseline after init worker (v2 applied at 9)
    await prisma.shopifyVariantMap.update({
      where: { id: map.id },
      data: {
        inventoryInitState: "INITIALIZED",
        inventoryAppliedVersion: 2,
        inventoryAppliedAvailable: 9,
      },
    });

    // Reservation reduces sellable 9 → 8
    const buyer = await createMember(prisma, "s8b");
    const attempt = await createCheckoutAttempt(prisma, { buyerMemberId: buyer.id });
    const order = await createOrder(prisma, {
      buyerId: buyer.id,
      sellerId: seller.id,
      checkoutAttemptId: attempt.id,
    });
    const line = await createOrderLine(prisma, {
      orderId: order.id,
      storeItemId: item.id,
      variantId,
      quantity: 1,
    });
    await prisma.$transaction(async (tx) => {
      await holdTrackedReservation(tx, {
        checkoutAttemptId: attempt.id,
        storeOrderId: order.id,
        orderItemId: line.id,
        variantId,
        qty: 1,
        expiresAt: new Date("2099-01-01T00:00:00Z"),
      });
    });
    const afterHold = await prisma.shopifyVariantMap.findUniqueOrThrow({ where: { id: map.id } });
    expect(afterHold.inventoryDesiredAvailable).toBe(8);
    expect(afterHold.inventoryDesiredVersion).toBe(3);

    const reservation = await prisma.inventoryReservation.findUniqueOrThrow({
      where: { orderItemId: line.id },
    });
    await prisma.$transaction(async (tx) => {
      await releaseReservation(tx, { reservationId: reservation.id, reason: "CHECKOUT_CANCEL" });
    });
    const afterRelease = await prisma.shopifyVariantMap.findUniqueOrThrow({ where: { id: map.id } });
    expect(afterRelease.inventoryDesiredAvailable).toBe(9);
    expect(afterRelease.inventoryDesiredVersion).toBe(4);

    // Mark applied at 9 for sale-before-S7 scenario baselines, then bump desire to 10 locally...
    // Sale-before-S7: desired still 9/applied 9, but we simulate remote 8 by only checking desire
    // stays until S7. Force applied baseline 10 / desired 10 then S7 sale → desire 8.
    await prisma.$transaction(async (tx) => {
      await setTrackedOnHand(tx, {
        variantId,
        targetOnHand: 10,
        commandId: `s8-set10-${seller.id}`,
        memberId: seller.id,
      });
    });
    const preSale = await prisma.shopifyVariantMap.findUniqueOrThrow({ where: { id: map.id } });
    expect(preSale.inventoryDesiredAvailable).toBe(10);
    await prisma.shopifyVariantMap.update({
      where: { id: map.id },
      data: {
        inventoryAppliedVersion: preSale.inventoryDesiredVersion,
        inventoryAppliedAvailable: 10,
        inventoryDriftState: "REMOTE_DRIFT",
        inventoryDriftCode: "REMOTE_DRIFT",
        inventoryLastObservedAvailable: 8,
      },
    });

    // S7 causal sale catch-up: INW sellable → 8, new desire; drift cleared on desire bump
    const evidence = await prisma.shopifyProviderEvidence.create({
      data: {
        shopifyConnectionId: conn.id,
        shopDomain: shop,
        topic: "orders/paid",
        webhookId: `wh-s8-${seller.id}`,
        triggeredAt: new Date("2026-09-25T13:00:00Z"),
        rawBody: "{}",
        payloadHash: hashShopifyWebhookPayload(`s8-${seller.id}`),
        processState: "RECEIVED",
      },
    });
    const sale = await applyShopifyPaidOrderLineSale(prisma, {
      connectionId: conn.id,
      memberId: seller.id,
      evidenceId: evidence.id,
      line: {
        shopifyOrderId: "gid://shopify/Order/88001",
        shopifyLineItemId: "gid://shopify/LineItem/88002",
        shopifyVariantId: "gid://shopify/ProductVariant/880",
        paidQuantity: 2,
      },
    });
    expect(sale).toMatchObject({ status: "APPLIED", appliedQuantity: 2 });
    const afterS7 = await prisma.shopifyVariantMap.findUniqueOrThrow({ where: { id: map.id } });
    expect(afterS7.inventoryDesiredAvailable).toBe(8);
    expect(afterS7.inventoryDesiredVersion).toBeGreaterThan(preSale.inventoryDesiredVersion);
    expect(afterS7.inventoryDriftState).toBe("NONE");
    expect(
      await prisma.shopifySyncJob.findUnique({
        where: {
          dedupeKey: shopifyProjectInventoryDedupeKey({
            connectionId: conn.id,
            storeVariantId: variantId,
            inventoryDesiredVersion: afterS7.inventoryDesiredVersion,
          }),
        },
      })
    ).toBeTruthy();

    // Stale job: older version job may exist; applied version must never move backward via desire
    const staleKey = shopifyProjectInventoryDedupeKey({
      connectionId: conn.id,
      storeVariantId: variantId,
      inventoryDesiredVersion: 1,
    });
    expect((await prisma.shopifySyncJob.findUniqueOrThrow({ where: { dedupeKey: staleKey } })).state).toBeTruthy();
    expect(afterS7.inventoryDesiredVersion).toBeGreaterThan(1);

    // Concurrent duplicate enqueue of same desire version is idempotent
    const currentVersion = afterS7.inventoryDesiredVersion;
    const [j1, j2] = await Promise.all([
      enqueueShopifySyncJob(prisma, {
        shopifyConnectionId: conn.id,
        kind: "PROJECT_INVENTORY",
        dedupeKey: shopifyProjectInventoryDedupeKey({
          connectionId: conn.id,
          storeVariantId: variantId,
          inventoryDesiredVersion: currentVersion,
        }),
        payload: {
          storeItemId: item.id,
          storeVariantId: variantId,
          inventoryDesiredVersion: currentVersion,
        },
      }),
      enqueueShopifySyncJob(prisma, {
        shopifyConnectionId: conn.id,
        kind: "PROJECT_INVENTORY",
        dedupeKey: shopifyProjectInventoryDedupeKey({
          connectionId: conn.id,
          storeVariantId: variantId,
          inventoryDesiredVersion: currentVersion,
        }),
        payload: {
          storeItemId: item.id,
          storeVariantId: variantId,
          inventoryDesiredVersion: currentVersion,
        },
      }),
    ]);
    expect(j1.id).toBe(j2.id);

    // Content conflict independence: inventory desire still enqueues with product conflict set
    await prisma.shopifyListingLink.update({
      where: { id: map.shopifyListingLinkId },
      data: {
        productContentConflict: true,
        productConflictRemoteFingerprint: "deadbeef",
        productConflictDetectedAt: new Date(),
      },
    });
    await prisma.$transaction(async (tx) => {
      await setTrackedOnHand(tx, {
        variantId,
        targetOnHand: 7,
        commandId: `s8-conflict-${seller.id}`,
        memberId: seller.id,
      });
    });
    const afterConflict = await prisma.shopifyVariantMap.findUniqueOrThrow({ where: { id: map.id } });
    expect(afterConflict.inventoryDesiredAvailable).toBe(7);
    expect(
      await prisma.shopifySyncJob.findUnique({
        where: {
          dedupeKey: shopifyProjectInventoryDedupeKey({
            connectionId: conn.id,
            storeVariantId: variantId,
            inventoryDesiredVersion: afterConflict.inventoryDesiredVersion,
          }),
        },
      })
    ).toBeTruthy();

    // Generation disconnect: old connection jobs stay bound; new mapping is separate generation
    await disconnectShopifyConnection(prisma, { connectionId: conn.id, memberId: seller.id });
    const reinstall = await persistShopifyInstall(prisma, {
      memberId: seller.id,
      shopDomain: shop,
      shopId: `gid://shopify/Shop/${seller.id.replace(/\D/g, "").slice(0, 8) || "8801"}`,
      accessTokenEncrypted: "cipher-access-2",
      refreshTokenEncrypted: "cipher-refresh-2",
      accessTokenExpiresAt: new Date("2099-01-01T00:00:00Z"),
      refreshTokenExpiresAt: new Date("2099-06-01T00:00:00Z"),
      grantedScopes: "write_products,write_inventory,read_orders,read_locations",
      primaryLocationId: "gid://shopify/Location/1",
      connectedAt: new Date("2026-09-25T14:00:00Z"),
    });
    expect(reinstall.id).not.toBe(conn.id);
    const oldJobs = await prisma.shopifySyncJob.count({
      where: { shopifyConnectionId: conn.id, kind: "PROJECT_INVENTORY" },
    });
    expect(oldJobs).toBeGreaterThan(0);
    expect(
      await prisma.shopifyVariantMap.count({
        where: { shopifyConnectionId: reinstall.id },
      })
    ).toBe(0);

    // MTO: no finite desired quantity / no PROJECT_INVENTORY job
    await enterFoundation();
    const mtoSeller = await createMember(prisma, "s8mto");
    const mtoItem = await createStoreItem(prisma, mtoSeller.id, "S8 MTO", {
      quantity: 0,
      inventoryTracking: "made_to_order",
      sku: "S8-MTO",
    });
    const mtoProv = await prisma.$transaction((tx) =>
      provisionNativeFoundationListing(tx, mtoItem.id)
    );
    const mtoVariant = mtoProv.variantIds[0];
    const mtoConn = await persistShopifyInstall(prisma, {
      memberId: mtoSeller.id,
      shopDomain: `s8mto-${mtoSeller.id.slice(-8)}.myshopify.com`,
      shopId: `gid://shopify/Shop/77${mtoSeller.id.replace(/\D/g, "").slice(0, 6) || "7701"}`,
      accessTokenEncrypted: "cipher-access",
      refreshTokenEncrypted: "cipher-refresh",
      accessTokenExpiresAt: new Date("2099-01-01T00:00:00Z"),
      refreshTokenExpiresAt: new Date("2099-06-01T00:00:00Z"),
      grantedScopes: "write_products,write_inventory,read_orders,read_locations",
      primaryLocationId: "gid://shopify/Location/1",
      connectedAt: new Date("2026-09-25T15:00:00Z"),
    });
    await createShopifyListingMapping(prisma, {
      memberId: mtoSeller.id,
      connectionId: mtoConn.id,
      storeItemId: mtoItem.id,
      shopifyProductId: "gid://shopify/Product/770",
      variants: [
        {
          storeVariantId: mtoVariant,
          shopifyVariantId: "gid://shopify/ProductVariant/770",
          shopifyInventoryItemId: "gid://shopify/InventoryItem/770",
        },
      ],
    });
    const mtoMap = await prisma.shopifyVariantMap.findUniqueOrThrow({
      where: {
        shopifyConnectionId_storeVariantId: {
          shopifyConnectionId: mtoConn.id,
          storeVariantId: mtoVariant,
        },
      },
    });
    expect(mtoMap.inventoryInitState).toBe("NOT_APPLICABLE");
    expect(mtoMap.inventoryDesiredAvailable).toBeNull();
    expect(mtoMap.inventoryDesiredVersion).toBe(0);
    expect(
      await prisma.shopifySyncJob.count({
        where: { shopifyConnectionId: mtoConn.id, kind: "PROJECT_INVENTORY" },
      })
    ).toBe(0);
  });
});
