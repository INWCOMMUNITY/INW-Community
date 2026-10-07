import {
  classifyWixListingHealth,
  enqueueWixSyncJob,
  WixSyncJobConflictError,
  ensureWixProjectInventoryJob,
  hasUnprojectedWixInventoryDesires,
  markWixListingReconciled,
  persistWixListingHealth,
  prisma,
  refreshWixListingHealthFromDb,
  stickyWixDivergenceIssue,
  wixUpdateListingContentDedupeKey,
  type WixJobHandlerResult,
  type WixSyncJobClaim,
} from "database";
import { readWixAppConfig } from "./config";
import { accessTokenForWixConnection } from "./connect";
import { wixApplicationRequest } from "./client";
import { WIX_CATALOG_V1, WIX_V1_PRODUCT_GET, WIX_V3_PRODUCTS } from "./constants";
import { alignWixInventoryWithInw } from "./project-inventory";
import {
  isSyncWixVariantTopologyFailure,
  syncWixListingVariantTopology,
} from "./sync-listing-variants";

type ReconcilePayload = {
  listingLinkId: string;
  storeItemId?: string;
  pushTopology?: boolean;
};

/**
 * Refresh remote visibility and seller-facing health, then queue any unpushed content or inventory.
 * When pushTopology is set, rewrite Wix product options from the INW matrix first.
 */
export async function handleWixReconcileListingJob(
  claim: WixSyncJobClaim
): Promise<WixJobHandlerResult> {
  const payload = claim.payload as ReconcilePayload | null;
  if (!payload?.listingLinkId) {
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: "MISSING_PAYLOAD",
      errorMessage: "Missing listingLinkId in job payload",
    };
  }

  const link = await prisma.wixListingLink.findUnique({
    where: { id: payload.listingLinkId },
    include: {
      connection: true,
      storeItem: { select: { title: true, priceCents: true, photos: true } },
      variantMaps: {
        select: {
          inventoryDesiredVersion: true,
          inventoryAppliedVersion: true,
          desiredVariantContentVersion: true,
          appliedVariantContentVersion: true,
        },
      },
    },
  });
  if (!link) {
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: "LINK_NOT_FOUND",
      errorMessage: "Listing link not found",
    };
  }

  if (payload.pushTopology && link.connection.status === "ACTIVE") {
    const synced = await syncWixListingVariantTopology({
      connectionId: link.wixConnectionId,
      memberId: link.memberId,
      listingLinkId: link.id,
      storeItemId: link.storeItemId,
      wixProductId: link.wixProductId,
      catalogVersion: link.connection.catalogVersion,
      direction: "push",
      forcePush: true,
    });
    if (isSyncWixVariantTopologyFailure(synced)) {
      return synced;
    }
    await refreshWixListingHealthFromDb(prisma, link.id);
  }

  let remoteProductVisible = link.remoteProductVisible;
  let lastErrorCode: string | null = null;
  let lastErrorMessage: string | null = null;

  if (link.connection.status === "ACTIVE") {
    const config = readWixAppConfig();
    if (!config) {
      lastErrorCode = "NOT_CONFIGURED";
      lastErrorMessage = "Wix is not configured";
    } else {
      try {
        const accessToken = await accessTokenForWixConnection({
          instanceId: link.connection.instanceId,
        });
        const isV1 = link.connection.catalogVersion === WIX_CATALOG_V1;
        const result = await wixApplicationRequest<{ product?: { visible?: boolean } }>({
          method: "GET",
          path: `${isV1 ? WIX_V1_PRODUCT_GET : WIX_V3_PRODUCTS}/${link.wixProductId}`,
          deps: { config, accessToken, maxAttempts: 1 },
        });
        if (!result.ok) {
          lastErrorCode = result.class === "NOT_FOUND" ? "PRODUCT_NOT_FOUND" : result.class;
          lastErrorMessage = result.message;
        } else {
          remoteProductVisible = result.data?.product?.visible ?? remoteProductVisible;
          await prisma.wixListingLink.update({
            where: { id: link.id },
            data: { remoteProductVisible },
          });
        }
      } catch (error) {
        lastErrorCode = "TRANSIENT";
        lastErrorMessage = error instanceof Error ? error.message : "Reconcile failed";
      }
    }
  }

  if (link.connection.status === "ACTIVE" && !lastErrorCode) {
    const aligned = await alignWixInventoryWithInw({
      listingLinkId: link.id,
      wixConnectionId: link.wixConnectionId,
      memberId: link.memberId,
      wixProductId: link.wixProductId,
      catalogVersion: link.connection.catalogVersion,
      instanceId: link.connection.instanceId,
    });
    if ("error" in aligned || aligned.unreadable > 0) {
      lastErrorCode = "INVENTORY_UNREADABLE";
      lastErrorMessage = "Wix quantities could not be read";
    } else if (aligned.matrixIncomplete) {
      lastErrorCode = null;
    } else if (aligned.diverged > 0) {
      lastErrorCode = "INVENTORY_MISMATCH";
      lastErrorMessage = "Wix quantities do not match INW";
    }
  }

  const refreshed = await prisma.wixListingLink.findUnique({
    where: { id: link.id },
    include: {
      variantMaps: {
        select: {
          inventoryDesiredVersion: true,
          inventoryAppliedVersion: true,
          desiredVariantContentVersion: true,
          appliedVariantContentVersion: true,
        },
      },
      storeItem: { select: { title: true, priceCents: true, photos: true } },
      connection: true,
    },
  });
  if (!refreshed) {
    return { outcome: "SUCCESS" };
  }

  const photos = Array.isArray(refreshed.storeItem.photos) ? refreshed.storeItem.photos : [];
  const inventoryDesiredVersion = refreshed.variantMaps.reduce(
    (max, map) => Math.max(max, map.inventoryDesiredVersion),
    0
  );
  const inventoryAppliedVersion = refreshed.variantMaps.reduce(
    (max, map) => Math.max(max, map.inventoryAppliedVersion),
    0
  );
  const variantContentPending = refreshed.variantMaps.some(
    (map) => map.desiredVariantContentVersion > map.appliedVariantContentVersion
  );
  const productContentPending =
    refreshed.desiredProductContentVersion > refreshed.appliedProductContentVersion;
  const topologyPending =
    refreshed.topologyDesiredFingerprint != null &&
    refreshed.topologyDesiredFingerprint !== refreshed.topologyAppliedFingerprint;
  const sticky = stickyWixDivergenceIssue({
    issueCode: refreshed.issueCode,
    issueMessage: refreshed.issueMessage,
    productContentConflict: refreshed.productContentConflict,
    contentPending: productContentPending || variantContentPending || topologyPending,
    inventoryPending: inventoryDesiredVersion > inventoryAppliedVersion,
    topologyPending,
  });
  const effectiveErrorCode = lastErrorCode ?? sticky?.code ?? null;
  const effectiveErrorMessage = lastErrorCode ? lastErrorMessage : (sticky?.message ?? null);
  const health = classifyWixListingHealth({
    connectionStatus: refreshed.connection.status === "ACTIVE" ? "ACTIVE" : "DISCONNECTED",
    remoteProductVisible,
    hasPhotos: photos.some((photo) => typeof photo === "string" && photo.trim().length > 0),
    priceCents: refreshed.storeItem.priceCents,
    contentDesiredVersion: refreshed.desiredProductContentVersion,
    contentAppliedVersion: refreshed.appliedProductContentVersion,
    variantContentPending,
    topologyPending,
    inventoryDesiredVersion,
    inventoryAppliedVersion,
    lastErrorCode: effectiveErrorCode,
    lastErrorMessage: effectiveErrorMessage,
  });
  await persistWixListingHealth(prisma, link.id, health);

  if (refreshed.connection.status === "ACTIVE" && topologyPending && !payload.pushTopology) {
    try {
      await enqueueWixSyncJob(prisma, {
        wixConnectionId: link.wixConnectionId,
        kind: "RECONCILE_LISTING",
        dedupeKey: `RECONCILE_LISTING:${link.id}:topo-push`,
        payload: { listingLinkId: link.id, pushTopology: true },
      });
    } catch (error) {
      if (!(error instanceof WixSyncJobConflictError)) throw error;
    }
  }
  if (refreshed.connection.status === "ACTIVE" && (productContentPending || variantContentPending)) {
    await enqueueWixSyncJob(prisma, {
      wixConnectionId: link.wixConnectionId,
      kind: "UPDATE_LISTING_CONTENT",
      dedupeKey: wixUpdateListingContentDedupeKey(link.id),
      payload: { listingLinkId: link.id },
    });
  }
  if (refreshed.connection.status === "ACTIVE" && (await hasUnprojectedWixInventoryDesires(prisma, link.id))) {
    await ensureWixProjectInventoryJob(prisma, {
      wixConnectionId: link.wixConnectionId,
      listingLinkId: link.id,
    });
  }

  await markWixListingReconciled(prisma, link.id);

  if (lastErrorCode === "THROTTLED" || lastErrorCode === "TRANSIENT" || lastErrorCode === "NETWORK") {
    return {
      outcome: "RETRY",
      errorClass: lastErrorCode,
      errorCode: lastErrorCode,
      errorMessage: lastErrorMessage ?? "Reconcile will retry",
    };
  }
  return { outcome: "SUCCESS" };
}
