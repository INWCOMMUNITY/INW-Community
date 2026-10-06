import {
  classifyWixListingHealth,
  enqueueWixSyncJob,
  ensureWixProjectInventoryJob,
  hasUnprojectedWixInventoryDesires,
  markWixListingReconciled,
  persistWixListingHealth,
  prisma,
  wixUpdateListingContentDedupeKey,
  type WixJobHandlerResult,
  type WixSyncJobClaim,
} from "database";
import { readWixAppConfig } from "./config";
import { accessTokenForWixConnection } from "./connect";
import { wixApplicationRequest } from "./client";
import { WIX_CATALOG_V1, WIX_V1_PRODUCT_GET, WIX_V3_PRODUCTS } from "./constants";

type ReconcilePayload = { listingLinkId: string };

/**
 * Refresh remote visibility and seller-facing health, then queue any unpushed content or inventory.
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
        select: { inventoryDesiredVersion: true, inventoryAppliedVersion: true },
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

  const photos = Array.isArray(link.storeItem.photos) ? link.storeItem.photos : [];
  const inventoryDesiredVersion = link.variantMaps.reduce(
    (max, map) => Math.max(max, map.inventoryDesiredVersion),
    0
  );
  const inventoryAppliedVersion = link.variantMaps.reduce(
    (max, map) => Math.max(max, map.inventoryAppliedVersion),
    0
  );
  const health = classifyWixListingHealth({
    connectionStatus: link.connection.status === "ACTIVE" ? "ACTIVE" : "DISCONNECTED",
    remoteProductVisible,
    hasPhotos: photos.some((photo) => typeof photo === "string" && photo.trim().length > 0),
    priceCents: link.storeItem.priceCents,
    contentDesiredVersion: link.desiredProductContentVersion,
    contentAppliedVersion: link.appliedProductContentVersion,
    inventoryDesiredVersion,
    inventoryAppliedVersion,
    lastErrorCode,
    lastErrorMessage,
  });
  await persistWixListingHealth(prisma, link.id, health);

  if (link.connection.status === "ACTIVE" && link.desiredProductContentVersion > link.appliedProductContentVersion) {
    await enqueueWixSyncJob(prisma, {
      wixConnectionId: link.wixConnectionId,
      kind: "UPDATE_LISTING_CONTENT",
      dedupeKey: wixUpdateListingContentDedupeKey(link.id),
      payload: { listingLinkId: link.id },
    });
  }
  if (link.connection.status === "ACTIVE" && (await hasUnprojectedWixInventoryDesires(prisma, link.id))) {
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
