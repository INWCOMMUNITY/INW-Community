import {
  getUnprojectedWixVariantMaps,
  markWixInventoryProjectionApplied,
  prisma,
  type WixJobHandlerResult,
  type WixSyncJobClaim,
} from "database";
import { readWixAppConfig } from "./config";
import { accessTokenForWixConnection } from "./connect";
import { wixApplicationRequest } from "./client";
import {
  WIX_V2_INVENTORY_PATCH,
  WIX_V3_INVENTORY,
  WIX_CATALOG_V1,
} from "./constants";

type ProjectInventoryPayload = {
  listingLinkId: string;
};

/**
 * PROJECT_INVENTORY job handler: push inventory to Wix for all variants.
 */
export async function handleWixProjectInventoryJob(
  claim: WixSyncJobClaim
): Promise<WixJobHandlerResult> {
  const payload = claim.payload as ProjectInventoryPayload | null;
  if (!payload?.listingLinkId) {
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: "MISSING_PAYLOAD",
      errorMessage: "Missing listingLinkId in job payload",
    };
  }

  const config = readWixAppConfig();
  if (!config) {
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: "NOT_CONFIGURED",
      errorMessage: "Wix is not configured",
    };
  }

  // Load listing link
  const link = await prisma.wixListingLink.findUnique({
    where: { id: payload.listingLinkId },
  });

  if (!link) {
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: "LINK_NOT_FOUND",
      errorMessage: "Listing link not found",
    };
  }

  // Load connection separately
  const connection = await prisma.wixConnection.findUnique({
    where: { id: link.wixConnectionId },
  });

  if (!connection || connection.status !== "ACTIVE") {
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: "CONNECTION_INACTIVE",
      errorMessage: "Wix connection is not active",
    };
  }

  // Get unprojected variant maps with their foundation inventory
  const unprojectedMaps = await getUnprojectedWixVariantMaps(prisma, link.id);
  if (unprojectedMaps.length === 0) {
    // Nothing to project
    return { outcome: "SUCCESS" };
  }

  // Load current inventory state for each variant
  const variantIds = unprojectedMaps.map((m) => m.storeVariantId);
  const inventoryStates = await prisma.inventoryState.findMany({
    where: { variantId: { in: variantIds } },
  });
  const inventoryByVariant = new Map(inventoryStates.map((s) => [s.variantId, s]));

  // Build inventory updates
  const updates: Array<{
    mapId: string;
    wixVariantId: string;
    quantity: number;
    desiredVersion: number;
  }> = [];

  for (const map of unprojectedMaps) {
    const inv = inventoryByVariant.get(map.storeVariantId);
    if (!inv) continue;

    // Use the desired available from the variant map if set
    let available = map.desiredAvailable ?? 0;
    
    // Or calculate from inventory state if not set
    if (map.desiredAvailable === null && inv.mode === "TRACKED_FINITE" && inv.onHand !== null && inv.reserved !== null) {
      available = Math.max(0, inv.onHand - inv.reserved);
    }

    updates.push({
      mapId: map.id,
      wixVariantId: map.wixVariantId,
      quantity: available,
      desiredVersion: map.desiredVersion,
    });
  }

  if (updates.length === 0) {
    return { outcome: "SUCCESS" };
  }

  // Mint access token
  let accessToken: string;
  try {
    accessToken = await accessTokenForWixConnection({ instanceId: connection.instanceId });
  } catch (error) {
    return {
      outcome: "RETRY",
      errorClass: "AUTH",
      errorCode: "TOKEN_MINT_FAILED",
      errorMessage: error instanceof Error ? error.message : "Token mint failed",
    };
  }

  const isV1 = connection.catalogVersion === WIX_CATALOG_V1;
  const errors: string[] = [];

  // Push inventory to Wix
  for (const update of updates) {
    try {
      if (isV1) {
        // V1: PATCH inventory item
        const result = await wixApplicationRequest({
          method: "PATCH",
          path: `${WIX_V2_INVENTORY_PATCH}/${link.wixProductId}`,
          body: JSON.stringify({
            inventoryItem: {
              trackQuantity: true,
              variants: [{
                variantId: update.wixVariantId,
                quantity: update.quantity,
              }],
            },
          }),
          deps: { config, accessToken, maxAttempts: 1 },
        });

        if (!result.ok) {
          if (result.class === "THROTTLED" || result.class === "TRANSIENT" || result.class === "NETWORK") {
            return {
              outcome: "RETRY",
              errorClass: result.class,
              errorCode: result.class,
              errorMessage: result.message,
              retryAt: result.retryAfterMs ? new Date(Date.now() + result.retryAfterMs) : undefined,
            };
          }
          errors.push(`Variant ${update.wixVariantId}: ${result.message}`);
          continue;
        }
      } else {
        // V3: Update inventory item
        const result = await wixApplicationRequest({
          method: "PATCH",
          path: `${WIX_V3_INVENTORY}/${update.wixVariantId}`,
          body: JSON.stringify({
            inventoryItem: {
              trackQuantity: true,
              quantity: update.quantity,
            },
          }),
          deps: { config, accessToken, maxAttempts: 1 },
        });

        if (!result.ok) {
          if (result.class === "THROTTLED" || result.class === "TRANSIENT" || result.class === "NETWORK") {
            return {
              outcome: "RETRY",
              errorClass: result.class,
              errorCode: result.class,
              errorMessage: result.message,
              retryAt: result.retryAfterMs ? new Date(Date.now() + result.retryAfterMs) : undefined,
            };
          }
          errors.push(`Variant ${update.wixVariantId}: ${result.message}`);
          continue;
        }
      }

      // Mark as applied
      await markWixInventoryProjectionApplied(prisma, {
        variantMapId: update.mapId,
        appliedAvailable: update.quantity,
        appliedVersion: update.desiredVersion,
      });
    } catch (error) {
      errors.push(`Variant ${update.wixVariantId}: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  if (errors.length > 0) {
    return {
      outcome: "RETRY",
      errorClass: "TRANSIENT",
      errorCode: errors.length === updates.length ? "ALL_VARIANTS_FAILED" : "SOME_VARIANTS_FAILED",
      errorMessage: errors.join("; ").slice(0, 500),
    };
  }

  // Update listing link inventory health
  const stillPending = await getUnprojectedWixVariantMaps(prisma, link.id);
  await prisma.wixListingLink.update({
    where: { id: link.id },
    data: {
      inventoryHealth: stillPending.length > 0 ? "DEGRADED" : "HEALTHY",
    },
  });

  return { outcome: "SUCCESS" };
}
