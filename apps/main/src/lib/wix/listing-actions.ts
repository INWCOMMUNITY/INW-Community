import {
  captureWixInventoryProjectionDesire,
  deleteWixListingMapping,
  enqueueWixSyncJob,
  ensureWixProjectInventoryJob,
  hasUnprojectedWixInventoryDesires,
  lookupWixListingByStoreItem,
  lookupWixVariantByStoreVariant,
  prisma,
  recordWixListingContentDesire,
  getActiveWixConnectionForMember,
  type WixPublicConnection,
} from "database";
import { readWixAppConfig } from "./config";
import { accessTokenForWixConnection } from "./connect";
import { wixApplicationRequest } from "./client";
import { WIX_CATALOG_V1, WIX_V1_PRODUCT_GET, WIX_V3_PRODUCTS } from "./constants";

export type WixListingActionResult =
  | { success: true; listingLinkId?: string; enqueued?: boolean }
  | { success: false; error: string; status?: number };

/**
 * After a store item's content changes, enqueue a job to push updates to Wix.
 */
export async function scheduleWixContentUpdate(input: {
  storeItemId: string;
  memberId: string;
}): Promise<void> {
  // Get active connection for member
  const connection = await getActiveWixConnectionForMember(prisma, input.memberId);
  if (!connection) {
    return; // No active connection
  }

  const mapping = await lookupWixListingByStoreItem(
    prisma,
    connection.id,
    input.storeItemId
  );

  if (!mapping || mapping.listingLink.readiness === "CONNECTION_REQUIRED") {
    return; // Not linked or connection inactive
  }

  // Record content desire (bumps desired version)
  await recordWixListingContentDesire(prisma, {
    listingLinkId: mapping.listingLink.id,
    productFingerprint: null, // Will be computed during push
    triggeredBy: "CONTENT_UPDATE",
  });

  // Enqueue update job
  await enqueueWixSyncJob(prisma, {
    wixConnectionId: mapping.listingLink.wixConnectionId,
    kind: "UPDATE_LISTING_CONTENT",
    dedupeKey: `update-content-${mapping.listingLink.id}`,
    payload: {
      listingLinkId: mapping.listingLink.id,
    },
    nextAttemptAt: new Date(),
  });
}

/**
 * After inventory changes, enqueue a job to push quantities to Wix.
 */
export async function scheduleWixInventoryProjection(input: {
  storeVariantId: string;
  memberId: string;
  available: number;
}): Promise<void> {
  // Get active connection for member
  const connection = await getActiveWixConnectionForMember(prisma, input.memberId);
  if (!connection) {
    return;
  }

  const variantMap = await lookupWixVariantByStoreVariant(
    prisma,
    connection.id,
    input.storeVariantId
  );

  if (!variantMap) {
    return;
  }

  // Look up the listing link
  const listingLink = await prisma.wixListingLink.findUnique({
    where: { id: variantMap.wixListingLinkId },
  });

  if (!listingLink || listingLink.readiness === "CONNECTION_REQUIRED") {
    return;
  }

  // Capture inventory desire (records what we want to push)
  await captureWixInventoryProjectionDesire(prisma, {
    variantMapId: variantMap.id,
    wixConnectionId: connection.id,
    listingLinkId: listingLink.id,
    desiredAvailable: input.available,
  });

  // Ensure inventory projection job exists
  await ensureWixProjectInventoryJob(prisma, {
    listingLinkId: listingLink.id,
    wixConnectionId: connection.id,
  });
}

/**
 * Create a new listing on Wix from an existing INW store item.
 */
export async function createWixListing(input: {
  storeItemId: string;
  memberId: string;
  connection: WixPublicConnection;
}): Promise<WixListingActionResult> {
  const config = readWixAppConfig();
  if (!config) {
    return { success: false, error: "Wix is not configured", status: 500 };
  }

  // Check if already linked
  const existing = await lookupWixListingByStoreItem(
    prisma,
    input.connection.id,
    input.storeItemId
  );

  if (existing) {
    return { success: true, listingLinkId: existing.listingLink.id };
  }

  // Enqueue create listing job
  const dedupeKey = `create-listing-${input.connection.id}-${input.storeItemId}`;
  
  await enqueueWixSyncJob(prisma, {
    wixConnectionId: input.connection.id,
    kind: "CREATE_LISTING",
    dedupeKey,
    payload: {
      storeItemId: input.storeItemId,
      memberId: input.memberId,
    },
    nextAttemptAt: new Date(),
  });

  return { success: true, enqueued: true };
}

/**
 * Load mapping status for a store item on Wix.
 */
export async function loadMappedWixListing(input: {
  storeItemId: string;
  memberId: string;
}): Promise<
  | {
      linked: true;
      link: {
        id: string;
        wixProductId: string;
        readiness: string;
        contentHealth: string;
        inventoryHealth: string;
        issueCode: string | null;
        issueMessage: string | null;
        remoteProductVisible: boolean | null;
      };
    }
  | { linked: false }
  | { error: string; status: number }
> {
  try {
    // Get active connection for member
    const connection = await getActiveWixConnectionForMember(prisma, input.memberId);
    if (!connection) {
      return { linked: false };
    }

    const mapping = await lookupWixListingByStoreItem(
      prisma,
      connection.id,
      input.storeItemId
    );

    if (!mapping) {
      return { linked: false };
    }

    return {
      linked: true,
      link: {
        id: mapping.listingLink.id,
        wixProductId: mapping.listingLink.wixProductId,
        readiness: mapping.listingLink.readiness,
        contentHealth: mapping.listingLink.contentHealth,
        inventoryHealth: mapping.listingLink.inventoryHealth,
        issueCode: mapping.listingLink.issueCode,
        issueMessage: mapping.listingLink.issueMessage,
        remoteProductVisible: mapping.listingLink.remoteProductVisible,
      },
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unknown error",
      status: 500,
    };
  }
}

/**
 * Check if a store item has pending inventory projections to Wix.
 */
export async function hasWixPendingProjections(input: {
  storeItemId: string;
  memberId: string;
}): Promise<boolean> {
  // Get active connection for member
  const connection = await getActiveWixConnectionForMember(prisma, input.memberId);
  if (!connection) {
    return false;
  }

  const mapping = await lookupWixListingByStoreItem(
    prisma,
    connection.id,
    input.storeItemId
  );

  if (!mapping) {
    return false;
  }

  return hasUnprojectedWixInventoryDesires(prisma, mapping.listingLink.id);
}

/**
 * Trigger manual reconciliation of a Wix listing.
 */
export async function reconcileWixListing(input: {
  listingLinkId: string;
}): Promise<{ enqueued: boolean }> {
  const link = await prisma.wixListingLink.findUnique({
    where: { id: input.listingLinkId },
    include: { connection: true },
  });

  if (!link || link.connection.status !== "ACTIVE") {
    return { enqueued: false };
  }

  await enqueueWixSyncJob(prisma, {
    wixConnectionId: link.wixConnectionId,
    kind: "RECONCILE_LISTING",
    dedupeKey: `reconcile-${link.id}`,
    payload: { listingLinkId: link.id },
    nextAttemptAt: new Date(),
  });

  return { enqueued: true };
}

/**
 * Delete the remote Wix product and the local mapping.
 * Disconnecting the shop does not call this.
 */
export async function removeWixListing(input: {
  listingLinkId: string;
  memberId: string;
}): Promise<WixListingActionResult> {
  const config = readWixAppConfig();
  if (!config) {
    return { success: false, error: "Wix is not configured", status: 500 };
  }

  const link = await prisma.wixListingLink.findUnique({
    where: { id: input.listingLinkId },
    include: { connection: true },
  });
  if (!link || link.memberId !== input.memberId) {
    return { success: false, error: "Listing link not found", status: 404 };
  }
  if (link.connection.status !== "ACTIVE") {
    return { success: false, error: "Wix connection is not active", status: 409 };
  }

  const accessToken = await accessTokenForWixConnection({ instanceId: link.connection.instanceId });
  const isV1 = link.connection.catalogVersion === WIX_CATALOG_V1;
  const result = await wixApplicationRequest({
    method: "DELETE",
    path: `${isV1 ? WIX_V1_PRODUCT_GET : WIX_V3_PRODUCTS}/${link.wixProductId}`,
    deps: { config, accessToken, maxAttempts: 1 },
  });
  if (!result.ok && result.class !== "NOT_FOUND") {
    return { success: false, error: "Could not remove the Wix product", status: 502 };
  }

  await deleteWixListingMapping(prisma, link.id);
  return { success: true, listingLinkId: link.id };
}
