import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  COMMERCE_FOUNDATION_CUTOVER_SINGLETON_ID,
  transitionCommerceFoundationCutover,
} from "../commerce-foundation-cutover";
import { provisionNativeFoundationListing } from "../commerce-foundation-listing";
import { createMember, createStoreItem } from "./fixtures";
import { foundationTestDatabaseUrl } from "./local-url";
import { persistEtsyInstall } from "../etsy/connection";
import { createEtsyImportedListingMapping } from "../etsy/import-mapping";
import { applyEtsyPaidOrderLineSale } from "../etsy/order-sale";
import { hashEtsyWebhookPayload, ingestEtsyWebhookEvidence } from "../etsy/evidence";

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
    engineSha: "engine-e7",
    manifestHash: "manifest-e7",
  });
  await transitionCommerceFoundationCutover(prisma, { to: "FOUNDATION" });
}

describe("etsy E7 paid order line sale", () => {
  it("applies once, replays as ALREADY_APPLIED, and conflicts on qty drift", async () => {
    await enterFoundation();
    const seller = await createMember(prisma, "etsy-e7");
    const shopId = `6${seller.id.replace(/\D/g, "").slice(-7) || "5566778"}`;
    const connection = await persistEtsyInstall(prisma, {
      memberId: seller.id,
      etsyUserId: `8${shopId.slice(-6)}`,
      shopId,
      shopName: "Sale Shop",
      accessTokenEncrypted: "cipher-a",
      refreshTokenEncrypted: "cipher-r",
      accessTokenExpiresAt: new Date("2026-09-30T13:00:00Z"),
      refreshTokenExpiresAt: new Date("2026-12-29T00:00:00Z"),
      grantedScopes: "listings_r listings_w shops_r transactions_r",
    });

    const item = await createStoreItem(prisma, seller.id, "E7 Mug", {
      priceCents: 1200,
      quantity: 5,
      sku: "E7-MUG",
    });
    const provisioned = await prisma.$transaction((tx) =>
      provisionNativeFoundationListing(tx, item.id)
    );
    const variantId = provisioned.variantIds[0]!;
    const listingId = `91${shopId.slice(-5)}`;
    await createEtsyImportedListingMapping(prisma, {
      memberId: seller.id,
      connectionId: connection.id,
      storeItemId: item.id,
      etsyListingId: listingId,
      remoteListingState: "active",
      importBootstrapStartedAt: new Date("2026-09-01T00:00:00Z"),
      variants: [
        {
          storeVariantId: variantId,
          etsyProductId: "501",
          etsyOfferingId: "502",
          remoteSku: "E7-MUG",
          remoteAvailable: 5,
        },
      ],
    });

    const rawBody = JSON.stringify({
      shop_id: Number(shopId),
      receipt_id: 9001,
      event_type: "order.paid",
    });
    const ingested = await ingestEtsyWebhookEvidence(prisma, {
      shopId,
      topic: "order.paid",
      webhookId: `wh-e7-${seller.id.slice(-8)}`,
      triggeredAt: new Date("2026-09-30T12:00:00Z"),
      rawBody,
      enqueueProcessingJob: false,
    });
    expect(hashEtsyWebhookPayload(rawBody)).toHaveLength(64);

    const first = await applyEtsyPaidOrderLineSale(prisma, {
      connectionId: connection.id,
      memberId: seller.id,
      evidenceId: ingested.evidence.id,
      line: {
        etsyReceiptId: "9001",
        etsyTransactionId: "8001",
        etsyListingId: listingId,
        etsyProductId: "501",
        etsyOfferingId: "502",
        paidQuantity: 2,
        triggeredAt: new Date("2026-09-30T12:00:00Z"),
      },
    });
    expect(first.status).toBe("APPLIED");
    if (first.status === "APPLIED") expect(first.appliedQuantity).toBe(2);

    const state = await prisma.inventoryState.findUniqueOrThrow({ where: { variantId } });
    expect(state.onHand).toBe(3);

    const replay = await applyEtsyPaidOrderLineSale(prisma, {
      connectionId: connection.id,
      memberId: seller.id,
      evidenceId: ingested.evidence.id,
      line: {
        etsyReceiptId: "9001",
        etsyTransactionId: "8001",
        etsyListingId: listingId,
        etsyProductId: "501",
        etsyOfferingId: "502",
        paidQuantity: 2,
        triggeredAt: new Date("2026-09-30T12:00:00Z"),
      },
    });
    expect(replay.status).toBe("ALREADY_APPLIED");
    expect((await prisma.inventoryState.findUniqueOrThrow({ where: { variantId } })).onHand).toBe(3);

    const conflict = await applyEtsyPaidOrderLineSale(prisma, {
      connectionId: connection.id,
      memberId: seller.id,
      evidenceId: ingested.evidence.id,
      line: {
        etsyReceiptId: "9001",
        etsyTransactionId: "8001",
        etsyListingId: listingId,
        etsyProductId: "501",
        etsyOfferingId: "502",
        paidQuantity: 3,
        triggeredAt: new Date("2026-09-30T12:00:00Z"),
      },
    });
    expect(conflict.status).toBe("CAUSAL_FACT_CONFLICT");
    expect((await prisma.inventoryState.findUniqueOrThrow({ where: { variantId } })).onHand).toBe(3);
  });
});
