import {
  classifyShopifyListingHealth,
  ensureShopifyPublishListingJob,
  persistShopifyListingHealth,
  prisma,
  ShopifySyncJobConflictError,
} from "database";
import type { ShopifyJobHandlerResult, ShopifySyncJobClaim } from "database";
import type { ShopifyFetch } from "./admin-graphql";
import { ensureShopifyListingActiveAndPublishedToOnlineStore } from "./publish-listing";

function parsePublishListingPayload(payload: unknown): {
  storeItemId: string;
  listingLinkId: string;
} | null {
  if (!payload || typeof payload !== "object") return null;
  const row = payload as Record<string, unknown>;
  const storeItemId = typeof row.storeItemId === "string" ? row.storeItemId : "";
  const listingLinkId = typeof row.listingLinkId === "string" ? row.listingLinkId : "";
  if (!storeItemId || !listingLinkId) return null;
  return { storeItemId, listingLinkId };
}

/**
 * PUBLISH_LISTING worker: after inventory init, ACTIVE + Online Store publish.
 * Waits (RETRY) while physical inventory is still PENDING.
 * Never runs for already-mapped Sync no-ops (those never enqueue this job).
 * Does not change INW StoreItem status.
 */
export async function handleShopifyPublishListingJob(
  claim: ShopifySyncJobClaim,
  deps: { fetchImpl?: ShopifyFetch; now?: Date } = {}
): Promise<ShopifyJobHandlerResult> {
  const payload = parsePublishListingPayload(claim.payload);
  if (!payload) {
    return {
      outcome: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: "INVALID_PAYLOAD",
      errorMessage: "PUBLISH_LISTING payload is invalid",
    };
  }

  const connection = await prisma.shopifyConnection.findUnique({
    where: { id: claim.shopifyConnectionId },
  });
  if (!connection || connection.status !== "ACTIVE") {
    return {
      outcome: "DEAD",
      errorClass: "CONNECTION_INACTIVE",
      errorCode: "CONNECTION_INACTIVE",
      errorMessage: "Shopify connection is not active for this generation",
    };
  }

  const listing = await prisma.shopifyListingLink.findFirst({
    where: {
      id: payload.listingLinkId,
      shopifyConnectionId: connection.id,
      storeItemId: payload.storeItemId,
    },
  });
  if (!listing) {
    return {
      outcome: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: "LISTING_NOT_MAPPED",
      errorMessage: "Shopify listing mapping was not found for publication",
    };
  }

  const storeItem = await prisma.storeItem.findFirst({
    where: { id: payload.storeItemId, memberId: connection.memberId },
    select: { id: true, status: true },
  });
  if (!storeItem || storeItem.status === "inactive") {
    return {
      outcome: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: "STORE_ITEM_UNAVAILABLE",
      errorMessage: "INW listing is unavailable; export publication aborted without changing INW status",
    };
  }

  const variantMap = await prisma.shopifyVariantMap.findFirst({
    where: {
      shopifyListingLinkId: listing.id,
      shopifyConnectionId: connection.id,
    },
    orderBy: { createdAt: "asc" },
  });
  if (!variantMap) {
    return {
      outcome: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: "VARIANT_MAP_MISSING",
      errorMessage: "Shopify variant mapping was not found for publication",
    };
  }

  if (variantMap.inventoryInitState === "PENDING") {
    return {
      outcome: "RETRY",
      errorClass: "TRANSIENT_PROVIDER",
      errorCode: "INVENTORY_INIT_PENDING",
      errorMessage: "Waiting for selected-location inventory initialization before Online Store publication",
      retryAt: new Date((deps.now ?? new Date()).getTime() + 5_000),
    };
  }
  if (variantMap.inventoryInitState === "FAILED") {
    return {
      outcome: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: "INVENTORY_INIT_FAILED",
      errorMessage:
        "Shopify inventory initialization failed for this listing, so it was not published to the Online Store. Fix inventory, then retry Sync.",
    };
  }

  const published = await ensureShopifyListingActiveAndPublishedToOnlineStore({
    connectionId: connection.id,
    shopifyProductId: listing.shopifyProductId,
    fetchImpl: deps.fetchImpl,
    now: deps.now,
  });

  if (!published.ok) {
    if (published.class === "DEAD") {
      const health = classifyShopifyListingHealth({
        connectionStatus: connection.status,
        primaryLocationId: connection.primaryLocationId,
        listing,
        variantMap,
        hasCausalSaleConflict: false,
        remote: {
          productExists: true,
          productStatus: listing.remoteProductStatus,
          variantCount: 1,
          mappedVariantPresent: true,
          inventoryItemMatches: true,
          inventoryTracked: variantMap.inventoryInitState === "INITIALIZED" ? true : null,
          inventoryLevelExists: variantMap.inventoryInitState === "INITIALIZED",
          remoteAvailable: variantMap.inventoryLastObservedAvailable,
          remoteProductFingerprint: listing.appliedProductFingerprint,
          remoteVariantFingerprint: variantMap.appliedVariantFingerprint,
        },
      });
      await persistShopifyListingHealth(prisma, {
        listingLinkId: listing.id,
        health: {
          ...health,
          readiness: "ACTION_REQUIRED",
          issueCode: published.errorCode.slice(0, 64),
          issueFingerprint: `publish:${published.errorCode}`,
          issueSeverity: "ACTION_REQUIRED",
          issueMessage: published.errorMessage.slice(0, 1000),
        },
        previous: listing,
        now: deps.now,
      });
    }
    return published.class === "RETRY"
      ? {
          outcome: "RETRY",
          errorClass: published.errorClass,
          errorCode: published.errorCode,
          errorMessage: published.errorMessage,
        }
      : {
          outcome: "DEAD",
          errorClass: published.errorClass,
          errorCode: published.errorCode,
          errorMessage: published.errorMessage,
        };
  }

  const health = classifyShopifyListingHealth({
    connectionStatus: connection.status,
    primaryLocationId: connection.primaryLocationId,
    listing,
    variantMap,
    hasCausalSaleConflict: false,
    remote: {
      productExists: true,
      productStatus: "ACTIVE",
      variantCount: 1,
      mappedVariantPresent: true,
      inventoryItemMatches: true,
      inventoryTracked: variantMap.inventoryInitState === "INITIALIZED" ? true : null,
      inventoryLevelExists:
        variantMap.inventoryInitState === "INITIALIZED"
          ? true
          : variantMap.inventoryInitState === "NOT_APPLICABLE"
            ? false
            : null,
      remoteAvailable: variantMap.inventoryAppliedAvailable,
      remoteProductFingerprint: listing.appliedProductFingerprint,
      remoteVariantFingerprint: variantMap.appliedVariantFingerprint,
    },
  });
  await persistShopifyListingHealth(prisma, {
    listingLinkId: listing.id,
    health: {
      ...health,
      readiness: "READY_TO_PUBLISH",
      contentHealth: "HEALTHY",
      inventoryHealth: "HEALTHY",
      issueCode: null,
      issueFingerprint: null,
      issueSeverity: null,
      issueMessage: null,
      remoteProductStatus: "ACTIVE",
    },
    previous: listing,
    now: deps.now,
  });

  // Confirm INW listing remained active (never mutated by this handler).
  const stillActive = await prisma.storeItem.findFirst({
    where: { id: storeItem.id, memberId: connection.memberId },
    select: { status: true },
  });
  if (!stillActive || stillActive.status === "inactive") {
    return {
      outcome: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: "STORE_ITEM_BECAME_INACTIVE",
      errorMessage: "INW listing became inactive during Shopify publication",
    };
  }

  return { outcome: "SUCCESS" };
}

/** Used by CREATE_LISTING after a new mapping is written. */
export async function enqueueShopifyPublishListingAfterMapping(input: {
  connectionId: string;
  storeItemId: string;
  listingLinkId: string;
}): Promise<{ ok: true; jobId: string } | { ok: false; errorMessage: string }> {
  try {
    const job = await ensureShopifyPublishListingJob(prisma, input);
    if (job.state === "DEAD") {
      const revived = await prisma.shopifySyncJob.updateMany({
        where: { id: job.id, state: "DEAD" },
        data: {
          state: "PENDING",
          attemptCount: 0,
          nextAttemptAt: new Date(),
          completedAt: null,
          leaseOwner: null,
          leaseToken: null,
          leaseExpiresAt: null,
          lastErrorClass: null,
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      });
      if (revived.count !== 1) {
        return {
          ok: false,
          errorMessage: "Could not re-arm Shopify publication job after a prior failure",
        };
      }
    }
    return { ok: true, jobId: job.id };
  } catch (error) {
    if (error instanceof ShopifySyncJobConflictError) {
      return { ok: false, errorMessage: "Conflicting Shopify publication job already exists" };
    }
    throw error;
  }
}
