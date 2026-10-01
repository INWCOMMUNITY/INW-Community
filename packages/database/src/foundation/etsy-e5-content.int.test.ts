import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMember, createStoreItem, createVariant } from "./fixtures";
import { foundationTestDatabaseUrl } from "./local-url";
import { persistEtsyInstall } from "../etsy/connection";
import {
  markEtsyProductContentApplied,
  markEtsyVariantContentApplied,
  recordEtsyListingContentDesire,
} from "../etsy/content-desire";
import { createEtsyImportedListingMapping } from "../etsy/import-mapping";

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

describe("etsy E5 outbound listing content desire", () => {
  it("bumps desire versions, enqueues UPDATE_LISTING_CONTENT, and skips no-ops", async () => {
    const seller = await createMember(prisma, "etsy-e5");
    const shopId = `8${seller.id.replace(/\D/g, "").slice(-7) || "2233445"}`;
    const connection = await persistEtsyInstall(prisma, {
      memberId: seller.id,
      etsyUserId: `5${shopId.slice(-6)}`,
      shopId,
      shopName: "Content Shop",
      accessTokenEncrypted: "cipher-a",
      refreshTokenEncrypted: "cipher-r",
      accessTokenExpiresAt: new Date("2026-09-30T13:00:00Z"),
      refreshTokenExpiresAt: new Date("2026-12-29T00:00:00Z"),
      grantedScopes: "listings_r listings_w shops_r transactions_r",
    });

    const item = await createStoreItem(prisma, seller.id, "E5 Title", {
      priceCents: 1000,
      sku: "E5-SKU",
    });
    await prisma.storeItem.update({
      where: { id: item.id },
      data: { description: "Original description" },
    });
    const variant = await createVariant(prisma, {
      memberId: seller.id,
      storeItemId: item.id,
      isDefault: true,
      sku: "E5-SKU",
      priceCents: 1000,
    });

    const listingId = `66${shopId.slice(-5)}`;
    await createEtsyImportedListingMapping(prisma, {
      memberId: seller.id,
      connectionId: connection.id,
      storeItemId: item.id,
      etsyListingId: listingId,
      remoteListingState: "active",
      importBootstrapStartedAt: new Date("2026-09-30T12:00:00Z"),
      variants: [
        {
          storeVariantId: variant.id,
          etsyProductId: "701",
          etsyOfferingId: "702",
          remoteSku: "E5-SKU",
          remoteAvailable: 3,
        },
      ],
    });

    const beforeStates = await prisma.inventoryState.count();
    const beforeJobs = await prisma.etsySyncJob.count({
      where: { etsyConnectionId: connection.id },
    });

    const recorded = await prisma.$transaction((tx) =>
      recordEtsyListingContentDesire(tx, {
        memberId: seller.id,
        storeItemId: item.id,
        before: {
          title: "E5 Title",
          description: "Original description",
          priceCents: 1000,
          sku: "E5-SKU",
        },
        after: {
          title: "E5 Title Updated",
          description: "Original description",
          priceCents: 1000,
          sku: "E5-SKU",
        },
      })
    );
    expect(recorded.status).toBe("RECORDED");
    if (recorded.status !== "RECORDED") return;
    expect(recorded.productDesiredVersion).toBe(1);
    expect(recorded.variantDesiredVersion).toBe(0);

    const job = await prisma.etsySyncJob.findUnique({ where: { id: recorded.jobId } });
    expect(job?.kind).toBe("UPDATE_LISTING_CONTENT");
    expect(job?.state).toBe("PENDING");

    const noop = await recordEtsyListingContentDesire(prisma, {
      memberId: seller.id,
      storeItemId: item.id,
      before: {
        title: "E5 Title Updated",
        description: "Original description",
        priceCents: 1000,
        sku: "E5-SKU",
      },
      after: {
        title: "E5 Title Updated",
        description: "Original description",
        priceCents: 1000,
        sku: "E5-SKU",
      },
    });
    expect(noop.status).toBe("SKIPPED");
    if (noop.status === "SKIPPED") expect(noop.reason).toBe("NO_CONTENT_CHANGE");

    const priceChange = await prisma.$transaction((tx) =>
      recordEtsyListingContentDesire(tx, {
        memberId: seller.id,
        storeItemId: item.id,
        before: {
          title: "E5 Title Updated",
          description: "Original description",
          priceCents: 1000,
          sku: "E5-SKU",
        },
        after: {
          title: "E5 Title Updated",
          description: "Original description",
          priceCents: 1500,
          sku: "E5-SKU",
        },
      })
    );
    expect(priceChange.status).toBe("RECORDED");
    if (priceChange.status === "RECORDED") {
      expect(priceChange.productDesiredVersion).toBe(1);
      expect(priceChange.variantDesiredVersion).toBe(1);
    }

    await markEtsyProductContentApplied(prisma, {
      listingLinkId: (
        await prisma.etsyListingLink.findFirstOrThrow({
          where: { etsyConnectionId: connection.id, storeItemId: item.id },
        })
      ).id,
      desiredVersion: 1,
      fingerprint: "applied-product",
    });
    await markEtsyVariantContentApplied(prisma, {
      variantMapId: (
        await prisma.etsyVariantMap.findFirstOrThrow({
          where: { etsyConnectionId: connection.id, storeVariantId: variant.id },
        })
      ).id,
      desiredVersion: 1,
      fingerprint: "applied-variant",
    });

    const link = await prisma.etsyListingLink.findFirstOrThrow({
      where: { etsyConnectionId: connection.id, storeItemId: item.id },
    });
    expect(link.appliedProductContentVersion).toBe(1);
    const map = await prisma.etsyVariantMap.findFirstOrThrow({
      where: { etsyConnectionId: connection.id, storeVariantId: variant.id },
    });
    expect(map.appliedVariantContentVersion).toBe(1);

    expect(await prisma.inventoryState.count()).toBe(beforeStates);
    expect(
      await prisma.etsySyncJob.count({ where: { etsyConnectionId: connection.id } })
    ).toBeGreaterThan(beforeJobs);
  });
});
