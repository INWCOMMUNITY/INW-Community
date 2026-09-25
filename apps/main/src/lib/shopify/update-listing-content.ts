import {
  markShopifyProductContentApplied,
  markShopifyVariantContentApplied,
  prisma,
  setShopifyProductContentConflict,
  setShopifyVariantContentConflict,
  shopifyMoneyFromCents,
  shopifyProductContentFingerprint,
  shopifyVariantContentFingerprint,
  classifyShopifyContentSemantics,
} from "database";
import type { ShopifyJobHandlerResult, ShopifySyncJobClaim } from "database";
import type { ShopifyFetch } from "./admin-graphql";
import { executeShopifyAdminGraphql } from "./admin-graphql";

function parseUpdatePayload(payload: unknown): {
  storeItemId: string;
  storeVariantId: string;
  productDesiredVersion: number;
  variantDesiredVersion: number;
} | null {
  if (!payload || typeof payload !== "object") return null;
  const row = payload as Record<string, unknown>;
  const storeItemId = typeof row.storeItemId === "string" ? row.storeItemId : "";
  const storeVariantId = typeof row.storeVariantId === "string" ? row.storeVariantId : "";
  const productDesiredVersion =
    typeof row.productDesiredVersion === "number" ? Math.trunc(row.productDesiredVersion) : NaN;
  const variantDesiredVersion =
    typeof row.variantDesiredVersion === "number" ? Math.trunc(row.variantDesiredVersion) : NaN;
  if (
    !storeItemId ||
    !storeVariantId ||
    !Number.isFinite(productDesiredVersion) ||
    !Number.isFinite(variantDesiredVersion) ||
    productDesiredVersion < 0 ||
    variantDesiredVersion < 0
  ) {
    return null;
  }
  return { storeItemId, storeVariantId, productDesiredVersion, variantDesiredVersion };
}

function shopifyPriceStringToCents(price: string): number {
  const match = /^(\d+)(?:\.(\d{0,2}))?$/.exec(String(price).trim());
  if (!match) return Number.NaN;
  const dollars = Number.parseInt(match[1], 10);
  const cents = Number.parseInt((match[2] || "").padEnd(2, "0").slice(0, 2) || "0", 10);
  return dollars * 100 + cents;
}

type HandlerFailure = {
  outcome: "RETRY" | "DEAD";
  errorClass: string;
  errorCode: string;
  errorMessage: string;
};

async function readMappedListingContent(input: {
  connectionId: string;
  productId: string;
  variantId: string;
  fetchImpl?: ShopifyFetch;
  now?: Date;
}): Promise<
  | {
      ok: true;
      product: {
        id: string;
        status: string;
        title: string;
        descriptionHtml: string | null;
        variant: { id: string; price: string; sku: string | null };
      };
    }
  | { ok: false } & HandlerFailure
> {
  const result = await executeShopifyAdminGraphql<{
    product: {
      id: string;
      status: string;
      title: string;
      descriptionHtml: string | null;
      variants: { nodes: Array<{ id: string; price: string; sku: string | null }> };
    } | null;
  }>({
    connectionId: input.connectionId,
    operationType: "query",
    operationName: "ShopifyListingContentRead",
    document: `query ShopifyListingContentRead($id: ID!) {
      product(id: $id) {
        id
        status
        title
        descriptionHtml
        variants(first: 10) {
          nodes { id price sku }
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
        outcome: "RETRY",
        errorClass: result.class,
        errorCode: "CONTENT_READ",
        errorMessage: result.message,
      };
    }
    return {
      ok: false,
      outcome: "DEAD",
      errorClass: result.class,
      errorCode: "CONTENT_READ",
      errorMessage: result.message,
    };
  }

  const product = result.data?.product ?? null;
  if (!product) {
    return {
      ok: false,
      outcome: "DEAD",
      errorClass: "REMOTE_MISSING",
      errorCode: "REMOTE_PRODUCT_MISSING",
      errorMessage: "Mapped Shopify product was not found",
    };
  }

  const nodes = product.variants?.nodes ?? [];
  const variant = nodes.find((row) => row.id === input.variantId) ?? null;
  if (!variant) {
    return {
      ok: false,
      outcome: "DEAD",
      errorClass: "REMOTE_MISSING",
      errorCode: "REMOTE_VARIANT_MISSING",
      errorMessage: "Mapped Shopify variant was not found on the product",
    };
  }

  return {
    ok: true,
    product: {
      id: product.id,
      status: product.status,
      title: product.title,
      descriptionHtml: product.descriptionHtml,
      variant,
    },
  };
}

async function productUpdateScalars(input: {
  connectionId: string;
  productId: string;
  title: string;
  descriptionHtml: string | null;
  fetchImpl?: ShopifyFetch;
  now?: Date;
}): Promise<{ ok: true } | ({ ok: false } & HandlerFailure)> {
  const result = await executeShopifyAdminGraphql<{
    productUpdate: {
      product: { id: string } | null;
      userErrors: Array<{ field?: string[] | null; message: string; code?: string | null }>;
    };
  }>({
    connectionId: input.connectionId,
    operationType: "mutation",
    operationName: "ShopifyListingContentProductUpdate",
    document: `mutation ShopifyListingContentProductUpdate($product: ProductUpdateInput!) {
      productUpdate(product: $product) {
        product { id title descriptionHtml status }
        userErrors { field message code }
      }
    }`,
    variables: {
      product: {
        id: input.productId,
        title: input.title,
        descriptionHtml: input.descriptionHtml ?? "",
      },
    },
    fetchImpl: input.fetchImpl,
    now: input.now,
  });

  if (!result.ok) {
    if (
      result.class === "THROTTLED" ||
      result.class === "TRANSIENT_PROVIDER" ||
      result.class === "NETWORK_UNKNOWN" ||
      result.outcomeUnknown
    ) {
      return {
        ok: false,
        outcome: "RETRY",
        errorClass: result.class,
        errorCode: result.outcomeUnknown ? "PRODUCT_UPDATE_UNKNOWN" : result.class,
        errorMessage: result.message,
      };
    }
    return {
      ok: false,
      outcome: "DEAD",
      errorClass: result.class,
      errorCode: result.class,
      errorMessage: result.message,
    };
  }

  const userErrors = result.data?.productUpdate.userErrors ?? [];
  if (userErrors.length > 0) {
    return {
      ok: false,
      outcome: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: (userErrors[0]?.code ?? "PRODUCT_UPDATE_USER_ERROR").slice(0, 64),
      errorMessage: (userErrors[0]?.message ?? "productUpdate user error").slice(0, 500),
    };
  }
  if (!result.data?.productUpdate.product) {
    return {
      ok: false,
      outcome: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: "PRODUCT_UPDATE_EMPTY",
      errorMessage: "productUpdate returned no product",
    };
  }
  return { ok: true };
}

async function variantBulkUpdateScalars(input: {
  connectionId: string;
  productId: string;
  variantId: string;
  price: string;
  sku: string;
  fetchImpl?: ShopifyFetch;
  now?: Date;
}): Promise<{ ok: true } | ({ ok: false } & HandlerFailure)> {
  const result = await executeShopifyAdminGraphql<{
    productVariantsBulkUpdate: {
      productVariants: Array<{ id: string }> | null;
      userErrors: Array<{ field?: string[] | null; message: string; code?: string | null }>;
    };
  }>({
    connectionId: input.connectionId,
    operationType: "mutation",
    operationName: "ShopifyListingContentVariantUpdate",
    document: `mutation ShopifyListingContentVariantUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        productVariants { id price sku }
        userErrors { field message code }
      }
    }`,
    variables: {
      productId: input.productId,
      variants: [
        {
          id: input.variantId,
          price: input.price,
          // 2026-07: SKU lives on InventoryItemInput, not ProductVariantsBulkInput root.
          inventoryItem: {
            sku: input.sku ? input.sku : null,
          },
        },
      ],
    },
    fetchImpl: input.fetchImpl,
    now: input.now,
  });

  if (!result.ok) {
    if (
      result.class === "THROTTLED" ||
      result.class === "TRANSIENT_PROVIDER" ||
      result.class === "NETWORK_UNKNOWN" ||
      result.outcomeUnknown
    ) {
      return {
        ok: false,
        outcome: "RETRY",
        errorClass: result.class,
        errorCode: result.outcomeUnknown ? "VARIANT_UPDATE_UNKNOWN" : result.class,
        errorMessage: result.message,
      };
    }
    return {
      ok: false,
      outcome: "DEAD",
      errorClass: result.class,
      errorCode: result.class,
      errorMessage: result.message,
    };
  }

  const userErrors = result.data?.productVariantsBulkUpdate.userErrors ?? [];
  if (userErrors.length > 0) {
    return {
      ok: false,
      outcome: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: (userErrors[0]?.code ?? "VARIANT_UPDATE_USER_ERROR").slice(0, 64),
      errorMessage: (userErrors[0]?.message ?? "productVariantsBulkUpdate user error").slice(0, 500),
    };
  }
  return { ok: true };
}

function failureResult(failure: HandlerFailure): ShopifyJobHandlerResult {
  return failure.outcome === "RETRY"
    ? {
        outcome: "RETRY",
        errorClass: failure.errorClass,
        errorCode: failure.errorCode,
        errorMessage: failure.errorMessage,
      }
    : {
        outcome: "DEAD",
        errorClass: failure.errorClass,
        errorCode: failure.errorCode,
        errorMessage: failure.errorMessage,
      };
}

/**
 * UPDATE_LISTING_CONTENT handler.
 * Read-before-write; never uses productSet; never sends status/inventory/publication.
 */
export async function handleShopifyUpdateListingContentJob(
  claim: ShopifySyncJobClaim,
  deps: { fetchImpl?: ShopifyFetch; now?: Date } = {}
): Promise<ShopifyJobHandlerResult> {
  const payload = parseUpdatePayload(claim.payload);
  if (!payload) {
    return {
      outcome: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: "INVALID_PAYLOAD",
      errorMessage: "UPDATE_LISTING_CONTENT payload is invalid",
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

  const listing = await prisma.shopifyListingLink.findUnique({
    where: {
      shopifyConnectionId_storeItemId: {
        shopifyConnectionId: connection.id,
        storeItemId: payload.storeItemId,
      },
    },
  });
  if (!listing) {
    return {
      outcome: "DEAD",
      errorClass: "UNMAPPED",
      errorCode: "UNMAPPED",
      errorMessage: "Store item is not mapped on this Shopify connection generation",
    };
  }

  const variantMaps = await prisma.shopifyVariantMap.findMany({
    where: { shopifyListingLinkId: listing.id, shopifyConnectionId: connection.id },
    orderBy: { createdAt: "asc" },
  });
  if (variantMaps.length !== 1 || variantMaps[0].storeVariantId !== payload.storeVariantId) {
    return {
      outcome: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: "UNSUPPORTED_VARIANTS",
      errorMessage: "Mapped listing no longer has exactly one matching variant",
    };
  }
  const variantMap = variantMaps[0];

  const applyProduct =
    payload.productDesiredVersion === listing.desiredProductContentVersion &&
    payload.productDesiredVersion > listing.appliedProductContentVersion;
  const applyVariant =
    payload.variantDesiredVersion === variantMap.desiredVariantContentVersion &&
    payload.variantDesiredVersion > variantMap.appliedVariantContentVersion;

  // Fully superseded or already applied for both groups.
  if (
    (payload.productDesiredVersion < listing.desiredProductContentVersion ||
      payload.productDesiredVersion <= listing.appliedProductContentVersion) &&
    (payload.variantDesiredVersion < variantMap.desiredVariantContentVersion ||
      payload.variantDesiredVersion <= variantMap.appliedVariantContentVersion)
  ) {
    return { outcome: "SUCCESS" };
  }
  if (!applyProduct && !applyVariant) {
    return { outcome: "SUCCESS" };
  }

  const storeItem = await prisma.storeItem.findFirst({
    where: { id: payload.storeItemId, memberId: connection.memberId },
  });
  const storeVariant = await prisma.storeVariant.findFirst({
    where: {
      id: payload.storeVariantId,
      storeItemId: payload.storeItemId,
      memberId: connection.memberId,
    },
  });
  if (!storeItem || !storeVariant) {
    return {
      outcome: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: "STORE_ITEM_UNAVAILABLE",
      errorMessage: "Store item/variant unavailable for Shopify content update",
    };
  }

  const desiredProductFp = shopifyProductContentFingerprint({
    title: storeItem.title,
    description: storeItem.description,
  });
  const desiredVariantFp = shopifyVariantContentFingerprint({
    priceCents: storeVariant.priceCents,
    sku: storeVariant.sku,
  });

  if (
    applyProduct &&
    listing.desiredProductFingerprint &&
    listing.desiredProductFingerprint !== desiredProductFp
  ) {
    return {
      outcome: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: "PRODUCT_DESIRE_MISMATCH",
      errorMessage: "Canonical product content does not match recorded desired fingerprint",
    };
  }
  if (
    applyVariant &&
    variantMap.desiredVariantFingerprint &&
    variantMap.desiredVariantFingerprint !== desiredVariantFp
  ) {
    return {
      outcome: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: "VARIANT_DESIRE_MISMATCH",
      errorMessage: "Canonical variant content does not match recorded desired fingerprint",
    };
  }

  const remote = await readMappedListingContent({
    connectionId: connection.id,
    productId: listing.shopifyProductId,
    variantId: variantMap.shopifyVariantId,
    fetchImpl: deps.fetchImpl,
    now: deps.now,
  });
  if (!remote.ok) return failureResult(remote);

  if (remote.product.id !== listing.shopifyProductId) {
    return {
      outcome: "DEAD",
      errorClass: "MAPPING_CONFLICT",
      errorCode: "PRODUCT_GID_MISMATCH",
      errorMessage: "Remote product identity does not match mapping",
    };
  }
  if (String(remote.product.status).toUpperCase() !== "DRAFT") {
    return {
      outcome: "DEAD",
      errorClass: "RECOVERY_CONFLICT",
      errorCode: "PRODUCT_NOT_DRAFT",
      errorMessage: "Mapped Shopify product is not DRAFT; refusing content update",
    };
  }

  const remoteProductFp = shopifyProductContentFingerprint({
    title: remote.product.title,
    description: remote.product.descriptionHtml,
  });
  const remotePriceCents = shopifyPriceStringToCents(remote.product.variant.price);
  if (!Number.isFinite(remotePriceCents)) {
    return {
      outcome: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: "REMOTE_PRICE_INVALID",
      errorMessage: "Remote Shopify variant price could not be parsed",
    };
  }
  const remoteVariantFp = shopifyVariantContentFingerprint({
    priceCents: remotePriceCents,
    sku: remote.product.variant.sku,
  });

  let pendingRetry: HandlerFailure | null = null;
  let pendingDead: HandlerFailure | null = null;

  if (applyProduct) {
    if (listing.productContentConflict) {
      // Unresolved dual-divergence: do not overwrite remote.
      // Terminal success — conflict owns the unresolved state (no infinite RETRY).
    } else {
      const productClass = classifyShopifyContentSemantics({
        base: listing.appliedProductFingerprint,
        local: desiredProductFp,
        remote: remoteProductFp,
        hasLocalSemanticEdit:
          listing.desiredProductContentVersion > 0 || listing.productDesiredAt != null,
      });
      if (productClass === "CONVERGED" || productClass === "UNCHANGED") {
        await markShopifyProductContentApplied(prisma, {
          listingLinkId: listing.id,
          desiredVersion: payload.productDesiredVersion,
          fingerprint: desiredProductFp,
          now: deps.now,
        });
      } else if (productClass === "LOCAL_ONLY") {
        const updated = await productUpdateScalars({
          connectionId: connection.id,
          productId: listing.shopifyProductId,
          title: storeItem.title,
          descriptionHtml: storeItem.description,
          fetchImpl: deps.fetchImpl,
          now: deps.now,
        });
        if (!updated.ok) {
          if (updated.outcome === "RETRY") pendingRetry = updated;
          else pendingDead = updated;
        } else {
          await markShopifyProductContentApplied(prisma, {
            listingLinkId: listing.id,
            desiredVersion: payload.productDesiredVersion,
            fingerprint: desiredProductFp,
            now: deps.now,
          });
        }
      } else if (productClass === "REMOTE_ONLY") {
        // Leave canonical application to S6; do not overwrite remote.
      } else {
        // CONFLICT — persist and skip mutation.
        await setShopifyProductContentConflict(prisma, {
          listingLinkId: listing.id,
          remoteFingerprint: remoteProductFp,
          now: deps.now,
        });
      }
    }
  }

  if (applyVariant) {
    if (variantMap.variantContentConflict) {
      // Unresolved dual-divergence: do not overwrite remote.
    } else {
      const variantClass = classifyShopifyContentSemantics({
        base: variantMap.appliedVariantFingerprint,
        local: desiredVariantFp,
        remote: remoteVariantFp,
        hasLocalSemanticEdit:
          variantMap.desiredVariantContentVersion > 0 || variantMap.variantDesiredAt != null,
      });
      if (variantClass === "CONVERGED" || variantClass === "UNCHANGED") {
        await markShopifyVariantContentApplied(prisma, {
          variantMapId: variantMap.id,
          desiredVersion: payload.variantDesiredVersion,
          fingerprint: desiredVariantFp,
          now: deps.now,
        });
      } else if (variantClass === "LOCAL_ONLY") {
        const updated = await variantBulkUpdateScalars({
          connectionId: connection.id,
          productId: listing.shopifyProductId,
          variantId: variantMap.shopifyVariantId,
          price: shopifyMoneyFromCents(storeVariant.priceCents),
          sku: storeVariant.sku ?? "",
          fetchImpl: deps.fetchImpl,
          now: deps.now,
        });
        if (!updated.ok) {
          if (updated.outcome === "RETRY") pendingRetry = pendingRetry ?? updated;
          else pendingDead = pendingDead ?? updated;
        } else {
          await markShopifyVariantContentApplied(prisma, {
            variantMapId: variantMap.id,
            desiredVersion: payload.variantDesiredVersion,
            fingerprint: desiredVariantFp,
            now: deps.now,
          });
        }
      } else if (variantClass === "REMOTE_ONLY") {
        // Leave to S6.
      } else {
        await setShopifyVariantContentConflict(prisma, {
          variantMapId: variantMap.id,
          remoteFingerprint: remoteVariantFp,
          now: deps.now,
        });
      }
    }
  }

  if (pendingRetry) return failureResult(pendingRetry);
  if (pendingDead) return failureResult(pendingDead);
  return { outcome: "SUCCESS" };
}
