import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  COMMERCE_FOUNDATION_CUTOVER_SINGLETON_ID,
  transitionCommerceFoundationCutover,
} from "../commerce-foundation-cutover";
import { provisionNativeFoundationListing } from "../commerce-foundation-listing";
import { persistShopifyInstall } from "../shopify/connection";
import { createShopifyListingMapping } from "../shopify/mapping";
import { applyShopifyPaidOrderLineSale } from "../shopify/order-sale";
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
    engineSha: "engine-s7c",
    manifestHash: "manifest-s7c",
  });
  await transitionCommerceFoundationCutover(prisma, { to: "FOUNDATION" });
}

async function seedMappedTracked(qty: number) {
  await enterFoundation();
  const seller = await createMember(prisma, "s7c");
  const shop = `s7c-${seller.id.slice(-8)}.myshopify.com`;
  const shopId = `gid://shopify/Shop/${seller.id.replace(/\D/g, "").slice(0, 8) || "7801"}`;
  const item = await createStoreItem(prisma, seller.id, "S7C Tracked", {
    quantity: qty,
    sku: "S7C",
    priceCents: 1000,
  });
  const provisioned = await prisma.$transaction((tx) =>
    provisionNativeFoundationListing(tx, item.id)
  );
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
    connectedAt: new Date("2026-09-24T12:00:00Z"),
  });
  await createShopifyListingMapping(prisma, {
    memberId: seller.id,
    connectionId: conn.id,
    storeItemId: item.id,
    shopifyProductId: "gid://shopify/Product/710",
    variants: [
      {
        storeVariantId: variantId,
        shopifyVariantId: "gid://shopify/ProductVariant/810",
        shopifyInventoryItemId: "gid://shopify/InventoryItem/910",
      },
    ],
  });
  return { seller, shop, conn, item, variantId };
}

async function evidence(connectionId: string, shopDomain: string, webhookId: string) {
  const rawBody = JSON.stringify({ id: 1, line_items: [] });
  return prisma.shopifyProviderEvidence.create({
    data: {
      shopifyConnectionId: connectionId,
      shopDomain,
      topic: "orders/paid",
      webhookId,
      triggeredAt: new Date("2026-09-25T12:00:00Z"),
      rawBody,
      payloadHash: hashShopifyWebhookPayload(rawBody + webhookId),
      processState: "RECEIVED",
    },
  });
}

describe("shopify S7 conflicting sale-fact equivalence", () => {
  it("exact applied replay, quantity/variant conflicts, unmapped recovery, storeVariant conflict, concurrent conflict", async () => {
    const { seller, shop, conn, variantId } = await seedMappedTracked(10);
    const e1 = await evidence(conn.id, shop, `wh-c1-${seller.id}`);
    const e2 = await evidence(conn.id, shop, `wh-c2-${seller.id}`);
    const e3 = await evidence(conn.id, shop, `wh-c3-${seller.id}`);
    const e4 = await evidence(conn.id, shop, `wh-c4-${seller.id}`);
    const e5 = await evidence(conn.id, shop, `wh-c5-${seller.id}`);
    const e6 = await evidence(conn.id, shop, `wh-c6-${seller.id}`);

    const line = {
      shopifyOrderId: "gid://shopify/Order/91001",
      shopifyLineItemId: "gid://shopify/LineItem/92001",
      shopifyVariantId: "gid://shopify/ProductVariant/810",
      paidQuantity: 2,
    };

    const first = await applyShopifyPaidOrderLineSale(prisma, {
      connectionId: conn.id,
      memberId: seller.id,
      evidenceId: e1.id,
      line,
    });
    expect(first).toMatchObject({ status: "APPLIED", appliedQuantity: 2 });
    expect((await prisma.inventoryState.findUniqueOrThrow({ where: { variantId } })).onHand).toBe(8);

    // Exact applied replay with different evidence ID
    const replay = await applyShopifyPaidOrderLineSale(prisma, {
      connectionId: conn.id,
      memberId: seller.id,
      evidenceId: e2.id,
      line,
    });
    expect(replay).toMatchObject({ status: "ALREADY_APPLIED", appliedQuantity: 2 });
    expect((await prisma.inventoryState.findUniqueOrThrow({ where: { variantId } })).onHand).toBe(8);
    expect(
      await prisma.inventoryEvent.count({
        where: {
          variantId,
          eventType: "SALE",
          sourceFactId: "gid://shopify/Order/91001:gid://shopify/LineItem/92001",
        },
      })
    ).toBe(1);
    const factAfterReplay = await prisma.shopifyOrderLineSaleFact.findUniqueOrThrow({
      where: {
        shopifyConnectionId_shopifyOrderId_shopifyLineItemId: {
          shopifyConnectionId: conn.id,
          shopifyOrderId: line.shopifyOrderId,
          shopifyLineItemId: line.shopifyLineItemId,
        },
      },
    });
    expect(factAfterReplay.causalConflict).toBe(false);
    expect(factAfterReplay.paidQuantity).toBe(2);

    // APPLIED quantity conflict
    const qtyConflict = await applyShopifyPaidOrderLineSale(prisma, {
      connectionId: conn.id,
      memberId: seller.id,
      evidenceId: e3.id,
      line: { ...line, paidQuantity: 3 },
    });
    expect(qtyConflict).toMatchObject({
      status: "CAUSAL_FACT_CONFLICT",
      code: "PAID_QUANTITY_CONFLICT",
      applyState: "APPLIED",
      appliedQuantity: 2,
    });
    const afterQty = await prisma.shopifyOrderLineSaleFact.findUniqueOrThrow({
      where: { id: factAfterReplay.id },
    });
    expect(afterQty.paidQuantity).toBe(2);
    expect(afterQty.causalConflict).toBe(true);
    expect(afterQty.causalConflictEvidenceId).toBe(e3.id);
    expect((await prisma.inventoryState.findUniqueOrThrow({ where: { variantId } })).onHand).toBe(8);
    expect(
      await prisma.inventoryEvent.count({
        where: {
          variantId,
          eventType: "SALE",
          sourceFactId: "gid://shopify/Order/91001:gid://shopify/LineItem/92001",
        },
      })
    ).toBe(1);

    // APPLIED variant conflict
    const variantConflict = await applyShopifyPaidOrderLineSale(prisma, {
      connectionId: conn.id,
      memberId: seller.id,
      evidenceId: e4.id,
      line: { ...line, shopifyVariantId: "gid://shopify/ProductVariant/999" },
    });
    expect(variantConflict).toMatchObject({
      status: "CAUSAL_FACT_CONFLICT",
      code: "VARIANT_IDENTITY_CONFLICT",
    });
    expect(
      (
        await prisma.shopifyOrderLineSaleFact.findUniqueOrThrow({ where: { id: factAfterReplay.id } })
      ).shopifyVariantId
    ).toBe("gid://shopify/ProductVariant/810");
    expect((await prisma.inventoryState.findUniqueOrThrow({ where: { variantId } })).onHand).toBe(8);

    // Non-applied quantity conflict (UNMAPPED fact)
    const eU1 = await evidence(conn.id, shop, `wh-u1-${seller.id}`);
    const eU2 = await evidence(conn.id, shop, `wh-u2-${seller.id}`);
    const unmappedLine = {
      shopifyOrderId: "gid://shopify/Order/93001",
      shopifyLineItemId: "gid://shopify/LineItem/93002",
      shopifyVariantId: "gid://shopify/ProductVariant/888888",
      paidQuantity: 2,
    };
    const unmapped = await applyShopifyPaidOrderLineSale(prisma, {
      connectionId: conn.id,
      memberId: seller.id,
      evidenceId: eU1.id,
      line: unmappedLine,
    });
    expect(unmapped.status).toBe("UNMAPPED");
    const unmappedConflict = await applyShopifyPaidOrderLineSale(prisma, {
      connectionId: conn.id,
      memberId: seller.id,
      evidenceId: eU2.id,
      line: { ...unmappedLine, paidQuantity: 3 },
    });
    expect(unmappedConflict).toMatchObject({
      status: "CAUSAL_FACT_CONFLICT",
      code: "PAID_QUANTITY_CONFLICT",
      applyState: "UNMAPPED",
    });
    const unmappedFact = await prisma.shopifyOrderLineSaleFact.findUniqueOrThrow({
      where: {
        shopifyConnectionId_shopifyOrderId_shopifyLineItemId: {
          shopifyConnectionId: conn.id,
          shopifyOrderId: unmappedLine.shopifyOrderId,
          shopifyLineItemId: unmappedLine.shopifyLineItemId,
        },
      },
    });
    expect(unmappedFact.paidQuantity).toBe(2);
    expect(unmappedFact.causalConflict).toBe(true);

    // Non-applied variant conflict
    const eV1 = await evidence(conn.id, shop, `wh-v1-${seller.id}`);
    const eV2 = await evidence(conn.id, shop, `wh-v2-${seller.id}`);
    const vLine = {
      shopifyOrderId: "gid://shopify/Order/94001",
      shopifyLineItemId: "gid://shopify/LineItem/94002",
      shopifyVariantId: "gid://shopify/ProductVariant/777777",
      paidQuantity: 2,
    };
    await applyShopifyPaidOrderLineSale(prisma, {
      connectionId: conn.id,
      memberId: seller.id,
      evidenceId: eV1.id,
      line: vLine,
    });
    const vConflict = await applyShopifyPaidOrderLineSale(prisma, {
      connectionId: conn.id,
      memberId: seller.id,
      evidenceId: eV2.id,
      line: { ...vLine, shopifyVariantId: "gid://shopify/ProductVariant/666666" },
    });
    expect(vConflict).toMatchObject({
      status: "CAUSAL_FACT_CONFLICT",
      code: "VARIANT_IDENTITY_CONFLICT",
    });
    expect(
      (
        await prisma.shopifyOrderLineSaleFact.findUniqueOrThrow({
          where: {
            shopifyConnectionId_shopifyOrderId_shopifyLineItemId: {
              shopifyConnectionId: conn.id,
              shopifyOrderId: vLine.shopifyOrderId,
              shopifyLineItemId: vLine.shopifyLineItemId,
            },
          },
        })
      ).shopifyVariantId
    ).toBe("gid://shopify/ProductVariant/777777");

    // UNMAPPED recovery: create unmapped for a soon-to-be-mapped variant on a second item
    const item2 = await createStoreItem(prisma, seller.id, "S7C Recover", {
      quantity: 5,
      sku: "S7C-R",
      priceCents: 1000,
    });
    const prov2 = await prisma.$transaction((tx) => provisionNativeFoundationListing(tx, item2.id));
    const vRecover = prov2.variantIds[0];
    const eR1 = await evidence(conn.id, shop, `wh-r1-${seller.id}`);
    const eR2 = await evidence(conn.id, shop, `wh-r2-${seller.id}`);
    const recoverLine = {
      shopifyOrderId: "gid://shopify/Order/95001",
      shopifyLineItemId: "gid://shopify/LineItem/95002",
      shopifyVariantId: "gid://shopify/ProductVariant/820",
      paidQuantity: 2,
    };
    const beforeMap = await applyShopifyPaidOrderLineSale(prisma, {
      connectionId: conn.id,
      memberId: seller.id,
      evidenceId: eR1.id,
      line: recoverLine,
    });
    expect(beforeMap.status).toBe("UNMAPPED");
    await createShopifyListingMapping(prisma, {
      memberId: seller.id,
      connectionId: conn.id,
      storeItemId: item2.id,
      shopifyProductId: "gid://shopify/Product/711",
      variants: [
        {
          storeVariantId: vRecover,
          shopifyVariantId: "gid://shopify/ProductVariant/820",
          shopifyInventoryItemId: "gid://shopify/InventoryItem/911",
        },
      ],
    });
    const recovered = await applyShopifyPaidOrderLineSale(prisma, {
      connectionId: conn.id,
      memberId: seller.id,
      evidenceId: eR2.id,
      line: recoverLine,
    });
    expect(recovered).toMatchObject({ status: "APPLIED", appliedQuantity: 2 });
    expect((await prisma.inventoryState.findUniqueOrThrow({ where: { variantId: vRecover } })).onHand).toBe(
      3
    );

    // StoreVariant mapping conflict: corrupt stored storeVariantId then replay
    const eS1 = await evidence(conn.id, shop, `wh-s1-${seller.id}`);
    const eS2 = await evidence(conn.id, shop, `wh-s2-${seller.id}`);
    const svLine = {
      shopifyOrderId: "gid://shopify/Order/96001",
      shopifyLineItemId: "gid://shopify/LineItem/96002",
      shopifyVariantId: "gid://shopify/ProductVariant/810",
      paidQuantity: 1,
    };
    const svFirst = await applyShopifyPaidOrderLineSale(prisma, {
      connectionId: conn.id,
      memberId: seller.id,
      evidenceId: eS1.id,
      line: svLine,
    });
    expect(svFirst.status).toBe("APPLIED");
    // Force storeVariant mismatch while keeping provider identity (simulate mapping drift).
    await prisma.shopifyOrderLineSaleFact.update({
      where: {
        shopifyConnectionId_shopifyOrderId_shopifyLineItemId: {
          shopifyConnectionId: conn.id,
          shopifyOrderId: svLine.shopifyOrderId,
          shopifyLineItemId: svLine.shopifyLineItemId,
        },
      },
      data: {
        applyState: "PENDING",
        appliedQuantity: 0,
        inventoryEventId: null,
        appliedAt: null,
        storeVariantId: vRecover, // wrong StoreVariant vs mapping for 810
      },
    });
    const onHandBeforeSv = (await prisma.inventoryState.findUniqueOrThrow({ where: { variantId } }))
      .onHand;
    const svConflict = await applyShopifyPaidOrderLineSale(prisma, {
      connectionId: conn.id,
      memberId: seller.id,
      evidenceId: eS2.id,
      line: svLine,
    });
    expect(svConflict).toMatchObject({
      status: "CAUSAL_FACT_CONFLICT",
      code: "STORE_VARIANT_MAPPING_CONFLICT",
    });
    expect(
      (
        await prisma.shopifyOrderLineSaleFact.findUniqueOrThrow({
          where: {
            shopifyConnectionId_shopifyOrderId_shopifyLineItemId: {
              shopifyConnectionId: conn.id,
              shopifyOrderId: svLine.shopifyOrderId,
              shopifyLineItemId: svLine.shopifyLineItemId,
            },
          },
        })
      ).storeVariantId
    ).toBe(vRecover);
    expect((await prisma.inventoryState.findUniqueOrThrow({ where: { variantId } })).onHand).toBe(
      onHandBeforeSv
    );

    // Concurrent conflicting duplicates (qty 2 vs qty 3)
    const eA = await evidence(conn.id, shop, `wh-race-a-${seller.id}`);
    const eB = await evidence(conn.id, shop, `wh-race-b-${seller.id}`);
    const raceOrder = "gid://shopify/Order/97001";
    const raceLine = "gid://shopify/LineItem/97002";
    const onHandBeforeRace = (
      await prisma.inventoryState.findUniqueOrThrow({ where: { variantId } })
    ).onHand!;
    const [race1, race2] = await Promise.all([
      applyShopifyPaidOrderLineSale(prisma, {
        connectionId: conn.id,
        memberId: seller.id,
        evidenceId: eA.id,
        line: {
          shopifyOrderId: raceOrder,
          shopifyLineItemId: raceLine,
          shopifyVariantId: "gid://shopify/ProductVariant/810",
          paidQuantity: 2,
        },
      }),
      applyShopifyPaidOrderLineSale(prisma, {
        connectionId: conn.id,
        memberId: seller.id,
        evidenceId: eB.id,
        line: {
          shopifyOrderId: raceOrder,
          shopifyLineItemId: raceLine,
          shopifyVariantId: "gid://shopify/ProductVariant/810",
          paidQuantity: 3,
        },
      }),
    ]);
    const raceStatuses = [race1.status, race2.status].sort();
    expect(raceStatuses).toContain("CAUSAL_FACT_CONFLICT");
    expect(
      raceStatuses.filter((s) => s === "APPLIED" || s === "ALREADY_APPLIED").length
    ).toBeLessThanOrEqual(1);
    const raceFact = await prisma.shopifyOrderLineSaleFact.findUniqueOrThrow({
      where: {
        shopifyConnectionId_shopifyOrderId_shopifyLineItemId: {
          shopifyConnectionId: conn.id,
          shopifyOrderId: raceOrder,
          shopifyLineItemId: raceLine,
        },
      },
    });
    expect([2, 3]).toContain(raceFact.paidQuantity);
    expect(raceFact.causalConflict).toBe(true);
    const raceSales = await prisma.inventoryEvent.count({
      where: {
        variantId,
        eventType: "SALE",
        sourceFactId: `${raceOrder}:${raceLine}`,
      },
    });
    expect(raceSales).toBeLessThanOrEqual(1);
    const onHandAfterRace = (
      await prisma.inventoryState.findUniqueOrThrow({ where: { variantId } })
    ).onHand!;
    // Never cumulative 5 (2+3). At most one established qty decremented.
    expect(onHandBeforeRace - onHandAfterRace).toBeLessThanOrEqual(raceFact.paidQuantity);
    expect(onHandBeforeRace - onHandAfterRace).not.toBe(5);
    void e5;
    void e6;
  });
});
