import {
  markShopifyProductContentApplied,
  markShopifyVariantContentApplied,
  markShopifyFieldsApplied,
  loadShopifyFieldStates,
  persistShopifyFieldPlans,
  planShopifyOutboundContentFields,
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
import {
  syncShopifyListingMedia,
  syncShopifyVariantMediaAssociations,
} from "./sync-listing-media";

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
        variants(first: 100) {
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
  /** Omit to leave remote title untouched (field-level push). */
  title?: string;
  /** Omit to leave remote description untouched (field-level push). */
  descriptionHtml?: string | null;
  fetchImpl?: ShopifyFetch;
  now?: Date;
}): Promise<{ ok: true } | ({ ok: false } & HandlerFailure)> {
  const product: Record<string, unknown> = { id: input.productId };
  if (input.title !== undefined) product.title = input.title;
  if (input.descriptionHtml !== undefined) {
    product.descriptionHtml = input.descriptionHtml ?? "";
  }
  // Admin API 2026-07: productUpdate.userErrors is generic UserError (field+message only).
  // Do NOT select `code` — that field exists on specialized error types, not UserError.
  const result = await executeShopifyAdminGraphql<{
    productUpdate: {
      product: { id: string } | null;
      userErrors: Array<{ field?: string[] | null; message: string }>;
    };
  }>({
    connectionId: input.connectionId,
    operationType: "mutation",
    operationName: "ShopifyListingContentProductUpdate",
    document: `mutation ShopifyListingContentProductUpdate($product: ProductUpdateInput!) {
      productUpdate(product: $product) {
        product { id title descriptionHtml status }
        userErrors { field message }
      }
    }`,
    variables: { product },
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
      errorCode: "PRODUCT_UPDATE_USER_ERROR",
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
  /** Omit to leave remote price untouched (field-level push). */
  price?: string;
  /** Omit to leave remote SKU untouched (field-level push). */
  sku?: string;
  fetchImpl?: ShopifyFetch;
  now?: Date;
}): Promise<{ ok: true } | ({ ok: false } & HandlerFailure)> {
  const variant: Record<string, unknown> = { id: input.variantId };
  if (input.price !== undefined) variant.price = input.price;
  if (input.sku !== undefined) {
    // 2026-07: SKU lives on InventoryItemInput, not ProductVariantsBulkInput root.
    variant.inventoryItem = { sku: input.sku ? input.sku : null };
  }
  const result = await executeShopifyAdminGraphql<{
    productVariantsBulkUpdate: {
      productVariants: Array<{ id: string }> | null;
      userErrors: Array<{ field?: string[] | null; message: string; code?: string | null }>;
    };
  }>({
    connectionId: input.connectionId,
    operationType: "mutation",
    operationName: "ShopifyListingContentVariantUpdate",
    document: `mutation ShopifyListingContentVariantUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!, $allowPartialUpdates: Boolean) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants, allowPartialUpdates: $allowPartialUpdates) {
        productVariants { id price sku }
        userErrors { field message code }
      }
    }`,
    variables: {
      productId: input.productId,
      variants: [variant],
      // Fail as a unit — partial success would desync canonical/provider representation.
      allowPartialUpdates: false,
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

  // Listing-scoped content pause (S9). Inventory/orders remain independent.
  if (listing.contentHealth === "PAUSED") {
    return { outcome: "SUCCESS" };
  }

  const variantMaps = await prisma.shopifyVariantMap.findMany({
    where: { shopifyListingLinkId: listing.id, shopifyConnectionId: connection.id },
    orderBy: { createdAt: "asc" },
  });
  const variantMap =
    variantMaps.find((row) => row.storeVariantId === payload.storeVariantId) ?? null;
  if (!variantMap) {
    return {
      outcome: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: "UNSUPPORTED_VARIANTS",
      errorMessage: "Mapped listing has no variant map matching the job payload",
    };
  }

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
    // Must match recordShopifyListingContentDesire / mapping seed inputs.
    photos: storeItem.photos,
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
  const remoteStatus = String(remote.product.status).toUpperCase();
  if (remoteStatus !== "ACTIVE" && remoteStatus !== "DRAFT") {
    return {
      outcome: "DEAD",
      errorClass: "RECOVERY_CONFLICT",
      errorCode: "PRODUCT_BAD_STATUS",
      errorMessage: `Mapped Shopify product status is ${remoteStatus}; refusing content update`,
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

  const fieldStates = await loadShopifyFieldStates(prisma, listing.id);
  const byKey = new Map(fieldStates.map((s) => [`${s.fieldKey}:${s.storeVariantId}`, s]));
  const hasFieldBases = ["TITLE", "DESCRIPTION", "PRICE", "SKU"].every((key) => {
    const variantId = key === "PRICE" || key === "SKU" ? variantMap.storeVariantId : "";
    return byKey.has(`${key}:${variantId}`);
  });

  let pendingRetry: HandlerFailure | null = null;
  let pendingDead: HandlerFailure | null = null;

  if (hasFieldBases) {
    // Adaptive field-level push: only mutate LOCAL_ONLY fields.
    const fieldPlan = planShopifyOutboundContentFields({
      title: {
        base: byKey.get("TITLE:")?.baseFingerprint ?? null,
        local: storeItem.title,
        remote: remote.product.title,
        hasLocalSemanticEdit:
          listing.desiredProductContentVersion > 0 || listing.productDesiredAt != null,
      },
      description: {
        base: byKey.get("DESCRIPTION:")?.baseFingerprint ?? null,
        local: storeItem.description,
        remote: remote.product.descriptionHtml,
        hasLocalSemanticEdit:
          listing.desiredProductContentVersion > 0 || listing.productDesiredAt != null,
      },
      price: {
        storeVariantId: variantMap.storeVariantId,
        base: byKey.get(`PRICE:${variantMap.storeVariantId}`)?.baseFingerprint ?? null,
        localCents: storeVariant.priceCents,
        remoteCents: remotePriceCents,
        hasLocalSemanticEdit:
          variantMap.desiredVariantContentVersion > 0 || variantMap.variantDesiredAt != null,
      },
      sku: {
        storeVariantId: variantMap.storeVariantId,
        base: byKey.get(`SKU:${variantMap.storeVariantId}`)?.baseFingerprint ?? null,
        local: storeVariant.sku,
        remote: remote.product.variant.sku,
        hasLocalSemanticEdit:
          variantMap.desiredVariantContentVersion > 0 || variantMap.variantDesiredAt != null,
      },
    });

    await persistShopifyFieldPlans(prisma, {
      connectionId: connection.id,
      listingLinkId: listing.id,
      memberId: connection.memberId,
      storeItemId: payload.storeItemId,
      plans: fieldPlan.plans,
      now: deps.now,
    });

    if (applyProduct && !listing.productContentConflict) {
      if (fieldPlan.productConflict) {
        await setShopifyProductContentConflict(prisma, {
          listingLinkId: listing.id,
          remoteFingerprint: remoteProductFp,
          now: deps.now,
        });
      } else if (fieldPlan.productConverged) {
        await markShopifyProductContentApplied(prisma, {
          listingLinkId: listing.id,
          desiredVersion: payload.productDesiredVersion,
          fingerprint: desiredProductFp,
          now: deps.now,
        });
        await markShopifyFieldsApplied(prisma, {
          listingLinkId: listing.id,
          fields: fieldPlan.plans
            .filter((p) => p.field === "TITLE" || p.field === "DESCRIPTION")
            .map((p) => ({
              field: p.field as "TITLE" | "DESCRIPTION",
              fingerprint: p.local,
            })),
        });
      } else if (fieldPlan.needsProductMutation) {
        const updated = await productUpdateScalars({
          connectionId: connection.id,
          productId: listing.shopifyProductId,
          ...(fieldPlan.pushTitle ? { title: storeItem.title } : {}),
          ...(fieldPlan.pushDescription
            ? { descriptionHtml: storeItem.description }
            : {}),
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
          const applied = fieldPlan.plans
            .filter(
              (p) =>
                (p.field === "TITLE" && fieldPlan.pushTitle) ||
                (p.field === "DESCRIPTION" && fieldPlan.pushDescription) ||
                ((p.field === "TITLE" || p.field === "DESCRIPTION") &&
                  (p.action === "CONVERGED" || p.action === "UNCHANGED"))
            )
            .map((p) => ({
              field: p.field as "TITLE" | "DESCRIPTION",
              fingerprint: p.local,
            }));
          if (applied.length > 0) {
            await markShopifyFieldsApplied(prisma, {
              listingLinkId: listing.id,
              fields: applied,
            });
          }
        }
      }
      // REMOTE_ONLY product fields: leave to S6 inbound.
    }

    if (applyVariant && !variantMap.variantContentConflict) {
      if (fieldPlan.variantConflict) {
        await setShopifyVariantContentConflict(prisma, {
          variantMapId: variantMap.id,
          remoteFingerprint: remoteVariantFp,
          now: deps.now,
        });
      } else if (fieldPlan.variantConverged) {
        await markShopifyVariantContentApplied(prisma, {
          variantMapId: variantMap.id,
          desiredVersion: payload.variantDesiredVersion,
          fingerprint: desiredVariantFp,
          now: deps.now,
        });
        await markShopifyFieldsApplied(prisma, {
          listingLinkId: listing.id,
          fields: fieldPlan.plans
            .filter((p) => p.field === "PRICE" || p.field === "SKU")
            .map((p) => ({
              field: p.field as "PRICE" | "SKU",
              storeVariantId: variantMap.storeVariantId,
              fingerprint: p.local,
            })),
        });
      } else if (fieldPlan.needsVariantMutation) {
        const updated = await variantBulkUpdateScalars({
          connectionId: connection.id,
          productId: listing.shopifyProductId,
          variantId: variantMap.shopifyVariantId,
          ...(fieldPlan.pushPrice
            ? { price: shopifyMoneyFromCents(storeVariant.priceCents) }
            : {}),
          ...(fieldPlan.pushSku ? { sku: storeVariant.sku ?? "" } : {}),
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
          const applied = fieldPlan.plans
            .filter(
              (p) =>
                (p.field === "PRICE" && fieldPlan.pushPrice) ||
                (p.field === "SKU" && fieldPlan.pushSku) ||
                ((p.field === "PRICE" || p.field === "SKU") &&
                  (p.action === "CONVERGED" || p.action === "UNCHANGED"))
            )
            .map((p) => ({
              field: p.field as "PRICE" | "SKU",
              storeVariantId: variantMap.storeVariantId,
              fingerprint: p.local,
            }));
          if (applied.length > 0) {
            await markShopifyFieldsApplied(prisma, {
              listingLinkId: listing.id,
              fields: applied,
            });
          }
        }
      }
    }
  } else {
    // Legacy group-level path until field BASE rows are seeded.
    if (applyProduct) {
      if (listing.productContentConflict) {
        // Unresolved dual-divergence: do not overwrite remote.
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
  }

  // Push sibling mapped variants that are still dirty (matrix price/SKU edits).
  if (!pendingRetry && !pendingDead) {
    const dirtySiblings = (
      await prisma.shopifyVariantMap.findMany({
        where: {
          shopifyListingLinkId: listing.id,
          shopifyConnectionId: connection.id,
          NOT: { id: variantMap.id },
        },
      })
    ).filter(
      (m) =>
        m.id !== variantMap.id &&
        m.desiredVariantContentVersion > m.appliedVariantContentVersion &&
        !m.variantContentConflict
    );

    for (const sib of dirtySiblings) {
      const sibVariant = await prisma.storeVariant.findFirst({
        where: {
          id: sib.storeVariantId,
          storeItemId: payload.storeItemId,
          memberId: connection.memberId,
        },
      });
      if (!sibVariant) continue;
      const sibFp = shopifyVariantContentFingerprint({
        priceCents: sibVariant.priceCents,
        sku: sibVariant.sku,
      });
      if (sib.desiredVariantFingerprint && sib.desiredVariantFingerprint !== sibFp) {
        pendingDead = {
          outcome: "DEAD",
          errorClass: "GRAPHQL_PERMANENT",
          errorCode: "VARIANT_DESIRE_MISMATCH",
          errorMessage: `Sibling variant ${sib.storeVariantId} desire fingerprint mismatch`,
        };
        break;
      }
      const updated = await variantBulkUpdateScalars({
        connectionId: connection.id,
        productId: listing.shopifyProductId,
        variantId: sib.shopifyVariantId,
        price: shopifyMoneyFromCents(sibVariant.priceCents),
        sku: sibVariant.sku ?? "",
        fetchImpl: deps.fetchImpl,
        now: deps.now,
      });
      if (!updated.ok) {
        if (updated.outcome === "RETRY") pendingRetry = updated;
        else pendingDead = updated;
        break;
      }
      await markShopifyVariantContentApplied(prisma, {
        variantMapId: sib.id,
        desiredVersion: sib.desiredVariantContentVersion,
        fingerprint: sibFp,
        now: deps.now,
      });
    }
  }

  // Adaptive media push (durable map). Never uses productSet media replace.
  if (applyProduct && !listing.productContentConflict && !pendingRetry && !pendingDead) {
    const mediaSync = await syncShopifyListingMedia({
      connectionId: connection.id,
      listingLinkId: listing.id,
      memberId: connection.memberId,
      storeItemId: payload.storeItemId,
      productId: listing.shopifyProductId,
      photos: storeItem.photos,
      fetchImpl: deps.fetchImpl,
      now: deps.now,
    });
    if (!mediaSync.ok) {
      if (mediaSync.outcome === "RETRY") pendingRetry = mediaSync;
      else pendingDead = mediaSync;
    } else {
      const variantMedia = await syncShopifyVariantMediaAssociations({
        connectionId: connection.id,
        listingLinkId: listing.id,
        productId: listing.shopifyProductId,
        fetchImpl: deps.fetchImpl,
        now: deps.now,
      });
      if (!variantMedia.ok) {
        if (variantMedia.outcome === "RETRY") pendingRetry = variantMedia;
        else pendingDead = variantMedia;
      }
    }
  }

  if (pendingRetry) return failureResult(pendingRetry);
  if (pendingDead) return failureResult(pendingDead);
  return { outcome: "SUCCESS" };
}
