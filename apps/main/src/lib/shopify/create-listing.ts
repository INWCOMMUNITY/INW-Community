import {
  correlateVariantsByOptionCombination,
  createShopifyListingMapping,
  enqueueShopifySyncJob,
  lookupShopifyListingByStoreItem,
  prisma,
  SHOPIFY_MAX_OPTION_DIMENSIONS,
  SHOPIFY_MAX_VARIANTS,
  ShopifyMappingConflictError,
  ShopifyMappingError,
  ShopifySyncJobConflictError,
  validateShopifyImportTopology,
} from "database";
import type { ShopifyJobHandlerResult, ShopifySyncJobClaim } from "database";
import type { ShopifyFetch } from "./admin-graphql";
import { shopifyCreateListingDedupeKey } from "./listing-export-id";
import { centsToShopifyMoney } from "./listing-export-id";
import { ensureShopifyListingExportMetafieldDefinition } from "./listing-metafield";
import { lookupShopifyListingProductByCustomId } from "./listing-product-lookup";
import {
  productSetShopifyDraftListing,
  productSetShopifyMultiVariantDraftListing,
} from "./product-set-listing";
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

type CreateListingPayload = {
  storeItemId: string;
  storeVariantId: string;
  multiVariant?: boolean;
  storeVariantIds?: string[];
};

function parseCreateListingPayload(payload: unknown): CreateListingPayload | null {
  if (!payload || typeof payload !== "object") return null;
  const row = payload as Record<string, unknown>;
  const storeItemId = typeof row.storeItemId === "string" ? row.storeItemId : "";
  const storeVariantId = typeof row.storeVariantId === "string" ? row.storeVariantId : "";
  if (!storeItemId || !storeVariantId) return null;
  const multiVariant = row.multiVariant === true;
  const storeVariantIds = Array.isArray(row.storeVariantIds)
    ? row.storeVariantIds.filter((v): v is string => typeof v === "string" && v.length > 0)
    : undefined;
  return { storeItemId, storeVariantId, multiVariant, storeVariantIds };
}

/**
 * Seller-initiated enqueue for CREATE_LISTING. No Shopify network calls.
 * Now supports 1..100 variants with ≤3 option axes.
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
    select: { id: true, options: true },
    orderBy: { createdAt: "asc" },
  });
  if (variants.length < 1 || variants.length > SHOPIFY_MAX_VARIANTS) {
    return {
      status: "ERROR",
      code: "UNSUPPORTED_VARIANTS",
      message: `Shopify export supports 1–${SHOPIFY_MAX_VARIANTS} variants; found ${variants.length}`,
    };
  }

  // For multi-variant, validate axes count
  if (variants.length > 1) {
    const axisNames = new Set<string>();
    for (const v of variants) {
      const opts = typeof v.options === "string" ? JSON.parse(v.options) : v.options;
      if (opts && typeof opts === "object") {
        for (const key of Object.keys(opts as Record<string, unknown>)) {
          axisNames.add(key);
        }
      }
    }
    if (axisNames.size < 1 || axisNames.size > SHOPIFY_MAX_OPTION_DIMENSIONS) {
      return {
        status: "ERROR",
        code: "UNSUPPORTED_VARIANTS",
        message: `Shopify export supports 1–${SHOPIFY_MAX_OPTION_DIMENSIONS} option dimensions; found ${axisNames.size}`,
      };
    }
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

  const isMulti = variants.length > 1;
  try {
    const job = await enqueueShopifySyncJob(prisma, {
      shopifyConnectionId: connection.id,
      kind: "CREATE_LISTING",
      dedupeKey: shopifyCreateListingDedupeKey(connection.id, storeItem.id),
      payload: {
        storeItemId: storeItem.id,
        storeVariantId: variants[0].id,
        ...(isMulti
          ? { multiVariant: true, storeVariantIds: variants.map((v) => v.id) }
          : {}),
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
  storeVariantId: string;
  productId: string;
  variantId: string;
  inventoryItemId: string;
}): Promise<ShopifyJobHandlerResult> {
  let listingLinkId: string;
  try {
    const mapped = await createShopifyListingMapping(prisma, {
      memberId: input.memberId,
      connectionId: input.connectionId,
      storeItemId: input.storeItemId,
      shopifyProductId: input.productId,
      variants: [
        {
          storeVariantId: input.storeVariantId,
          shopifyVariantId: input.variantId,
          shopifyInventoryItemId: input.inventoryItemId,
        },
      ],
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

  const storeItemForMedia = await prisma.storeItem.findFirst({
    where: { id: input.storeItemId, memberId: input.memberId },
    select: { photos: true },
  });
  if (storeItemForMedia?.photos?.length) {
    const { syncShopifyListingMedia } = await import("./sync-listing-media");
    const media = await syncShopifyListingMedia({
      connectionId: input.connectionId,
      listingLinkId,
      memberId: input.memberId,
      storeItemId: input.storeItemId,
      productId: input.productId,
      photos: storeItemForMedia.photos,
    });
    if (!media.ok && media.outcome === "RETRY") {
      return {
        outcome: "RETRY",
        errorClass: media.errorClass,
        errorCode: media.errorCode,
        errorMessage: media.errorMessage,
      };
    }
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

async function persistMultiVariantCreateListingMapping(input: {
  memberId: string;
  connectionId: string;
  storeItemId: string;
  pairs: Array<{
    storeVariantId: string;
    shopifyVariantId: string;
    shopifyInventoryItemId: string;
  }>;
  productId: string;
}): Promise<ShopifyJobHandlerResult> {
  let listingLinkId: string;
  try {
    const mapped = await createShopifyListingMapping(prisma, {
      memberId: input.memberId,
      connectionId: input.connectionId,
      storeItemId: input.storeItemId,
      shopifyProductId: input.productId,
      variants: input.pairs,
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

  const storeItemForMedia = await prisma.storeItem.findFirst({
    where: { id: input.storeItemId, memberId: input.memberId },
    select: { photos: true },
  });
  if (storeItemForMedia?.photos?.length) {
    const { syncShopifyListingMedia } = await import("./sync-listing-media");
    const media = await syncShopifyListingMedia({
      connectionId: input.connectionId,
      listingLinkId,
      memberId: input.memberId,
      storeItemId: input.storeItemId,
      productId: input.productId,
      photos: storeItemForMedia.photos,
    });
    if (!media.ok && media.outcome === "RETRY") {
      return {
        outcome: "RETRY",
        errorClass: media.errorClass,
        errorCode: media.errorCode,
        errorMessage: media.errorMessage,
      };
    }
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

/**
 * CREATE_LISTING worker handler. Network outside DB transactions.
 * Supports both single and multi-variant listings.
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

  const ensured = await ensureShopifyListingExportMetafieldDefinition({
    connectionId: connection.id,
    fetchImpl: deps.fetchImpl,
    now: deps.now,
  });
  if (!ensured.ok) {
    return ensured.class === "RETRY"
      ? { outcome: "RETRY", errorClass: ensured.errorClass, errorCode: ensured.errorCode, errorMessage: ensured.errorMessage }
      : { outcome: "DEAD", errorClass: ensured.errorClass, errorCode: ensured.errorCode, errorMessage: ensured.errorMessage };
  }

  // ── Multi-variant export path ──
  if (payload.multiVariant && payload.storeVariantIds && payload.storeVariantIds.length > 1) {
    return handleMultiVariantCreate({
      claim,
      connection: connection as { id: string; memberId: string; primaryLocationId: string },
      storeItem: storeItem as { id: string; title: string; description: string | null },
      variants,
      payload,
      deps,
    });
  }

  // ── Simple single-variant path ──
  if (variants.length !== 1 || variants[0].id !== payload.storeVariantId) {
    return {
      outcome: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: "UNSUPPORTED_VARIANTS",
      errorMessage: "Store item no longer has exactly one matching variant",
    };
  }
  const variant = variants[0];

  const discovered = await lookupShopifyListingProductByCustomId({
    connectionId: connection.id,
    storeItemId: storeItem.id,
    fetchImpl: deps.fetchImpl,
    now: deps.now,
  });
  if (!discovered.ok) {
    return discovered.class === "RETRY"
      ? { outcome: "RETRY", errorClass: discovered.errorClass, errorCode: discovered.errorCode, errorMessage: discovered.errorMessage }
      : { outcome: "DEAD", errorClass: discovered.errorClass, errorCode: discovered.errorCode, errorMessage: discovered.errorMessage };
  }

  if (discovered.product) {
    return persistCreateListingMapping({
      memberId: connection.memberId,
      connectionId: connection.id,
      storeItemId: storeItem.id,
      storeVariantId: variant.id,
      productId: discovered.product.productId,
      variantId: discovered.product.variantId,
      inventoryItemId: discovered.product.inventoryItemId,
    });
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
      ? { outcome: "RETRY", errorClass: remote.errorClass, errorCode: remote.errorCode, errorMessage: remote.errorMessage }
      : { outcome: "DEAD", errorClass: remote.errorClass, errorCode: remote.errorCode, errorMessage: remote.errorMessage };
  }

  return persistCreateListingMapping({
    memberId: connection.memberId,
    connectionId: connection.id,
    storeItemId: storeItem.id,
    storeVariantId: variant.id,
    productId: remote.productId,
    variantId: remote.variantId,
    inventoryItemId: remote.inventoryItemId,
  });
}

async function handleMultiVariantCreate(ctx: {
  claim: ShopifySyncJobClaim;
  connection: { id: string; memberId: string; primaryLocationId: string };
  storeItem: { id: string; title: string; description: string | null };
  variants: Array<{ id: string; priceCents: number; sku: string | null; options: unknown }>;
  payload: CreateListingPayload;
  deps: { fetchImpl?: ShopifyFetch; now?: Date };
}): Promise<ShopifyJobHandlerResult> {
  const { connection, storeItem, variants, deps } = ctx;

  if (variants.length < 2 || variants.length > SHOPIFY_MAX_VARIANTS) {
    return {
      outcome: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: "UNSUPPORTED_VARIANTS",
      errorMessage: `Multi-variant export requires 2–${SHOPIFY_MAX_VARIANTS} variants`,
    };
  }

  // Build productOptions and variant optionValues from StoreVariant.options
  const axisMap = new Map<string, Set<string>>();
  const variantOptionsList: Array<{ storeVariantId: string; options: Record<string, string> }> = [];

  for (const v of variants) {
    const opts = typeof v.options === "string" ? JSON.parse(v.options) : v.options;
    if (!opts || typeof opts !== "object") {
      return {
        outcome: "DEAD",
        errorClass: "GRAPHQL_PERMANENT",
        errorCode: "INVALID_VARIANT_OPTIONS",
        errorMessage: `Variant ${v.id} has no option data`,
      };
    }
    const entries = Object.entries(opts as Record<string, string>);
    if (entries.length < 1 || entries.length > SHOPIFY_MAX_OPTION_DIMENSIONS) {
      return {
        outcome: "DEAD",
        errorClass: "GRAPHQL_PERMANENT",
        errorCode: "OPTION_DIMENSION_LIMIT",
        errorMessage: `Variant options must have 1–${SHOPIFY_MAX_OPTION_DIMENSIONS} dimensions`,
      };
    }
    const parsed: Record<string, string> = {};
    for (const [name, value] of entries) {
      if (!axisMap.has(name)) axisMap.set(name, new Set());
      axisMap.get(name)!.add(String(value));
      parsed[name] = String(value);
    }
    variantOptionsList.push({ storeVariantId: v.id, options: parsed });
  }

  const productOptions = Array.from(axisMap.entries()).map(([name, values]) => ({
    name,
    values: Array.from(values).map((v) => ({ name: v })),
  }));

  const variantById = new Map(variants.map((v) => [v.id, v]));
  const shopifyVariants = variantOptionsList.map((vo) => {
    const sv = variantById.get(vo.storeVariantId)!;
    return {
      optionValues: Object.entries(vo.options).map(([optionName, name]) => ({
        optionName,
        name,
      })),
      price: centsToShopifyMoney(sv.priceCents),
      ...(sv.sku ? { sku: sv.sku } : {}),
    };
  });

  const remote = await productSetShopifyMultiVariantDraftListing({
    connectionId: connection.id,
    storeItemId: storeItem.id,
    title: storeItem.title,
    descriptionHtml: storeItem.description,
    productOptions,
    variants: shopifyVariants,
    fetchImpl: deps.fetchImpl,
    now: deps.now,
  });

  if (!remote.ok) {
    return remote.class === "RETRY"
      ? { outcome: "RETRY", errorClass: remote.errorClass, errorCode: remote.errorCode, errorMessage: remote.errorMessage }
      : { outcome: "DEAD", errorClass: remote.errorClass, errorCode: remote.errorCode, errorMessage: remote.errorMessage };
  }

  // Correlate returned variants by selectedOptions
  const correlation = correlateVariantsByOptionCombination({
    requested: variantOptionsList.map((vo) => ({
      storeVariantId: vo.storeVariantId,
      selectedOptions: Object.entries(vo.options).map(([name, value]) => ({ name, value })),
    })),
    remote: remote.variants.map((v) => ({
      shopifyVariantId: v.variantId,
      shopifyInventoryItemId: v.inventoryItemId,
      selectedOptions: v.selectedOptions,
    })),
  });

  if (!correlation.ok) {
    return {
      outcome: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: correlation.code,
      errorMessage: correlation.message,
    };
  }

  return persistMultiVariantCreateListingMapping({
    memberId: connection.memberId,
    connectionId: connection.id,
    storeItemId: storeItem.id,
    pairs: correlation.pairs,
    productId: remote.productId,
  });
}
