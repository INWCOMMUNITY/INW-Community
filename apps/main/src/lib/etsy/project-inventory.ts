import {
  markEtsyInventoryProjectionApplied,
  prisma,
  reconcileEtsyListingHealthFromDb,
  type EtsyJobHandlerResult,
  type EtsySyncJobClaim,
} from "database";
import { etsyConnectionRequest } from "./connection-request";
import type { EtsyFetch } from "./client";

function parsePayload(payload: unknown): {
  storeItemId: string;
  storeVariantId: string;
  inventoryDesiredVersion: number;
} | null {
  if (!payload || typeof payload !== "object") return null;
  const row = payload as Record<string, unknown>;
  const storeItemId = typeof row.storeItemId === "string" ? row.storeItemId : "";
  const storeVariantId = typeof row.storeVariantId === "string" ? row.storeVariantId : "";
  const inventoryDesiredVersion =
    typeof row.inventoryDesiredVersion === "number" ? Math.trunc(row.inventoryDesiredVersion) : NaN;
  if (
    !storeItemId ||
    !storeVariantId ||
    !Number.isFinite(inventoryDesiredVersion) ||
    inventoryDesiredVersion < 1
  ) {
    return null;
  }
  return { storeItemId, storeVariantId, inventoryDesiredVersion };
}

function classifyFailure(
  apiClass: string,
  retryAfterMs: number | null
): Extract<EtsyJobHandlerResult, { outcome: "RETRY" | "DEAD" }> {
  if (apiClass === "THROTTLED" || apiClass === "TRANSIENT" || apiClass === "NETWORK") {
    return {
      outcome: "RETRY",
      errorClass: apiClass,
      errorCode: apiClass,
      errorMessage: `Etsy provider ${apiClass}`,
      retryAt: retryAfterMs != null ? new Date(Date.now() + retryAfterMs) : undefined,
    };
  }
  if (apiClass === "AUTH" || apiClass === "CONNECTION_INACTIVE" || apiClass === "NOT_CONFIGURED") {
    return {
      outcome: "DEAD",
      errorClass: apiClass,
      errorCode: apiClass,
      errorMessage: `Etsy authorization unavailable (${apiClass})`,
    };
  }
  return {
    outcome: "DEAD",
    errorClass: apiClass || "PERMANENT",
    errorCode: apiClass || "PROVIDER_ERROR",
    errorMessage: "Etsy inventory projection failed permanently",
  };
}

type RemoteInventory = {
  products?: Array<{
    product_id?: number | string;
    sku?: string | null;
    offerings?: Array<{
      offering_id?: number | string;
      quantity?: number;
      is_enabled?: boolean;
      price?: unknown;
    }>;
    property_values?: unknown;
  }>;
  price_on_property?: number[];
  quantity_on_property?: number[];
  sku_on_property?: number[];
};

/**
 * PROJECT_INVENTORY handler.
 * Always GET→mutate→PUT the full products[] snapshot (incomplete PUT deletes variants).
 * Stale desires succeed without network writes. Qty 0 sell-outs are allowed.
 */
export async function handleEtsyProjectInventoryJob(
  claim: EtsySyncJobClaim,
  deps: { fetchImpl?: EtsyFetch; now?: Date } = {}
): Promise<EtsyJobHandlerResult> {
  const payload = parsePayload(claim.payload);
  if (!payload) {
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: "INVALID_PAYLOAD",
      errorMessage: "PROJECT_INVENTORY payload is invalid",
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

  const listing = await prisma.etsyListingLink.findUnique({
    where: {
      etsyConnectionId_storeItemId: {
        etsyConnectionId: connection.id,
        storeItemId: payload.storeItemId,
      },
    },
  });
  if (!listing) {
    return {
      outcome: "DEAD",
      errorClass: "UNMAPPED",
      errorCode: "UNMAPPED",
      errorMessage: "Store item is not mapped on this Etsy connection generation",
    };
  }
  if (listing.inventoryHealth === "PAUSED") {
    return { outcome: "SUCCESS" };
  }

  const variantMap = await prisma.etsyVariantMap.findFirst({
    where: {
      etsyListingLinkId: listing.id,
      etsyConnectionId: connection.id,
      storeVariantId: payload.storeVariantId,
    },
  });
  if (!variantMap) {
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: "UNSUPPORTED_VARIANTS",
      errorMessage: "Mapped listing has no variant map matching the job payload",
    };
  }

  if (
    payload.inventoryDesiredVersion < variantMap.inventoryDesiredVersion ||
    payload.inventoryDesiredVersion <= variantMap.inventoryAppliedVersion
  ) {
    return { outcome: "SUCCESS" };
  }
  if (payload.inventoryDesiredVersion !== variantMap.inventoryDesiredVersion) {
    return { outcome: "SUCCESS" };
  }
  if (
    variantMap.inventoryDesiredAvailable == null ||
    !Number.isInteger(variantMap.inventoryDesiredAvailable) ||
    variantMap.inventoryDesiredAvailable < 0
  ) {
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: "INVALID_DESIRED_AVAILABLE",
      errorMessage: "Desired available quantity is invalid",
    };
  }

  const desiredQty = variantMap.inventoryDesiredAvailable;

  const inventoryRes = await etsyConnectionRequest<RemoteInventory>({
    connectionId: connection.id,
    memberId: connection.memberId,
    method: "GET",
    path: `/listings/${encodeURIComponent(listing.etsyListingId)}/inventory`,
    query: { max_variations_supported: 3 },
    maxAttempts: 3,
    fetchImpl: deps.fetchImpl,
    now: deps.now,
  });
  if (!inventoryRes.ok || !inventoryRes.data?.products) {
    return classifyFailure(inventoryRes.class, inventoryRes.retryAfterMs);
  }

  const products = inventoryRes.data.products;
  let matched = false;
  let remoteQty: number | null = null;
  const nextProducts = products.map((product) => {
    const productId = String(product.product_id ?? "");
    const offerings = (product.offerings ?? []).map((offering) => {
      const offeringId = String(offering.offering_id ?? "");
      if (productId === variantMap.etsyProductId && offeringId === variantMap.etsyOfferingId) {
        matched = true;
        remoteQty = typeof offering.quantity === "number" ? offering.quantity : null;
        return {
          ...offering,
          quantity: desiredQty,
          is_enabled: offering.is_enabled ?? true,
        };
      }
      return offering;
    });
    return { ...product, offerings };
  });

  if (!matched) {
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: "OFFERING_NOT_FOUND",
      errorMessage: "Mapped Etsy offering was not found in listing inventory",
    };
  }

  if (remoteQty !== desiredQty) {
    const put = await etsyConnectionRequest({
      connectionId: connection.id,
      memberId: connection.memberId,
      method: "PUT",
      path: `/listings/${encodeURIComponent(listing.etsyListingId)}/inventory`,
      body: {
        products: nextProducts,
        price_on_property: inventoryRes.data.price_on_property ?? [],
        quantity_on_property: inventoryRes.data.quantity_on_property ?? [],
        sku_on_property: inventoryRes.data.sku_on_property ?? [],
      },
      maxAttempts: 1,
      fetchImpl: deps.fetchImpl,
      now: deps.now,
    });
    if (!put.ok) {
      return classifyFailure(put.class, put.retryAfterMs);
    }
  }

  await markEtsyInventoryProjectionApplied(prisma, {
    variantMapId: variantMap.id,
    desiredVersion: payload.inventoryDesiredVersion,
    available: desiredQty,
    now: deps.now,
  });

  await reconcileEtsyListingHealthFromDb(prisma, {
    connectionId: connection.id,
    listingLinkId: listing.id,
  }).catch(() => undefined);

  return { outcome: "SUCCESS" };
}
