import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  COMMERCE_FOUNDATION_CUTOVER_SINGLETON_ID,
  transitionCommerceFoundationCutover,
} from "../commerce-foundation-cutover";
import { provisionNativeFoundationListing } from "../commerce-foundation-listing";
import { persistShopifyInstall } from "../shopify/connection";
import { createShopifyListingMapping } from "../shopify/mapping";
import {
  classifyShopifyListingHealth,
  persistShopifyListingHealth,
  shopifyListingIssueDedupeKey,
} from "../shopify/listing-health";
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
  if (!prisma) return;
  await prisma.$executeRaw`
    UPDATE "commerce_foundation_cutover"
    SET "mode" = 'LEGACY',
        "frozen_at" = NULL,
        "backfilled_at" = NULL,
        "foundation_at" = NULL,
        "unfrozen_at" = NULL,
        "engine_sha" = NULL,
        "manifest_hash" = NULL,
        "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = ${COMMERCE_FOUNDATION_CUTOVER_SINGLETON_ID}
  `;
  await prisma.$disconnect();
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
    engineSha: "engine-s9",
    manifestHash: "manifest-s9",
  });
  await transitionCommerceFoundationCutover(prisma, { to: "FOUNDATION" });
}

async function seedMapped(label: string, qty: number, tracking?: "made_to_order") {
  await enterFoundation();
  const seller = await createMember(prisma, label);
  const shop = `${label}-${seller.id.slice(-8)}.myshopify.com`;
  const shopId = `gid://shopify/Shop/${seller.id.replace(/\D/g, "").slice(0, 8) || "9901"}`;
  const item = await createStoreItem(prisma, seller.id, `${label} Item`, {
    quantity: tracking === "made_to_order" ? 0 : qty,
    inventoryTracking: tracking,
    sku: `${label}-SKU`,
    priceCents: 1200,
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
    connectedAt: new Date("2026-09-25T16:00:00Z"),
  });
  const productNum = label === "s9b" ? 991 : 990;
  await createShopifyListingMapping(prisma, {
    memberId: seller.id,
    connectionId: conn.id,
    storeItemId: item.id,
    shopifyProductId: `gid://shopify/Product/${productNum}`,
    variants: [
      {
        storeVariantId: variantId,
        shopifyVariantId: `gid://shopify/ProductVariant/${productNum}`,
        shopifyInventoryItemId: `gid://shopify/InventoryItem/${productNum}`,
      },
    ],
  });
  const listing = await prisma.shopifyListingLink.findFirstOrThrow({
    where: { shopifyConnectionId: conn.id, storeItemId: item.id },
  });
  const variantMap = await prisma.shopifyVariantMap.findFirstOrThrow({
    where: { shopifyListingLinkId: listing.id },
  });
  return { seller, shop, conn, item, variantId, listing, variantMap };
}

describe("shopify S9 listing reconciliation health (real PG)", () => {
  it("issue persist/dedupe/recovery, listing isolation, S7 independence, causal conflict readiness", async () => {
    const a = await seedMapped("s9a", 10);
    // Mark inventory converged as if S8 applied
    await prisma.shopifyVariantMap.update({
      where: { id: a.variantMap.id },
      data: {
        inventoryInitState: "INITIALIZED",
        inventoryDesiredVersion: 1,
        inventoryAppliedVersion: 1,
        inventoryDesiredAvailable: 10,
        inventoryAppliedAvailable: 10,
        inventoryDriftState: "NONE",
      },
    });
    const listingA = await prisma.shopifyListingLink.findUniqueOrThrow({ where: { id: a.listing.id } });
    const mapA = await prisma.shopifyVariantMap.findUniqueOrThrow({ where: { id: a.variantMap.id } });

    const healthy = classifyShopifyListingHealth({
      connectionStatus: "ACTIVE",
      primaryLocationId: a.conn.primaryLocationId,
      listing: listingA,
      variantMap: mapA,
      hasCausalSaleConflict: false,
      remote: {
        productExists: true,
        productStatus: "DRAFT",
        variantCount: 1,
        mappedVariantPresent: true,
        inventoryItemMatches: true,
        inventoryTracked: true,
        inventoryLevelExists: true,
        remoteAvailable: 10,
        remoteProductFingerprint: listingA.appliedProductFingerprint,
        remoteVariantFingerprint: mapA.appliedVariantFingerprint,
      },
    });
    expect(healthy.readiness).toBe("READY_TO_PUBLISH");
    await persistShopifyListingHealth(prisma, {
      listingLinkId: a.listing.id,
      health: healthy,
      previous: listingA,
    });

    // Inventory drift → ACTION_REQUIRED; notification dedupe via activity log key
    await prisma.shopifyVariantMap.update({
      where: { id: a.variantMap.id },
      data: { inventoryDriftState: "REMOTE_DRIFT" },
    });
    const driftedMap = await prisma.shopifyVariantMap.findUniqueOrThrow({ where: { id: a.variantMap.id } });
    const driftHealth = classifyShopifyListingHealth({
      connectionStatus: "ACTIVE",
      primaryLocationId: a.conn.primaryLocationId,
      listing: await prisma.shopifyListingLink.findUniqueOrThrow({ where: { id: a.listing.id } }),
      variantMap: driftedMap,
      hasCausalSaleConflict: false,
      remote: {
        productExists: true,
        productStatus: "DRAFT",
        variantCount: 1,
        mappedVariantPresent: true,
        inventoryItemMatches: true,
        inventoryTracked: true,
        inventoryLevelExists: true,
        remoteAvailable: 8,
        remoteProductFingerprint: listingA.appliedProductFingerprint,
        remoteVariantFingerprint: mapA.appliedVariantFingerprint,
      },
    });
    expect(driftHealth.issueCode).toBe("INVENTORY_REMOTE_DRIFT");
    const first = await persistShopifyListingHealth(prisma, {
      listingLinkId: a.listing.id,
      health: driftHealth,
    });
    expect(first.issueOpened).toBe(true);
    const afterDrift = await prisma.shopifyListingLink.findUniqueOrThrow({ where: { id: a.listing.id } });
    expect(afterDrift.readiness).toBe("ACTION_REQUIRED");
    expect(afterDrift.inventoryHealth).toBe("PAUSED");

    const dedupeKey = shopifyListingIssueDedupeKey({
      connectionId: a.conn.id,
      listingLinkId: a.listing.id,
      issueCode: driftHealth.issueCode!,
      issueFingerprint: driftHealth.issueFingerprint!,
    });
    await prisma.sellerActivityLog.create({
      data: {
        memberId: a.seller.id,
        action: "sync_error",
        entityType: "store_item",
        entityId: a.item.id,
        dedupeKey,
        detail: { issueCode: driftHealth.issueCode },
      },
    });
    // Repeat same issue — activity dedupe key already exists
    const second = await persistShopifyListingHealth(prisma, {
      listingLinkId: a.listing.id,
      health: driftHealth,
    });
    expect(second.issueOpened).toBe(false);
    expect(await prisma.sellerActivityLog.count({ where: { dedupeKey } })).toBe(1);

    // Listing B remains healthy / independent
    const b = await seedMapped("s9b", 5);
    await prisma.shopifyVariantMap.update({
      where: { id: b.variantMap.id },
      data: {
        inventoryInitState: "INITIALIZED",
        inventoryDesiredVersion: 1,
        inventoryAppliedVersion: 1,
        inventoryDesiredAvailable: 5,
        inventoryAppliedAvailable: 5,
      },
    });
    const listingB = await prisma.shopifyListingLink.findUniqueOrThrow({ where: { id: b.listing.id } });
    const mapB = await prisma.shopifyVariantMap.findUniqueOrThrow({ where: { id: b.variantMap.id } });
    const healthyB = classifyShopifyListingHealth({
      connectionStatus: "ACTIVE",
      primaryLocationId: b.conn.primaryLocationId,
      listing: listingB,
      variantMap: mapB,
      hasCausalSaleConflict: false,
      remote: {
        productExists: true,
        productStatus: "DRAFT",
        variantCount: 1,
        mappedVariantPresent: true,
        inventoryItemMatches: true,
        inventoryTracked: true,
        inventoryLevelExists: true,
        remoteAvailable: 5,
        remoteProductFingerprint: listingB.appliedProductFingerprint,
        remoteVariantFingerprint: mapB.appliedVariantFingerprint,
      },
    });
    expect(healthyB.readiness).toBe("READY_TO_PUBLISH");
    await persistShopifyListingHealth(prisma, { listingLinkId: b.listing.id, health: healthyB });
    expect(
      (await prisma.shopifyListingLink.findUniqueOrThrow({ where: { id: a.listing.id } })).readiness
    ).toBe("ACTION_REQUIRED");
    expect(
      (await prisma.shopifyListingLink.findUniqueOrThrow({ where: { id: b.listing.id } })).readiness
    ).toBe("READY_TO_PUBLISH");

    // S7 still applies while listing A inventory is paused
    const evidence = await prisma.shopifyProviderEvidence.create({
      data: {
        shopifyConnectionId: a.conn.id,
        shopDomain: a.shop,
        topic: "orders/paid",
        webhookId: `wh-s9-${a.seller.id}`,
        triggeredAt: new Date("2026-09-25T17:00:00Z"),
        rawBody: "{}",
        payloadHash: hashShopifyWebhookPayload(`s9-${a.seller.id}`),
        processState: "RECEIVED",
      },
    });
    // Clear drift and set quantities so S7 can apply (onHand still 10 from opening)
    await prisma.shopifyVariantMap.update({
      where: { id: a.variantMap.id },
      data: { inventoryDriftState: "NONE" },
    });
    const sale = await applyShopifyPaidOrderLineSale(prisma, {
      connectionId: a.conn.id,
      memberId: a.seller.id,
      evidenceId: evidence.id,
      line: {
        shopifyOrderId: "gid://shopify/Order/99001",
        shopifyLineItemId: "gid://shopify/LineItem/99002",
        shopifyVariantId: "gid://shopify/ProductVariant/990",
        paidQuantity: 2,
      },
    });
    expect(sale.status).toBe("APPLIED");

    // Simulate S7 catch-up convergence then health recovery
    await prisma.shopifyVariantMap.update({
      where: { id: a.variantMap.id },
      data: {
        inventoryDesiredAvailable: 8,
        inventoryAppliedAvailable: 8,
        inventoryDesiredVersion: 2,
        inventoryAppliedVersion: 2,
        inventoryDriftState: "NONE",
        inventoryInitState: "INITIALIZED",
      },
    });
    const recovered = classifyShopifyListingHealth({
      connectionStatus: "ACTIVE",
      primaryLocationId: a.conn.primaryLocationId,
      listing: await prisma.shopifyListingLink.findUniqueOrThrow({ where: { id: a.listing.id } }),
      variantMap: await prisma.shopifyVariantMap.findUniqueOrThrow({ where: { id: a.variantMap.id } }),
      hasCausalSaleConflict: false,
      remote: {
        productExists: true,
        productStatus: "DRAFT",
        variantCount: 1,
        mappedVariantPresent: true,
        inventoryItemMatches: true,
        inventoryTracked: true,
        inventoryLevelExists: true,
        remoteAvailable: 8,
        remoteProductFingerprint: listingA.appliedProductFingerprint,
        remoteVariantFingerprint: mapA.appliedVariantFingerprint,
      },
    });
    expect(recovered.readiness).toBe("READY_TO_PUBLISH");
    const cleared = await persistShopifyListingHealth(prisma, {
      listingLinkId: a.listing.id,
      health: recovered,
    });
    expect(cleared.issueCleared).toBe(true);
    expect(
      (await prisma.shopifyListingLink.findUniqueOrThrow({ where: { id: a.listing.id } })).issueCode
    ).toBeNull();

    // Recurring same issue later may open a new notification signature path
    await prisma.shopifyVariantMap.update({
      where: { id: a.variantMap.id },
      data: { inventoryDriftState: "REMOTE_DRIFT", inventoryDesiredAvailable: 8, inventoryAppliedAvailable: 8 },
    });
    const recur = classifyShopifyListingHealth({
      connectionStatus: "ACTIVE",
      primaryLocationId: a.conn.primaryLocationId,
      listing: await prisma.shopifyListingLink.findUniqueOrThrow({ where: { id: a.listing.id } }),
      variantMap: await prisma.shopifyVariantMap.findUniqueOrThrow({ where: { id: a.variantMap.id } }),
      hasCausalSaleConflict: false,
      remote: {
        productExists: true,
        productStatus: "DRAFT",
        variantCount: 1,
        mappedVariantPresent: true,
        inventoryItemMatches: true,
        inventoryTracked: true,
        inventoryLevelExists: true,
        remoteAvailable: 6,
        remoteProductFingerprint: listingA.appliedProductFingerprint,
        remoteVariantFingerprint: mapA.appliedVariantFingerprint,
      },
    });
    const recurPersist = await persistShopifyListingHealth(prisma, {
      listingLinkId: a.listing.id,
      health: recur,
    });
    expect(recurPersist.issueOpened).toBe(true);

    // Causal sale conflict blocks inventory readiness
    await prisma.shopifyOrderLineSaleFact.create({
      data: {
        shopifyConnectionId: a.conn.id,
        memberId: a.seller.id,
        shopifyOrderId: "gid://shopify/Order/99111",
        shopifyLineItemId: "gid://shopify/LineItem/99112",
        shopifyVariantId: "gid://shopify/ProductVariant/990",
        storeVariantId: a.variantId,
        storeItemId: a.item.id,
        paidQuantity: 1,
        evidenceId: evidence.id,
        applyState: "APPLIED",
        appliedQuantity: 1,
        causalConflict: true,
        causalConflictCode: "PAID_QUANTITY_CONFLICT",
        causalConflictDetectedAt: new Date(),
      },
    });
    const causal = classifyShopifyListingHealth({
      connectionStatus: "ACTIVE",
      primaryLocationId: a.conn.primaryLocationId,
      listing: await prisma.shopifyListingLink.findUniqueOrThrow({ where: { id: a.listing.id } }),
      variantMap: {
        ...(await prisma.shopifyVariantMap.findUniqueOrThrow({ where: { id: a.variantMap.id } })),
        inventoryDriftState: "NONE",
        inventoryDesiredAvailable: 8,
        inventoryAppliedAvailable: 8,
        inventoryDesiredVersion: 2,
        inventoryAppliedVersion: 2,
        inventoryInitState: "INITIALIZED",
      },
      hasCausalSaleConflict: true,
      remote: {
        productExists: true,
        productStatus: "DRAFT",
        variantCount: 1,
        mappedVariantPresent: true,
        inventoryItemMatches: true,
        inventoryTracked: true,
        inventoryLevelExists: true,
        remoteAvailable: 8,
        remoteProductFingerprint: listingA.appliedProductFingerprint,
        remoteVariantFingerprint: mapA.appliedVariantFingerprint,
      },
    });
    expect(causal.issueCode).toBe("SALE_FACT_CAUSAL_CONFLICT");
    expect(causal.inventoryHealth).toBe("PAUSED");

    // MTO readiness without fake finite qty
    const mto = await seedMapped("s9mto", 0, "made_to_order");
    expect(mto.variantMap.inventoryInitState).toBe("NOT_APPLICABLE");
    const mtoHealth = classifyShopifyListingHealth({
      connectionStatus: "ACTIVE",
      primaryLocationId: mto.conn.primaryLocationId,
      listing: await prisma.shopifyListingLink.findUniqueOrThrow({ where: { id: mto.listing.id } }),
      variantMap: await prisma.shopifyVariantMap.findUniqueOrThrow({ where: { id: mto.variantMap.id } }),
      hasCausalSaleConflict: false,
      remote: {
        productExists: true,
        productStatus: "DRAFT",
        variantCount: 1,
        mappedVariantPresent: true,
        inventoryItemMatches: true,
        inventoryTracked: false,
        inventoryLevelExists: false,
        remoteAvailable: null,
        remoteProductFingerprint: mto.listing.appliedProductFingerprint,
        remoteVariantFingerprint: mto.variantMap.appliedVariantFingerprint,
      },
    });
    expect(mtoHealth.readiness).toBe("READY_TO_PUBLISH");
  });
});
