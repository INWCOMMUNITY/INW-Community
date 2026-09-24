import {
  createShopifyListingMapping,
  enqueueShopifySyncJob,
  lookupShopifyListingByStoreItem,
  prisma,
  ShopifyMappingConflictError,
  ShopifyMappingError,
  ShopifySyncJobConflictError,
} from "database";
import type { ShopifyJobHandlerResult, ShopifySyncJobClaim } from "database";
import type { ShopifyFetch } from "./admin-graphql";
import { shopifyCreateListingDedupeKey } from "./listing-export-id";
import { ensureShopifyListingExportMetafieldDefinition } from "./listing-metafield";
import { productSetShopifyDraftListing } from "./product-set-listing";

export type EnqueueShopifyCreateListingResult =
  | {
      status: "ALREADY_MAPPED";
      connectionId: string;
      storeItemId: string;
      shopifyProductId: string;
    }
  | {
      status: "QUEUED";
      connectionId: string;
      storeItemId: string;
      jobId: string;
    }
  | {
      status: "ERROR";
      code:
        | "UNAUTHORIZED"
        | "NOT_FOUND"
        | "CONNECTION_INACTIVE"
        | "LOCATION_REQUIRED"
        | "UNSUPPORTED_VARIANTS"
        | "CONFLICT";
      message: string;
    };

function parseCreateListingPayload(payload: unknown): {
  storeItemId: string;
  storeVariantId: string;
} | null {
  if (!payload || typeof payload !== "object") return null;
  const row = payload as Record<string, unknown>;
  const storeItemId = typeof row.storeItemId === "string" ? row.storeItemId : "";
  const storeVariantId = typeof row.storeVariantId === "string" ? row.storeVariantId : "";
  if (!storeItemId || !storeVariantId) return null;
  return { storeItemId, storeVariantId };
}

/**
 * Seller-initiated enqueue for CREATE_LISTING. No Shopify network calls.
 */
export async function enqueueShopifyCreateListing(input: {
  memberId: string;
  storeItemId: string;
}): Promise<EnqueueShopifyCreateListingResult> {
  const connection = await prisma.shopifyConnection.findFirst({
    where: { memberId: input.memberId, status: "ACTIVE" },
    orderBy: { connectedAt: "desc" },
  });
  if (!connection) {
    return {
      status: "ERROR",
      code: "CONNECTION_INACTIVE",
      message: "No active Shopify connection",
    };
  }
  if (!connection.primaryLocationId) {
    return {
      status: "ERROR",
      code: "LOCATION_REQUIRED",
      message: "Select a primary Shopify location before listing",
    };
  }

  const storeItem = await prisma.storeItem.findFirst({
    where: { id: input.storeItemId, memberId: input.memberId },
    select: { id: true, status: true },
  });
  if (!storeItem) {
    return { status: "ERROR", code: "NOT_FOUND", message: "Store item was not found" };
  }

  const variants = await prisma.storeVariant.findMany({
    where: { storeItemId: storeItem.id, memberId: input.memberId },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  if (variants.length !== 1) {
    return {
      status: "ERROR",
      code: "UNSUPPORTED_VARIANTS",
      message: "Shopify export currently supports simple listings with exactly one variant",
    };
  }

  const mapped = await lookupShopifyListingByStoreItem(prisma, {
    connectionId: connection.id,
    storeItemId: storeItem.id,
  });
  if (mapped.status === "MAPPED") {
    return {
      status: "ALREADY_MAPPED",
      connectionId: connection.id,
      storeItemId: storeItem.id,
      shopifyProductId: mapped.listingLink.shopifyProductId,
    };
  }
  if (mapped.status === "CONNECTION_INACTIVE") {
    return {
      status: "ERROR",
      code: "CONNECTION_INACTIVE",
      message: "Shopify connection is not active",
    };
  }

  try {
    const job = await enqueueShopifySyncJob(prisma, {
      shopifyConnectionId: connection.id,
      kind: "CREATE_LISTING",
      dedupeKey: shopifyCreateListingDedupeKey(connection.id, storeItem.id),
      payload: {
        storeItemId: storeItem.id,
        storeVariantId: variants[0].id,
      },
    });
    return {
      status: "QUEUED",
      connectionId: connection.id,
      storeItemId: storeItem.id,
      jobId: job.id,
    };
  } catch (error) {
    if (error instanceof ShopifySyncJobConflictError) {
      return {
        status: "ERROR",
        code: "CONFLICT",
        message: "A conflicting Shopify listing job already exists",
      };
    }
    throw error;
  }
}

/**
 * CREATE_LISTING worker handler. Network outside DB transactions.
 * productSet uses generation-scoped customId so NETWORK_UNKNOWN retries are safe.
 */
export async function handleShopifyCreateListingJob(
  claim: ShopifySyncJobClaim,
  deps: { fetchImpl?: ShopifyFetch; now?: Date } = {}
): Promise<ShopifyJobHandlerResult> {
  const payload = parseCreateListingPayload(claim.payload);
  if (!payload) {
    return {
      outcome: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: "INVALID_PAYLOAD",
      errorMessage: "CREATE_LISTING payload is invalid",
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
  if (!connection.primaryLocationId) {
    return {
      outcome: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: "LOCATION_REQUIRED",
      errorMessage: "Primary Shopify location is required",
    };
  }

  const existing = await lookupShopifyListingByStoreItem(prisma, {
    connectionId: connection.id,
    storeItemId: payload.storeItemId,
  });
  if (existing.status === "MAPPED") {
    return { outcome: "SUCCESS" };
  }
  if (existing.status === "CONNECTION_INACTIVE") {
    return {
      outcome: "DEAD",
      errorClass: "CONNECTION_INACTIVE",
      errorCode: "CONNECTION_INACTIVE",
      errorMessage: "Shopify connection is not active",
    };
  }

  const storeItem = await prisma.storeItem.findFirst({
    where: { id: payload.storeItemId, memberId: connection.memberId },
  });
  if (!storeItem || storeItem.status === "inactive") {
    return {
      outcome: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: "STORE_ITEM_UNAVAILABLE",
      errorMessage: "Store item is unavailable for Shopify export",
    };
  }

  const variants = await prisma.storeVariant.findMany({
    where: { storeItemId: storeItem.id, memberId: connection.memberId },
    orderBy: { createdAt: "asc" },
  });
  if (variants.length !== 1 || variants[0].id !== payload.storeVariantId) {
    return {
      outcome: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: "UNSUPPORTED_VARIANTS",
      errorMessage: "Store item no longer has exactly one matching variant",
    };
  }
  const variant = variants[0];

  const ensured = await ensureShopifyListingExportMetafieldDefinition({
    connectionId: connection.id,
    fetchImpl: deps.fetchImpl,
    now: deps.now,
  });
  if (!ensured.ok) {
    return ensured.class === "RETRY"
      ? {
          outcome: "RETRY",
          errorClass: ensured.errorClass,
          errorCode: ensured.errorCode,
          errorMessage: ensured.errorMessage,
        }
      : {
          outcome: "DEAD",
          errorClass: ensured.errorClass,
          errorCode: ensured.errorCode,
          errorMessage: ensured.errorMessage,
        };
  }

  const remote = await productSetShopifyDraftListing({
    connectionId: connection.id,
    storeItemId: storeItem.id,
    title: storeItem.title,
    descriptionHtml: storeItem.description,
    priceCents: variant.priceCents,
    sku: variant.sku,
    fetchImpl: deps.fetchImpl,
    now: deps.now,
  });
  if (!remote.ok) {
    return remote.class === "RETRY"
      ? {
          outcome: "RETRY",
          errorClass: remote.errorClass,
          errorCode: remote.errorCode,
          errorMessage: remote.errorMessage,
        }
      : {
          outcome: "DEAD",
          errorClass: remote.errorClass,
          errorCode: remote.errorCode,
          errorMessage: remote.errorMessage,
        };
  }

  try {
    await createShopifyListingMapping(prisma, {
      memberId: connection.memberId,
      connectionId: connection.id,
      storeItemId: storeItem.id,
      shopifyProductId: remote.productId,
      variants: [
        {
          storeVariantId: variant.id,
          shopifyVariantId: remote.variantId,
          shopifyInventoryItemId: remote.inventoryItemId,
        },
      ],
    });
  } catch (error) {
    if (error instanceof ShopifyMappingConflictError) {
      return {
        outcome: "DEAD",
        errorClass: "MAPPING_CONFLICT",
        errorCode: "MAPPING_CONFLICT",
        errorMessage: "Shopify mapping conflict",
      };
    }
    if (error instanceof ShopifyMappingError && error.code === "CONNECTION_INACTIVE") {
      return {
        outcome: "DEAD",
        errorClass: "CONNECTION_INACTIVE",
        errorCode: "CONNECTION_INACTIVE",
        errorMessage: error.message,
      };
    }
    throw error;
  }

  return { outcome: "SUCCESS" };
}
