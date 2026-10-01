import {
  ensureEtsyProjectInventoryJob,
  ensureEtsyUpdateListingContentJob,
  prisma,
  reconcileEtsyListingHealthFromDb,
  resolveEtsyHowItsMadeForCreate,
  type EtsyJobHandlerResult,
  type EtsySyncJobClaim,
} from "database";
import { resolveEtsyTaxonomyFallback, sanitizeEtsyTaxonomyId } from "./taxonomy-default";
import { resolveEtsyReadinessStateId } from "./readiness-state";
import {
  isSyncEtsyVariantTopologyFailure,
  syncEtsyListingVariantTopology,
} from "./sync-listing-variants";

function parsePayload(payload: unknown): {
  listingLinkId: string;
  storeItemId: string;
  pushTopology: boolean;
} | null {
  if (!payload || typeof payload !== "object") return null;
  const row = payload as Record<string, unknown>;
  const listingLinkId = typeof row.listingLinkId === "string" ? row.listingLinkId : "";
  const storeItemId = typeof row.storeItemId === "string" ? row.storeItemId : "";
  if (!listingLinkId || !storeItemId) return null;
  return { listingLinkId, storeItemId, pushTopology: row.pushTopology === true };
}

/** RECONCILE_LISTING: remesh Size×Color maps, refresh health, re-ensure outbound jobs. */
export async function handleEtsyReconcileListingJob(
  claim: EtsySyncJobClaim
): Promise<EtsyJobHandlerResult> {
  const payload = parsePayload(claim.payload);
  if (!payload) {
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: "INVALID_PAYLOAD",
      errorMessage: "RECONCILE_LISTING payload is invalid",
    };
  }

  const connection = await prisma.etsyConnection.findUnique({
    where: { id: claim.etsyConnectionId },
  });
  if (!connection || connection.status !== "ACTIVE") {
    return {
      outcome: "DEAD",
      errorClass: "CONNECTION_INACTIVE",
      errorCode: "CONNECTION_INACTIVE",
      errorMessage: "Etsy connection is not active for this generation",
    };
  }

  const listing = await prisma.etsyListingLink.findFirst({
    where: { id: payload.listingLinkId, etsyConnectionId: claim.etsyConnectionId },
    select: {
      id: true,
      storeItemId: true,
      etsyListingId: true,
      desiredProductContentVersion: true,
      appliedProductContentVersion: true,
    },
  });
  if (!listing) {
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: "LISTING_MISSING",
      errorMessage: "Mapped Etsy listing was not found for reconcile",
    };
  }

  const storeItem = await prisma.storeItem.findFirst({
    where: { id: listing.storeItemId, memberId: connection.memberId },
    select: {
      id: true,
      inventoryTracking: true,
      etsyTaxonomyId: true,
      etsyWhoMade: true,
      etsyWhenMade: true,
      etsyIsSupply: true,
    },
  });

  if (storeItem) {
    const how = resolveEtsyHowItsMadeForCreate({
      etsyWhoMade: storeItem.etsyWhoMade,
      etsyWhenMade: storeItem.etsyWhenMade,
      etsyIsSupply: storeItem.etsyIsSupply,
      etsyTaxonomyId: sanitizeEtsyTaxonomyId(storeItem.etsyTaxonomyId),
      defaultTaxonomyId: resolveEtsyTaxonomyFallback(connection.defaultTaxonomyId),
      inventoryTracking: storeItem.inventoryTracking,
    });
    const readiness = how.ok
      ? await resolveEtsyReadinessStateId({
          connectionId: connection.id,
          memberId: connection.memberId,
          shopId: connection.shopId,
          whenMade: how.whenMade,
          inventoryTracking: storeItem.inventoryTracking,
        })
      : null;
    const canPush = Boolean(payload.pushTopology && how.ok && readiness?.ok);
    const canPull = !payload.pushTopology;
    if (canPush || canPull) {
      const synced = await syncEtsyListingVariantTopology({
        connectionId: connection.id,
        memberId: connection.memberId,
        listingLinkId: listing.id,
        storeItemId: storeItem.id,
        etsyListingId: listing.etsyListingId,
        taxonomyId: how.ok ? how.taxonomyId : 0,
        readinessStateId: readiness?.ok ? readiness.readinessStateId : 0,
        inventoryTracking: storeItem.inventoryTracking,
        direction: canPush ? "push" : "pull",
      });
      if (isSyncEtsyVariantTopologyFailure(synced)) {
        return synced;
      }
    }
  }

  const health = await reconcileEtsyListingHealthFromDb(prisma, {
    connectionId: claim.etsyConnectionId,
    listingLinkId: payload.listingLinkId,
  });
  if (!health) {
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: "LISTING_MISSING",
      errorMessage: "Mapped Etsy listing was not found for reconcile",
    };
  }

  const variantMaps = await prisma.etsyVariantMap.findMany({
    where: { etsyListingLinkId: listing.id, etsyConnectionId: claim.etsyConnectionId },
    select: {
      storeVariantId: true,
      desiredVariantContentVersion: true,
      appliedVariantContentVersion: true,
      inventoryDesiredVersion: true,
      inventoryAppliedVersion: true,
      inventoryDesiredAvailable: true,
      inventoryAppliedAvailable: true,
    },
  });

  for (const map of variantMaps) {
    const contentPending =
      listing.desiredProductContentVersion > listing.appliedProductContentVersion ||
      map.desiredVariantContentVersion > map.appliedVariantContentVersion;
    if (contentPending) {
      await ensureEtsyUpdateListingContentJob(prisma, {
        connectionId: claim.etsyConnectionId,
        storeItemId: listing.storeItemId,
        storeVariantId: map.storeVariantId,
        productDesiredVersion: listing.desiredProductContentVersion,
        variantDesiredVersion: map.desiredVariantContentVersion,
      }).catch(() => undefined);
    }
    const inventoryPending =
      map.inventoryDesiredVersion > map.inventoryAppliedVersion ||
      (map.inventoryDesiredAvailable != null &&
        map.inventoryDesiredAvailable !== map.inventoryAppliedAvailable);
    if (inventoryPending && map.inventoryDesiredVersion > 0) {
      await ensureEtsyProjectInventoryJob(prisma, {
        connectionId: claim.etsyConnectionId,
        storeItemId: listing.storeItemId,
        storeVariantId: map.storeVariantId,
        inventoryDesiredVersion: map.inventoryDesiredVersion,
      }).catch(() => undefined);
    }
  }

  return { outcome: "SUCCESS" };
}
