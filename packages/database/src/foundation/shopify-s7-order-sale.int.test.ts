import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  COMMERCE_FOUNDATION_CUTOVER_SINGLETON_ID,
  transitionCommerceFoundationCutover,
} from "../commerce-foundation-cutover";
import {
  applyTrackedMarketplaceSale,
  convertReservation,
  holdTrackedReservation,
} from "../commerce-foundation-inventory";
import { provisionNativeFoundationListing } from "../commerce-foundation-listing";
import { persistShopifyInstall, disconnectShopifyConnection } from "../shopify/connection";
import { createShopifyListingMapping } from "../shopify/mapping";
import {
  applyShopifyPaidOrderLineSale,
  applyShopifyPaidOrderObservation,
  parseShopifyOrdersPaidWebhookBody,
} from "../shopify/order-sale";
import { hashShopifyWebhookPayload } from "../shopify/evidence";
import { createMember, createStoreItem } from "./fixtures";
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
    engineSha: "engine-s7",
    manifestHash: "manifest-s7",
  });
  await transitionCommerceFoundationCutover(prisma, { to: "FOUNDATION" });
}

async function activeConnection(memberId: string, shop: string, shopId: string, connectedAt: Date) {
  return persistShopifyInstall(prisma, {
    memberId,
    shopDomain: shop,
    shopId,
    accessTokenEncrypted: "cipher-access",
    refreshTokenEncrypted: "cipher-refresh",
    accessTokenExpiresAt: new Date("2099-01-01T00:00:00Z"),
    refreshTokenExpiresAt: new Date("2099-06-01T00:00:00Z"),
    grantedScopes: "write_products,write_inventory,read_orders,read_locations",
    primaryLocationId: "gid://shopify/Location/1",
    connectedAt,
  });
}

async function createEvidence(input: {
  connectionId: string;
  shopDomain: string;
  webhookId: string;
  rawBody: string;
}) {
  return prisma.shopifyProviderEvidence.create({
    data: {
      shopifyConnectionId: input.connectionId,
      shopDomain: input.shopDomain,
      topic: "orders/paid",
      webhookId: input.webhookId,
      triggeredAt: new Date("2026-09-25T12:00:00Z"),
      rawBody: input.rawBody,
      payloadHash: hashShopifyWebhookPayload(input.rawBody),
      processState: "RECEIVED",
    },
  });
}

function paidBody(input: {
  orderId: number;
  lines: Array<{ lineId: number; variantId: number; quantity: number }>;
}) {
  return JSON.stringify({
    id: input.orderId,
    admin_graphql_api_id: `gid://shopify/Order/${input.orderId}`,
    financial_status: "paid",
    line_items: input.lines.map((line) => ({
      id: line.lineId,
      admin_graphql_api_id: `gid://shopify/LineItem/${line.lineId}`,
      quantity: line.quantity,
      current_quantity: line.quantity,
      variant_id: line.variantId,
      sku: "SHOULD-NOT-USE",
      title: "Should Not Use Title",
    })),
  });
}

describe("shopify S7 paid order → Foundation SALE", () => {
  it("single sale, duplicates, cross-channel, multi-line/order, unmapped, generation, conflict, MTO, concurrency", async () => {
    await enterFoundation();
    const seller = await createMember(prisma, "s7");
    const shop = `s7-${seller.id.slice(-8)}.myshopify.com`;
    const shopId = `gid://shopify/Shop/${seller.id.replace(/\D/g, "").slice(0, 8) || "7701"}`;

    const item = await createStoreItem(prisma, seller.id, "S7 Tracked", {
      quantity: 10,
      sku: "S7-SKU",
      priceCents: 1000,
    });
    const provisioned = await prisma.$transaction((tx) =>
      provisionNativeFoundationListing(tx, item.id)
    );
    const variantId = provisioned.variantIds[0];

    const beforeOrders = await prisma.storeOrder.count();
    const beforeConflicts = 0;

    const gen1 = await activeConnection(seller.id, shop, shopId, new Date("2026-09-24T12:00:00Z"));
    await createShopifyListingMapping(prisma, {
      memberId: seller.id,
      connectionId: gen1.id,
      storeItemId: item.id,
      shopifyProductId: "gid://shopify/Product/700",
      variants: [
        {
          storeVariantId: variantId,
          shopifyVariantId: "gid://shopify/ProductVariant/800",
          shopifyInventoryItemId: "gid://shopify/InventoryItem/900",
        },
      ],
    });

    // Content conflict independence: unresolved S6 conflict must not block SALE.
    await prisma.shopifyListingLink.updateMany({
      where: { shopifyConnectionId: gen1.id, storeItemId: item.id },
      data: {
        productContentConflict: true,
        productConflictRemoteFingerprint: "conflict-fp",
        productConflictDetectedAt: new Date(),
      },
    });

    const bodyA = paidBody({
      orderId: 1001,
      lines: [{ lineId: 2001, variantId: 800, quantity: 2 }],
    });
    const evidenceA = await createEvidence({
      connectionId: gen1.id,
      shopDomain: shop,
      webhookId: `wh-sale-a-${seller.id}`,
      rawBody: bodyA,
    });
    const parsedA = parseShopifyOrdersPaidWebhookBody(bodyA)!;
    const first = await applyShopifyPaidOrderObservation(prisma, {
      connectionId: gen1.id,
      memberId: seller.id,
      evidenceId: evidenceA.id,
      lines: parsedA.lines,
    });
    expect(first.lines[0]).toMatchObject({ status: "APPLIED", appliedQuantity: 2 });
    expect((await prisma.inventoryState.findUniqueOrThrow({ where: { variantId } })).onHand).toBe(8);
    expect(
      await prisma.inventoryEvent.count({
        where: { variantId, eventType: "SALE", sourceSystem: "shopify" },
      })
    ).toBe(1);
    expect(
      (await prisma.shopifyListingLink.findFirstOrThrow({ where: { shopifyConnectionId: gen1.id } }))
        .productContentConflict
    ).toBe(true);

    // Duplicate delivery same evidence identity path — already applied fact
    const dup1 = await applyShopifyPaidOrderLineSale(prisma, {
      connectionId: gen1.id,
      memberId: seller.id,
      evidenceId: evidenceA.id,
      line: parsedA.lines[0],
    });
    expect(dup1.status).toBe("ALREADY_APPLIED");
    expect((await prisma.inventoryState.findUniqueOrThrow({ where: { variantId } })).onHand).toBe(8);

    // Different webhook / evidence, same order+line → still one decrement
    const evidenceA2 = await createEvidence({
      connectionId: gen1.id,
      shopDomain: shop,
      webhookId: `wh-sale-a2-${seller.id}`,
      rawBody: bodyA,
    });
    const dup2 = await applyShopifyPaidOrderObservation(prisma, {
      connectionId: gen1.id,
      memberId: seller.id,
      evidenceId: evidenceA2.id,
      lines: parsedA.lines,
    });
    expect(dup2.lines[0].status).toBe("ALREADY_APPLIED");
    expect((await prisma.inventoryState.findUniqueOrThrow({ where: { variantId } })).onHand).toBe(8);
    expect(
      await prisma.inventoryEvent.count({
        where: { variantId, eventType: "SALE", sourceSystem: "shopify" },
      })
    ).toBe(1);
    expect(await prisma.shopifyOrderLineSaleFact.count({ where: { shopifyConnectionId: gen1.id } })).toBe(
      1
    );

    // Concurrent duplicate processors
    const bodyRace = paidBody({
      orderId: 1002,
      lines: [{ lineId: 2002, variantId: 800, quantity: 1 }],
    });
    const evidenceRace = await createEvidence({
      connectionId: gen1.id,
      shopDomain: shop,
      webhookId: `wh-race-${seller.id}`,
      rawBody: bodyRace,
    });
    const raceLine = parseShopifyOrdersPaidWebhookBody(bodyRace)!.lines[0];
    const [r1, r2] = await Promise.all([
      applyShopifyPaidOrderLineSale(prisma, {
        connectionId: gen1.id,
        memberId: seller.id,
        evidenceId: evidenceRace.id,
        line: raceLine,
      }),
      applyShopifyPaidOrderLineSale(prisma, {
        connectionId: gen1.id,
        memberId: seller.id,
        evidenceId: evidenceRace.id,
        line: raceLine,
      }),
    ]);
    const raceStatuses = [r1.status, r2.status].sort();
    expect(raceStatuses).toEqual(["ALREADY_APPLIED", "APPLIED"]);
    expect((await prisma.inventoryState.findUniqueOrThrow({ where: { variantId } })).onHand).toBe(7);
    expect(
      await prisma.inventoryEvent.count({
        where: {
          variantId,
          eventType: "SALE",
          sourceFactId: "gid://shopify/Order/1002:gid://shopify/LineItem/2002",
        },
      })
    ).toBe(1);

    // Second Shopify order same variant qty 1 → total Shopify decrements so far: 2+1+1=4 → onHand 6? Wait started 10, -2=8, -1=7. Next order -1 → 6.
    const bodyB = paidBody({
      orderId: 1003,
      lines: [{ lineId: 2003, variantId: 800, quantity: 1 }],
    });
    const evidenceB = await createEvidence({
      connectionId: gen1.id,
      shopDomain: shop,
      webhookId: `wh-b-${seller.id}`,
      rawBody: bodyB,
    });
    await applyShopifyPaidOrderObservation(prisma, {
      connectionId: gen1.id,
      memberId: seller.id,
      evidenceId: evidenceB.id,
      lines: parseShopifyOrdersPaidWebhookBody(bodyB)!.lines,
    });
    expect((await prisma.inventoryState.findUniqueOrThrow({ where: { variantId } })).onHand).toBe(6);

    // Cross-channel: INW HOLD+CONVERT qty 1 then Shopify qty 2 from fresh item
    const item2 = await createStoreItem(prisma, seller.id, "S7 Cross", {
      quantity: 10,
      sku: "S7-X",
      priceCents: 1000,
    });
    const prov2 = await prisma.$transaction((tx) => provisionNativeFoundationListing(tx, item2.id));
    const v2 = prov2.variantIds[0];
    const gen1b = gen1; // same connection
    await createShopifyListingMapping(prisma, {
      memberId: seller.id,
      connectionId: gen1b.id,
      storeItemId: item2.id,
      shopifyProductId: "gid://shopify/Product/701",
      variants: [
        {
          storeVariantId: v2,
          shopifyVariantId: "gid://shopify/ProductVariant/801",
          shopifyInventoryItemId: "gid://shopify/InventoryItem/901",
        },
      ],
    });
    const attempt = await prisma.checkoutAttempt.create({
      data: {
        buyerMemberId: seller.id,
        cartHash: "hash",
        amountCents: 1000,
        stripeIdempotencyKey: `s7-x-${seller.id}`,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const order = await prisma.storeOrder.create({
      data: {
        buyerId: seller.id,
        sellerId: seller.id,
        totalCents: 1000,
        subtotalCents: 1000,
        checkoutAttemptId: attempt.id,
      },
    });
    const orderItem = await prisma.orderItem.create({
      data: {
        orderId: order.id,
        storeItemId: item2.id,
        quantity: 1,
        priceCentsAtPurchase: 1000,
        variantId: v2,
      },
    });
    await prisma.$transaction(async (tx) => {
      await holdTrackedReservation(tx, {
        checkoutAttemptId: attempt.id,
        storeOrderId: order.id,
        orderItemId: orderItem.id,
        variantId: v2,
        qty: 1,
        expiresAt: new Date(Date.now() + 60_000),
      });
      const reservation = await tx.inventoryReservation.findUniqueOrThrow({
        where: { orderItemId: orderItem.id },
      });
      await convertReservation(tx, { reservationId: reservation.id });
    });
    expect((await prisma.inventoryState.findUniqueOrThrow({ where: { variantId: v2 } })).onHand).toBe(9);

    const bodyX = paidBody({
      orderId: 2001,
      lines: [{ lineId: 3001, variantId: 801, quantity: 2 }],
    });
    const evidenceX = await createEvidence({
      connectionId: gen1b.id,
      shopDomain: shop,
      webhookId: `wh-x-${seller.id}`,
      rawBody: bodyX,
    });
    await applyShopifyPaidOrderObservation(prisma, {
      connectionId: gen1b.id,
      memberId: seller.id,
      evidenceId: evidenceX.id,
      lines: parseShopifyOrdersPaidWebhookBody(bodyX)!.lines,
    });
    expect((await prisma.inventoryState.findUniqueOrThrow({ where: { variantId: v2 } })).onHand).toBe(7);

    // Reverse order: Shopify 2 first then INW 1 on fresh stock 10 → 7
    const item3 = await createStoreItem(prisma, seller.id, "S7 Cross2", {
      quantity: 10,
      sku: "S7-X2",
      priceCents: 1000,
    });
    const prov3 = await prisma.$transaction((tx) => provisionNativeFoundationListing(tx, item3.id));
    const v3 = prov3.variantIds[0];
    await createShopifyListingMapping(prisma, {
      memberId: seller.id,
      connectionId: gen1.id,
      storeItemId: item3.id,
      shopifyProductId: "gid://shopify/Product/702",
      variants: [
        {
          storeVariantId: v3,
          shopifyVariantId: "gid://shopify/ProductVariant/802",
          shopifyInventoryItemId: "gid://shopify/InventoryItem/902",
        },
      ],
    });
    const bodyY = paidBody({
      orderId: 2002,
      lines: [{ lineId: 3002, variantId: 802, quantity: 2 }],
    });
    const evidenceY = await createEvidence({
      connectionId: gen1.id,
      shopDomain: shop,
      webhookId: `wh-y-${seller.id}`,
      rawBody: bodyY,
    });
    await applyShopifyPaidOrderObservation(prisma, {
      connectionId: gen1.id,
      memberId: seller.id,
      evidenceId: evidenceY.id,
      lines: parseShopifyOrdersPaidWebhookBody(bodyY)!.lines,
    });
    expect((await prisma.inventoryState.findUniqueOrThrow({ where: { variantId: v3 } })).onHand).toBe(8);
    const attempt2 = await prisma.checkoutAttempt.create({
      data: {
        buyerMemberId: seller.id,
        cartHash: "hash2",
        amountCents: 1000,
        stripeIdempotencyKey: `s7-y-${seller.id}`,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const order2 = await prisma.storeOrder.create({
      data: {
        buyerId: seller.id,
        sellerId: seller.id,
        totalCents: 1000,
        subtotalCents: 1000,
        checkoutAttemptId: attempt2.id,
      },
    });
    const orderItem2 = await prisma.orderItem.create({
      data: {
        orderId: order2.id,
        storeItemId: item3.id,
        quantity: 1,
        priceCentsAtPurchase: 1000,
        variantId: v3,
      },
    });
    await prisma.$transaction(async (tx) => {
      await holdTrackedReservation(tx, {
        checkoutAttemptId: attempt2.id,
        storeOrderId: order2.id,
        orderItemId: orderItem2.id,
        variantId: v3,
        qty: 1,
        expiresAt: new Date(Date.now() + 60_000),
      });
      const reservation = await tx.inventoryReservation.findUniqueOrThrow({
        where: { orderItemId: orderItem2.id },
      });
      await convertReservation(tx, { reservationId: reservation.id });
    });
    expect((await prisma.inventoryState.findUniqueOrThrow({ where: { variantId: v3 } })).onHand).toBe(7);

    // Multi-line one order: two mapped variants
    const item4 = await createStoreItem(prisma, seller.id, "S7 B", {
      quantity: 5,
      sku: "S7-B",
      priceCents: 500,
    });
    const prov4 = await prisma.$transaction((tx) => provisionNativeFoundationListing(tx, item4.id));
    const v4 = prov4.variantIds[0];
    await createShopifyListingMapping(prisma, {
      memberId: seller.id,
      connectionId: gen1.id,
      storeItemId: item4.id,
      shopifyProductId: "gid://shopify/Product/703",
      variants: [
        {
          storeVariantId: v4,
          shopifyVariantId: "gid://shopify/ProductVariant/803",
          shopifyInventoryItemId: "gid://shopify/InventoryItem/903",
        },
      ],
    });
    // Reset item/variant A stock for multi-line — use current item (onHand 6) + item4
    const multiBody = paidBody({
      orderId: 4001,
      lines: [
        { lineId: 4002, variantId: 800, quantity: 2 },
        { lineId: 4003, variantId: 803, quantity: 3 },
      ],
    });
    const evidenceM = await createEvidence({
      connectionId: gen1.id,
      shopDomain: shop,
      webhookId: `wh-multi-${seller.id}`,
      rawBody: multiBody,
    });
    const multi = await applyShopifyPaidOrderObservation(prisma, {
      connectionId: gen1.id,
      memberId: seller.id,
      evidenceId: evidenceM.id,
      lines: parseShopifyOrdersPaidWebhookBody(multiBody)!.lines,
    });
    expect(multi.lines.map((l) => l.status).sort()).toEqual(["APPLIED", "APPLIED"]);
    expect((await prisma.inventoryState.findUniqueOrThrow({ where: { variantId } })).onHand).toBe(4);
    expect((await prisma.inventoryState.findUniqueOrThrow({ where: { variantId: v4 } })).onHand).toBe(2);

    // Unmapped variant — no invent / no decrement
    const unmappedBody = paidBody({
      orderId: 5001,
      lines: [{ lineId: 5002, variantId: 999999, quantity: 2 }],
    });
    const evidenceU = await createEvidence({
      connectionId: gen1.id,
      shopDomain: shop,
      webhookId: `wh-unmap-${seller.id}`,
      rawBody: unmappedBody,
    });
    const onHandBeforeUnmapped = (
      await prisma.inventoryState.findUniqueOrThrow({ where: { variantId } })
    ).onHand;
    const unmapped = await applyShopifyPaidOrderObservation(prisma, {
      connectionId: gen1.id,
      memberId: seller.id,
      evidenceId: evidenceU.id,
      lines: parseShopifyOrdersPaidWebhookBody(unmappedBody)!.lines,
    });
    expect(unmapped.lines[0].status).toBe("UNMAPPED");
    expect((await prisma.inventoryState.findUniqueOrThrow({ where: { variantId } })).onHand).toBe(
      onHandBeforeUnmapped
    );
    expect(await prisma.storeVariant.count({ where: { memberId: seller.id, sku: "SHOULD-NOT-USE" } })).toBe(
      0
    );

    // Generation isolation: disconnect gen1, create gen2 mapping for new product; delayed gen1 evidence stays on gen1
    await disconnectShopifyConnection(prisma, { memberId: seller.id, connectionId: gen1.id });
    const gen2 = await activeConnection(
      seller.id,
      shop,
      shopId,
      new Date("2026-09-24T16:00:00Z")
    );
    expect(gen2.generation).toBe(2);
    const delayed = await applyShopifyPaidOrderLineSale(prisma, {
      connectionId: gen1.id,
      memberId: seller.id,
      evidenceId: evidenceA.id,
      line: {
        shopifyOrderId: "gid://shopify/Order/1001",
        shopifyLineItemId: "gid://shopify/LineItem/2001",
        shopifyVariantId: "gid://shopify/ProductVariant/800",
        paidQuantity: 2,
      },
    });
    expect(delayed.status).toBe("ALREADY_APPLIED");
    // Gen2 has no mapping for variant 800 — must not apply gen1 sale under gen2
    const wrongGen = await applyShopifyPaidOrderLineSale(prisma, {
      connectionId: gen2.id,
      memberId: seller.id,
      evidenceId: evidenceA.id,
      line: {
        shopifyOrderId: "gid://shopify/Order/1001",
        shopifyLineItemId: "gid://shopify/LineItem/2001",
        shopifyVariantId: "gid://shopify/ProductVariant/800",
        paidQuantity: 2,
      },
    });
    expect(wrongGen.status).toBe("UNMAPPED");

    // MTO — no finite 999 / no onHand invent
    const mtoItem = await createStoreItem(prisma, seller.id, "S7 MTO", {
      quantity: 0,
      inventoryTracking: "made_to_order",
      sku: "S7-MTO",
      priceCents: 2000,
    });
    const mtoProv = await prisma.$transaction((tx) =>
      provisionNativeFoundationListing(tx, mtoItem.id)
    );
    const mtoVariant = mtoProv.variantIds[0];
    const mtoState = await prisma.inventoryState.findUniqueOrThrow({ where: { variantId: mtoVariant } });
    expect(mtoState.mode).toBe("MADE_TO_ORDER");
    expect(mtoState.onHand).toBeNull();
    await createShopifyListingMapping(prisma, {
      memberId: seller.id,
      connectionId: gen2.id,
      storeItemId: mtoItem.id,
      shopifyProductId: "gid://shopify/Product/800",
      variants: [
        {
          storeVariantId: mtoVariant,
          shopifyVariantId: "gid://shopify/ProductVariant/880",
          shopifyInventoryItemId: "gid://shopify/InventoryItem/980",
        },
      ],
    });
    const mtoBody = paidBody({
      orderId: 6001,
      lines: [{ lineId: 6002, variantId: 880, quantity: 2 }],
    });
    const evidenceMto = await createEvidence({
      connectionId: gen2.id,
      shopDomain: shop,
      webhookId: `wh-mto-${seller.id}`,
      rawBody: mtoBody,
    });
    const mto = await applyShopifyPaidOrderObservation(prisma, {
      connectionId: gen2.id,
      memberId: seller.id,
      evidenceId: evidenceMto.id,
      lines: parseShopifyOrdersPaidWebhookBody(mtoBody)!.lines,
    });
    expect(mto.lines[0]).toMatchObject({ status: "APPLIED", appliedQuantity: 2, inventoryEventId: null });
    const mtoAfter = await prisma.inventoryState.findUniqueOrThrow({ where: { variantId: mtoVariant } });
    expect(mtoAfter.onHand).toBeNull();
    expect(mtoAfter.onHand).not.toBe(999);
    expect(
      await prisma.inventoryEvent.count({
        where: { variantId: mtoVariant, eventType: "SALE" },
      })
    ).toBe(0);

    // Crash/replay: applyTrackedMarketplaceSale idempotent after fact already applied
    await prisma.$transaction((tx) =>
      applyTrackedMarketplaceSale(tx, {
        variantId: v2,
        memberId: seller.id,
        qty: 2,
        sourceScope: gen1.id,
        sourceFactId: "gid://shopify/Order/2001:gid://shopify/LineItem/3001",
      })
    );
    expect((await prisma.inventoryState.findUniqueOrThrow({ where: { variantId: v2 } })).onHand).toBe(7);

    expect(await prisma.storeOrder.count()).toBe(beforeOrders + 2); // only the INW checkout orders we created for cross-channel
    void beforeConflicts;
  });
});
