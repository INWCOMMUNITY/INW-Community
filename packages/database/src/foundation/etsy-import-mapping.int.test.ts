import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  COMMERCE_FOUNDATION_CUTOVER_SINGLETON_ID,
  transitionCommerceFoundationCutover,
} from "../commerce-foundation-cutover";
import { createMember } from "./fixtures";
import { foundationTestDatabaseUrl } from "./local-url";
import { persistEtsyInstall } from "../etsy/connection";
import {
  beginEtsyListingImportAttempt,
  completeEtsyListingImportAttempt,
} from "../etsy/import-attempt";
import { createEtsyImportedListingMapping } from "../etsy/import-mapping";
import { provisionNativeFoundationListing } from "../commerce-foundation-listing";

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
    engineSha: "engine-e4",
    manifestHash: "manifest-e4",
  });
  await transitionCommerceFoundationCutover(prisma, { to: "FOUNDATION" });
}

describe("etsy listing import mapping foundation", () => {
  it("creates import attempt, store item mapping, and variant maps without outbound jobs", async () => {
    await enterFoundation();
    const seller = await createMember(prisma, "etsy-imp");
    const shopId = `7${seller.id.replace(/\D/g, "").slice(-7) || "1122334"}`;
    const connection = await persistEtsyInstall(prisma, {
      memberId: seller.id,
      etsyUserId: `4${shopId.slice(-6)}`,
      shopId,
      shopName: "Import Shop",
      accessTokenEncrypted: "cipher-a",
      refreshTokenEncrypted: "cipher-r",
      accessTokenExpiresAt: new Date("2026-09-30T13:00:00Z"),
      refreshTokenExpiresAt: new Date("2026-12-29T00:00:00Z"),
      grantedScopes: "listings_r listings_w shops_r transactions_r",
    });

    const listingId = `55${shopId.slice(-5)}`;
    const begin = await beginEtsyListingImportAttempt(prisma, {
      memberId: seller.id,
      connectionId: connection.id,
      etsyListingId: listingId,
      stockMode: "PHYSICAL",
    });
    expect(begin.status).toBe("READY");
    if (begin.status !== "READY") return;

    const created = await prisma.$transaction(async (tx) => {
      const item = await tx.storeItem.create({
        data: {
          memberId: seller.id,
          title: "Imported Mug",
          priceCents: 1800,
          quantity: 4,
          inventoryTracking: "tracked",
          status: "active",
          slug: `imported-mug-${seller.id.slice(-6)}`,
          photos: [],
        },
      });
      const provisioned = await provisionNativeFoundationListing(tx, item.id);
      expect(provisioned.variantIds.length).toBe(1);

      const mapping = await createEtsyImportedListingMapping(tx, {
        memberId: seller.id,
        connectionId: connection.id,
        storeItemId: item.id,
        etsyListingId: listingId,
        remoteListingState: "active",
        importBootstrapStartedAt: begin.attempt.bootstrapStartedAt,
        variants: [
          {
            storeVariantId: provisioned.variantIds[0]!,
            etsyProductId: "901",
            etsyOfferingId: "902",
            remoteSku: "MUG-1",
            remoteAvailable: 4,
          },
        ],
      });

      await completeEtsyListingImportAttempt(tx, {
        attemptId: begin.attempt.id,
        storeItemId: item.id,
        listingLinkId: mapping.listingLinkId,
        etsyProductId: "901",
        etsyOfferingId: "902",
      });

      return mapping;
    });

    const link = await prisma.etsyListingLink.findUnique({ where: { id: created.listingLinkId } });
    expect(link?.importSource).toBe("ETSY_IMPORT");
    expect(link?.etsyListingId).toBe(listingId);

    const maps = await prisma.etsyVariantMap.findMany({
      where: { etsyListingLinkId: created.listingLinkId },
    });
    expect(maps).toHaveLength(1);
    expect(maps[0]?.etsyOfferingId).toBe("902");

    const jobs = await prisma.etsySyncJob.count({
      where: { etsyConnectionId: connection.id },
    });
    expect(jobs).toBe(0);
  });
});
