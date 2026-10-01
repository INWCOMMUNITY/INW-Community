import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  COMMERCE_FOUNDATION_CUTOVER_SINGLETON_ID,
  transitionCommerceFoundationCutover,
} from "../commerce-foundation-cutover";
import { provisionNativeFoundationListing } from "../commerce-foundation-listing";
import { setTrackedOnHand } from "../commerce-foundation-inventory";
import { createMember, createStoreItem } from "./fixtures";
import { foundationTestDatabaseUrl } from "./local-url";
import { persistEtsyInstall } from "../etsy/connection";
import { createEtsyImportedListingMapping } from "../etsy/import-mapping";
import { captureEtsyInventoryProjectionDesire } from "../etsy/inventory-desire";

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
    engineSha: "engine-e8",
    manifestHash: "manifest-e8",
  });
  await transitionCommerceFoundationCutover(prisma, { to: "FOUNDATION" });
}

describe("etsy E8 inventory projection desire", () => {
  it("records PROJECT_INVENTORY including qty 0 sell-out", async () => {
    await enterFoundation();
    const seller = await createMember(prisma, "etsy-e8");
    const shopId = `5${seller.id.replace(/\D/g, "").slice(-7) || "6677889"}`;
    const connection = await persistEtsyInstall(prisma, {
      memberId: seller.id,
      etsyUserId: `9${shopId.slice(-6)}`,
      shopId,
      shopName: "Inv Shop",
      accessTokenEncrypted: "cipher-a",
      refreshTokenEncrypted: "cipher-r",
      accessTokenExpiresAt: new Date("2026-09-30T13:00:00Z"),
      refreshTokenExpiresAt: new Date("2026-12-29T00:00:00Z"),
      grantedScopes: "listings_r listings_w shops_r transactions_r",
    });

    const item = await createStoreItem(prisma, seller.id, "E8 Item", {
      priceCents: 900,
      quantity: 4,
      sku: "E8",
    });
    const provisioned = await prisma.$transaction((tx) =>
      provisionNativeFoundationListing(tx, item.id)
    );
    const variantId = provisioned.variantIds[0]!;
    await createEtsyImportedListingMapping(prisma, {
      memberId: seller.id,
      connectionId: connection.id,
      storeItemId: item.id,
      etsyListingId: `92${shopId.slice(-5)}`,
      remoteListingState: "active",
      importBootstrapStartedAt: new Date("2026-09-01T00:00:00Z"),
      variants: [
        {
          storeVariantId: variantId,
          etsyProductId: "601",
          etsyOfferingId: "602",
          remoteSku: "E8",
          remoteAvailable: 4,
        },
      ],
    });

    const recorded = await prisma.$transaction(async (tx) => {
      await setTrackedOnHand(tx, {
        variantId,
        memberId: seller.id,
        targetOnHand: 0,
        commandId: `e8-zero-${seller.id.slice(-6)}`,
      });
      return captureEtsyInventoryProjectionDesire(tx, {
        memberId: seller.id,
        storeVariantId: variantId,
      });
    });

    expect(recorded.status).toBe("RECORDED");
    if (recorded.status === "RECORDED") {
      expect(recorded.inventoryDesiredAvailable).toBe(0);
      expect(recorded.jobId).toBeTruthy();
    }

    const job = await prisma.etsySyncJob.findFirst({
      where: { etsyConnectionId: connection.id, kind: "PROJECT_INVENTORY" },
      orderBy: { createdAt: "desc" },
    });
    expect(job?.state).toBe("PENDING");
    expect(job?.payload).toMatchObject({
      storeVariantId: variantId,
      inventoryDesiredVersion: 1,
    });
  });
});
