import { prisma } from "database";

const OPEN_JOB = ["PENDING", "RETRY_WAIT", "RUNNING"] as const;

/**
 * Drop Etsy and Shopify links for one INW listing.
 * The remote Etsy listing and Shopify product stay in the seller's shop so they can be imported again as new INW listings.
 */
export async function disconnectStoreItemChannels(storeItemId: string): Promise<void> {
  const id = storeItemId.trim();
  if (!id) return;

  const etsyLinks = await prisma.etsyListingLink.findMany({
    where: { storeItemId: id },
    select: { etsyConnectionId: true, etsyListingId: true },
  });
  const shopifyLinks = await prisma.shopifyListingLink.findMany({
    where: { storeItemId: id },
    select: { shopifyConnectionId: true, shopifyProductId: true },
  });

  await prisma.$transaction(async (tx) => {
    await tx.etsyVariantMap.deleteMany({ where: { storeItemId: id } });
    await tx.etsyListingLink.deleteMany({ where: { storeItemId: id } });
    await tx.shopifyVariantMap.deleteMany({ where: { storeItemId: id } });
    await tx.shopifyListingLink.deleteMany({ where: { storeItemId: id } });
  });

  const cancelled = {
    state: "DEAD" as const,
    completedAt: new Date(),
    lastErrorClass: "CANCELLED",
    lastErrorCode: "INW_ENDED",
    lastErrorMessage: "INW listing ended and the channel link was removed",
    leaseOwner: null,
    leaseToken: null,
    leaseExpiresAt: null,
  };
  const jobWhere = {
    state: { in: [...OPEN_JOB] },
    payload: { path: ["storeItemId"], equals: id },
  };
  await prisma.etsySyncJob.updateMany({ where: jobWhere, data: cancelled });
  await prisma.shopifySyncJob.updateMany({ where: jobWhere, data: cancelled });
  if (etsyLinks.length > 0) {
    await prisma.etsyListingImportAttempt.updateMany({
      where: {
        OR: etsyLinks.map((link) => ({
          etsyConnectionId: link.etsyConnectionId,
          etsyListingId: link.etsyListingId,
        })),
      },
      data: {
        status: "FAILED",
        failureCode: "INW_ENDED",
        failureMessage: "INW listing ended and the channel link was removed",
        storeItemId: null,
        listingLinkId: null,
        etsyProductId: null,
        etsyOfferingId: null,
      },
    });
  }
  if (shopifyLinks.length > 0) {
    await prisma.shopifyListingImportAttempt.updateMany({
      where: {
        OR: shopifyLinks.map((link) => ({
          shopifyConnectionId: link.shopifyConnectionId,
          shopifyProductId: link.shopifyProductId,
        })),
      },
      data: {
        status: "FAILED",
        failureCode: "INW_ENDED",
        failureMessage: "INW listing ended and the channel link was removed",
        storeItemId: null,
        listingLinkId: null,
        shopifyVariantId: null,
        shopifyInventoryItemId: null,
      },
    });
  }
}

/** Unlink channel rows that still point at listings already ended on INW. */
export async function disconnectChannelsForEndedStoreItems(memberId: string): Promise<void> {
  const ended = await prisma.storeItem.findMany({
    where: {
      memberId,
      status: "inactive",
      OR: [{ etsyListingLinks: { some: {} } }, { shopifyListingLinks: { some: {} } }],
    },
    select: { id: true },
  });
  for (const item of ended) {
    await disconnectStoreItemChannels(item.id);
  }
}
