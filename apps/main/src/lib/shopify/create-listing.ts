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
import { executeShopifyAdminGraphql } from "./admin-graphql";
import { shopifyCreateListingDedupeKey } from "./listing-export-id";
import { ensureShopifyListingExportMetafieldDefinition } from "./listing-metafield";
import { lookupShopifyListingProductByCustomId, lookupShopifyListingProductIdByCustomId } from "./listing-product-lookup";
import { ensureInwHostedListingPhotos } from "@/lib/listing-photo-rehost";
import { productSetShopifyDraftListing } from "./product-set-listing";
import { enqueueShopifyPublishListingAfterMapping } from "./publish-listing-job";

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
  storeVariantIds: string[];
} | null {
  if (!payload || typeof payload !== "object") return null;
  const row = payload as Record<string, unknown>;
  const storeItemId = typeof row.storeItemId === "string" ? row.storeItemId : "";
  if (!storeItemId) return null;
  if (Array.isArray(row.storeVariantIds)) {
    const storeVariantIds = row.storeVariantIds.filter(
      (id): id is string => typeof id === "string" && id.length > 0
    );
    if (storeVariantIds.length === 0) return null;
    return { storeItemId, storeVariantIds };
  }
  // Legacy single-variant payload.
  const storeVariantId = typeof row.storeVariantId === "string" ? row.storeVariantId : "";
  if (!storeVariantId) return null;
  return { storeItemId, storeVariantIds: [storeVariantId] };
}

function parseVariantOptions(options: unknown): Record<string, string> {
  if (!options || typeof options !== "object" || Array.isArray(options)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(options as Record<string, unknown>)) {
    const name = String(key).trim();
    const val = value == null ? "" : String(value).trim();
    if (name && val) out[name] = val;
  }
  return out;
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
    where: { storeItemId: storeItem.id, memberId: input.memberId, status: "ACTIVE" },
    select: { id: true, options: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  if (variants.length === 0) {
    return {
      status: "ERROR",
      code: "UNSUPPORTED_VARIANTS",
      message: "Shopify export requires at least one active variant",
    };
  }
  if (variants.length > 100) {
    return {
      status: "ERROR",
      code: "UNSUPPORTED_VARIANTS",
      message: "Shopify export supports at most 100 variants",
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
        storeVariantIds: variants.map((row) => row.id),
        // Keep legacy key for older workers during rollout.
        storeVariantId: variants[0]!.id,
      },
    });
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
          status: "ERROR",
          code: "CONFLICT",
          message: "A conflicting Shopify listing job already exists",
        };
      }
    }
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

async function persistCreateListingMapping(input: {
  memberId: string;
  connectionId: string;
  storeItemId: string;
  productId: string;
  variants: Array<{
    storeVariantId: string;
    variantId: string;
    inventoryItemId: string;
  }>;
}): Promise<ShopifyJobHandlerResult> {
  let listingLinkId: string;
  try {
    const mapped = await createShopifyListingMapping(prisma, {
      memberId: input.memberId,
      connectionId: input.connectionId,
      storeItemId: input.storeItemId,
      shopifyProductId: input.productId,
      variants: input.variants.map((row) => ({
        storeVariantId: row.storeVariantId,
        shopifyVariantId: row.variantId,
        shopifyInventoryItemId: row.inventoryItemId,
      })),
    });
    listingLinkId = mapped.listingLink.id;
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

  const publish = await enqueueShopifyPublishListingAfterMapping({
    connectionId: input.connectionId,
    storeItemId: input.storeItemId,
    listingLinkId,
  });
  if (!publish.ok) {
    return {
      outcome: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: "PUBLISH_ENQUEUE_FAILED",
      errorMessage: publish.errorMessage,
    };
  }
  return { outcome: "SUCCESS" };
}

async function readRemoteVariantsForRecovery(input: {
  connectionId: string;
  productId: string;
  fetchImpl?: ShopifyFetch;
  now?: Date;
}): Promise<
  | {
      ok: true;
      variants: Array<{
        id: string;
        sku: string | null;
        selectedOptions: Array<{ name: string; value: string }>;
        inventoryItemId: string;
      }>;
    }
  | { ok: false; class: "RETRY" | "DEAD"; errorClass: string; errorCode: string; errorMessage: string }
> {
  const result = await executeShopifyAdminGraphql<{
    product: {
      variants: {
        nodes: Array<{
          id: string;
          sku: string | null;
          selectedOptions: Array<{ name: string; value: string }>;
          inventoryItem: { id: string } | null;
        }>;
      };
    } | null;
  }>({
    connectionId: input.connectionId,
    operationType: "query",
    operationName: "ShopifyCreateListingRecoverVariants",
    document: `query ShopifyCreateListingRecoverVariants($id: ID!) {
      product(id: $id) {
        variants(first: 100) {
          nodes {
            id
            sku
            selectedOptions { name value }
            inventoryItem { id }
          }
        }
      }
    }`,
    variables: { id: input.productId },
    fetchImpl: input.fetchImpl,
    now: input.now,
  });
  if (!result.ok) {
    if (
      result.class === "THROTTLED" ||
      result.class === "TRANSIENT_PROVIDER" ||
      result.class === "NETWORK_UNKNOWN"
    ) {
      return {
        ok: false,
        class: "RETRY",
        errorClass: result.class,
        errorCode: "RECOVERY_VARIANTS",
        errorMessage: result.message,
      };
    }
    return {
      ok: false,
      class: "DEAD",
      errorClass: result.class,
      errorCode: "RECOVERY_VARIANTS",
      errorMessage: result.message,
    };
  }
  const nodes = result.data?.product?.variants?.nodes ?? [];
  return {
    ok: true,
    variants: nodes
      .filter((row) => row.inventoryItem?.id)
      .map((row) => ({
        id: row.id,
        sku: row.sku,
        selectedOptions: row.selectedOptions ?? [],
        inventoryItemId: row.inventoryItem!.id,
      })),
  };
}

/**
 * CREATE_LISTING worker handler. Network outside DB transactions.
 * Discover-first by customId before productSet so NETWORK_UNKNOWN / crash retries
 * never blindly remutate list fields on an already-created remote product.
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
    where: {
      storeItemId: storeItem.id,
      memberId: connection.memberId,
      id: { in: payload.storeVariantIds },
      status: "ACTIVE",
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  if (variants.length !== payload.storeVariantIds.length || variants.length === 0) {
    return {
      outcome: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: "UNSUPPORTED_VARIANTS",
      errorMessage: "Store item variants no longer match the queued export payload",
    };
  }

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

  const discovered = await lookupShopifyListingProductByCustomId({
    connectionId: connection.id,
    storeItemId: storeItem.id,
    fetchImpl: deps.fetchImpl,
    now: deps.now,
  });

  let recoveredProductId: string | null = null;
  if (discovered.ok && discovered.product) {
    recoveredProductId = discovered.product.productId;
  } else if (!discovered.ok && discovered.errorCode === "RECOVERY_VARIANT_CARDINALITY") {
    const byId = await lookupShopifyListingProductIdByCustomId({
      connectionId: connection.id,
      storeItemId: storeItem.id,
      fetchImpl: deps.fetchImpl,
      now: deps.now,
    });
    if (!byId.ok) {
      return byId.class === "RETRY"
        ? {
            outcome: "RETRY",
            errorClass: byId.errorClass,
            errorCode: byId.errorCode,
            errorMessage: byId.errorMessage,
          }
        : {
            outcome: "DEAD",
            errorClass: byId.errorClass,
            errorCode: byId.errorCode,
            errorMessage: byId.errorMessage,
          };
    }
    recoveredProductId = byId.productId;
  } else if (!discovered.ok) {
    return discovered.class === "RETRY"
      ? {
          outcome: "RETRY",
          errorClass: discovered.errorClass,
          errorCode: discovered.errorCode,
          errorMessage: discovered.errorMessage,
        }
      : {
          outcome: "DEAD",
          errorClass: discovered.errorClass,
          errorCode: discovered.errorCode,
          errorMessage: discovered.errorMessage,
        };
  }

  if (recoveredProductId) {
    if (discovered.ok && discovered.product && variants.length === 1) {
      return persistCreateListingMapping({
        memberId: connection.memberId,
        connectionId: connection.id,
        storeItemId: storeItem.id,
        productId: discovered.product.productId,
        variants: [
          {
            storeVariantId: variants[0]!.id,
            variantId: discovered.product.variantId,
            inventoryItemId: discovered.product.inventoryItemId,
          },
        ],
      });
    }
    const recovered = await readRemoteVariantsForRecovery({
      connectionId: connection.id,
      productId: recoveredProductId,
      fetchImpl: deps.fetchImpl,
      now: deps.now,
    });
    if (!recovered.ok) {
      return recovered.class === "RETRY"
        ? {
            outcome: "RETRY",
            errorClass: recovered.errorClass,
            errorCode: recovered.errorCode,
            errorMessage: recovered.errorMessage,
          }
        : {
            outcome: "DEAD",
            errorClass: recovered.errorClass,
            errorCode: recovered.errorCode,
            errorMessage: recovered.errorMessage,
          };
    }
    if (recovered.variants.length !== variants.length) {
      return {
        outcome: "DEAD",
        errorClass: "RECOVERY_CONFLICT",
        errorCode: "RECOVERY_VARIANT_CARDINALITY",
        errorMessage:
          "Recovered Shopify product variant count does not match the INW listing; refusing duplicate-safe remutation",
      };
    }
    const mappedVariants: Array<{
      storeVariantId: string;
      variantId: string;
      inventoryItemId: string;
    }> = [];
    const remaining = [...recovered.variants];
    for (const sv of variants) {
      const opts = parseVariantOptions(sv.options);
      const idx = remaining.findIndex((node) => {
        if (sv.sku && node.sku && node.sku.trim() === sv.sku.trim()) return true;
        const nodeOpts = Object.fromEntries(
          node.selectedOptions.map((o) => [o.name.trim(), o.value.trim()])
        );
        return Object.entries(opts).every(([name, value]) => nodeOpts[name] === value);
      });
      if (idx < 0) {
        return {
          outcome: "DEAD",
          errorClass: "RECOVERY_CONFLICT",
          errorCode: "RECOVERY_VARIANT_MATCH",
          errorMessage: "Could not match recovered Shopify variants to INW variants",
        };
      }
      const [node] = remaining.splice(idx, 1);
      mappedVariants.push({
        storeVariantId: sv.id,
        variantId: node!.id,
        inventoryItemId: node!.inventoryItemId,
      });
    }
    return persistCreateListingMapping({
      memberId: connection.memberId,
      connectionId: connection.id,
      storeItemId: storeItem.id,
      productId: recoveredProductId,
      variants: mappedVariants,
    });
  }

  let photos = storeItem.photos ?? [];
  try {
    photos = await ensureInwHostedListingPhotos(photos);
  } catch {
    // Keep original URLs; Shopify still needs absolute HTTPS.
  }

  const remote = await productSetShopifyDraftListing({
    connectionId: connection.id,
    storeItemId: storeItem.id,
    title: storeItem.title,
    descriptionHtml: storeItem.description,
    photos,
    vendor: storeItem.vendor,
    tags: storeItem.tags,
    aspects: storeItem.aspects,
    variants: variants.map((row) => ({
      storeVariantId: row.id,
      priceCents: row.priceCents,
      sku: row.sku,
      barcode: row.barcode ?? storeItem.barcode,
      compareAtPriceCents: row.compareAtPriceCents ?? storeItem.compareAtPriceCents,
      options: parseVariantOptions(row.options),
    })),
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

  return persistCreateListingMapping({
    memberId: connection.memberId,
    connectionId: connection.id,
    storeItemId: storeItem.id,
    productId: remote.productId,
    variants: remote.variants,
  });
}
