import {
  ensureShopifyPublishListingJob,
  persistShopifyListingHealth,
  prisma,
  shopifyPublishListingDedupeKey,
  ShopifySyncJobConflictError,
  type ShopifySyncJobKind,
} from "database";
import { shopifyCreateListingDedupeKey } from "./listing-export-id";
import {
  deleteShopifyProduct,
  unpublishShopifyListingFromOnlineStore,
} from "./publish-listing";

const REVIVE_JOB_KINDS: ShopifySyncJobKind[] = [
  "CREATE_LISTING",
  "UPDATE_LISTING_CONTENT",
  "PUBLISH_LISTING",
];

const REVIVE_JOB_DATA = {
  state: "PENDING" as const,
  attemptCount: 0,
  nextAttemptAt: new Date(),
  completedAt: null,
  leaseOwner: null,
  leaseToken: null,
  leaseExpiresAt: null,
  lastErrorClass: null,
  lastErrorCode: null,
  lastErrorMessage: null,
};

export async function reviveDeadShopifyListingJobs(input: {
  connectionId: string;
  storeItemId: string;
}): Promise<{ revivedJobIds: string[] }> {
  const contentPrefix = `UPDATE_LISTING_CONTENT:${input.connectionId}:${input.storeItemId}:`;
  const deadJobs = await prisma.shopifySyncJob.findMany({
    where: {
      shopifyConnectionId: input.connectionId,
      kind: { in: REVIVE_JOB_KINDS },
      state: "DEAD",
      OR: [
        { dedupeKey: shopifyCreateListingDedupeKey(input.connectionId, input.storeItemId) },
        { dedupeKey: shopifyPublishListingDedupeKey(input.connectionId, input.storeItemId) },
        { dedupeKey: { startsWith: contentPrefix } },
        {
          payload: {
            path: ["storeItemId"],
            equals: input.storeItemId,
          },
        },
      ],
    },
    select: { id: true },
  });

  const revivedJobIds: string[] = [];
  for (const job of deadJobs) {
    const revived = await prisma.shopifySyncJob.updateMany({
      where: { id: job.id, state: "DEAD" },
      data: REVIVE_JOB_DATA,
    });
    if (revived.count === 1) revivedJobIds.push(job.id);
  }
  return { revivedJobIds };
}

async function rearmPublishJobIfReady(input: {
  connectionId: string;
  memberId: string;
  storeItemId: string;
  listingLinkId: string;
}): Promise<void> {
  const connection = await prisma.shopifyConnection.findFirst({
    where: { id: input.connectionId, memberId: input.memberId, status: "ACTIVE" },
    select: { primaryLocationId: true },
  });
  if (!connection?.primaryLocationId) return;

  try {
    const job = await ensureShopifyPublishListingJob(prisma, {
      connectionId: input.connectionId,
      storeItemId: input.storeItemId,
      listingLinkId: input.listingLinkId,
    });
    if (job.state === "DEAD") {
      await prisma.shopifySyncJob.updateMany({
        where: { id: job.id, state: "DEAD" },
        data: REVIVE_JOB_DATA,
      });
    }
  } catch (error) {
    if (!(error instanceof ShopifySyncJobConflictError)) throw error;
  }
}

export async function runShopifyListingRetryAction(input: {
  connectionId: string;
  memberId: string;
  storeItemId: string;
}): Promise<{ revivedJobIds: string[]; publishRearmed: boolean }> {
  const { revivedJobIds } = await reviveDeadShopifyListingJobs({
    connectionId: input.connectionId,
    storeItemId: input.storeItemId,
  });

  const listing = await prisma.shopifyListingLink.findFirst({
    where: {
      shopifyConnectionId: input.connectionId,
      memberId: input.memberId,
      storeItemId: input.storeItemId,
    },
    select: { id: true },
  });

  let publishRearmed = false;
  if (listing) {
    const publishKey = shopifyPublishListingDedupeKey(input.connectionId, input.storeItemId);
    const before = await prisma.shopifySyncJob.findUnique({
      where: { dedupeKey: publishKey },
      select: { id: true, state: true },
    });
    await rearmPublishJobIfReady({
      connectionId: input.connectionId,
      memberId: input.memberId,
      storeItemId: input.storeItemId,
      listingLinkId: listing.id,
    });
    const after = await prisma.shopifySyncJob.findUnique({
      where: { dedupeKey: publishKey },
      select: { id: true, state: true },
    });
    const activeStates = new Set(["PENDING", "RETRY_WAIT", "RUNNING"]);
    publishRearmed = Boolean(
      after &&
        activeStates.has(after.state) &&
        (!before || before.state === "DEAD" || revivedJobIds.includes(after.id))
    );
  }

  return { revivedJobIds, publishRearmed };
}

export async function runShopifyListingUnpublishAction(input: {
  connectionId: string;
  memberId: string;
  storeItemId: string;
}): Promise<{ unpublishOk: boolean; unpublishError: string | null }> {
  const listing = await prisma.shopifyListingLink.findFirst({
    where: {
      shopifyConnectionId: input.connectionId,
      memberId: input.memberId,
      storeItemId: input.storeItemId,
    },
  });
  if (!listing) {
    return { unpublishOk: false, unpublishError: "NOT_SYNCED" };
  }

  const unpublish = await unpublishShopifyListingFromOnlineStore({
    connectionId: input.connectionId,
    shopifyProductId: listing.shopifyProductId,
  });

  const issueMessage = unpublish.ok
    ? "Unpublished from Online Store"
    : `Unpublished from Online Store (Shopify: ${unpublish.errorMessage})`;

  await persistShopifyListingHealth(prisma, {
    listingLinkId: listing.id,
    health: {
      readiness: "ACTION_REQUIRED",
      contentHealth: listing.contentHealth,
      inventoryHealth: listing.inventoryHealth,
      issueCode: unpublish.ok ? "UNPUBLISHED_ONLINE_STORE" : "UNPUBLISH_PARTIAL",
      issueFingerprint: `unpublish:${listing.shopifyProductId}`,
      issueSeverity: "ACTION_REQUIRED",
      issueMessage,
      blockContentOutbound: listing.contentHealth === "PAUSED",
      blockInventoryOutbound: listing.inventoryHealth === "PAUSED",
      remoteProductStatus: listing.remoteProductStatus,
    },
    previous: listing,
  });

  return {
    unpublishOk: unpublish.ok,
    unpublishError: unpublish.ok ? null : unpublish.errorMessage,
  };
}

export async function runShopifyListingRemoveAction(input: {
  connectionId: string;
  memberId: string;
  storeItemId: string;
  confirmDelete: boolean;
}): Promise<{
  mappingRemoved: boolean;
  productDeleted: boolean;
  productDeleteError: string | null;
}> {
  const listing = await prisma.shopifyListingLink.findFirst({
    where: {
      shopifyConnectionId: input.connectionId,
      memberId: input.memberId,
      storeItemId: input.storeItemId,
    },
    select: { id: true, shopifyProductId: true },
  });
  if (!listing) {
    return {
      mappingRemoved: false,
      productDeleted: false,
      productDeleteError: "Listing is not synced on this Shopify connection",
    };
  }

  await unpublishShopifyListingFromOnlineStore({
    connectionId: input.connectionId,
    shopifyProductId: listing.shopifyProductId,
  });

  await prisma.shopifyVariantMap.deleteMany({
    where: {
      shopifyConnectionId: input.connectionId,
      shopifyListingLinkId: listing.id,
      storeItemId: input.storeItemId,
    },
  });
  await prisma.shopifyListingLink.delete({
    where: { id: listing.id },
  });

  let productDeleted = false;
  let productDeleteError: string | null = null;
  if (input.confirmDelete) {
    const deleted = await deleteShopifyProduct({
      connectionId: input.connectionId,
      shopifyProductId: listing.shopifyProductId,
    });
    productDeleted = deleted.ok;
    if (!deleted.ok) productDeleteError = deleted.errorMessage;
  }

  return { mappingRemoved: true, productDeleted, productDeleteError };
}
