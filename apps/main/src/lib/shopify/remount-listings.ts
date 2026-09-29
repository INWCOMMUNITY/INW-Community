import {
  createShopifyListingMapping,
  ensureShopifyPublishListingJob,
  prisma,
  ShopifyMappingConflictError,
  ShopifyMappingError,
  ShopifySyncJobConflictError,
} from "database";
import type { ShopifyJobHandlerResult, ShopifySyncJobClaim } from "database";
import type { ShopifyFetch } from "./admin-graphql";
import { executeShopifyAdminGraphql } from "./admin-graphql";
import {
  SHOPIFY_LISTING_EXPORT_METAFIELD_KEY,
  SHOPIFY_LISTING_EXPORT_METAFIELD_NAMESPACE,
  shopifyListingExportCustomId,
} from "./listing-export-id";
import { lookupShopifyListingProductByCustomIdValue } from "./listing-product-lookup";

function parseRemountPayload(payload: unknown): {
  connectionId: string;
  memberId: string;
  shopId: string;
} | null {
  if (!payload || typeof payload !== "object") return null;
  const row = payload as Record<string, unknown>;
  const connectionId = typeof row.connectionId === "string" ? row.connectionId : "";
  const memberId = typeof row.memberId === "string" ? row.memberId : "";
  const shopId = typeof row.shopId === "string" ? row.shopId : "";
  if (!connectionId || !memberId || !shopId) return null;
  return { connectionId, memberId, shopId };
}

async function readRemoteProductForRemount(input: {
  connectionId: string;
  shopifyProductId: string;
  fetchImpl?: ShopifyFetch;
  now?: Date;
}): Promise<
  | {
      ok: true;
      product: {
        id: string;
        status: string;
        variants: Array<{ id: string; inventoryItemId: string }>;
      } | null;
    }
  | {
      ok: false;
      class: "RETRY" | "DEAD";
      errorClass: string;
      errorCode: string;
      errorMessage: string;
    }
> {
  const result = await executeShopifyAdminGraphql<{
    product: {
      id: string;
      status: string;
      variants: {
        nodes: Array<{ id: string; inventoryItem: { id: string } | null }>;
      };
    } | null;
  }>({
    connectionId: input.connectionId,
    operationType: "query",
    operationName: "ShopifyRemountProductLookup",
    document: `query ShopifyRemountProductLookup($id: ID!) {
      product(id: $id) {
        id
        status
        variants(first: 100) {
          nodes {
            id
            inventoryItem { id }
          }
        }
      }
    }`,
    variables: { id: input.shopifyProductId },
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
        errorCode: "REMOUNT_PRODUCT_LOOKUP",
        errorMessage: result.message,
      };
    }
    return {
      ok: false,
      class: "DEAD",
      errorClass: result.class,
      errorCode: "REMOUNT_PRODUCT_LOOKUP",
      errorMessage: result.message,
    };
  }

  const product = result.data?.product ?? null;
  if (!product) return { ok: true, product: null };
  const variants = (product.variants?.nodes ?? [])
    .filter((row) => row.inventoryItem?.id)
    .map((row) => ({
      id: row.id,
      inventoryItemId: row.inventoryItem!.id,
    }));
  return {
    ok: true,
    product: {
      id: product.id,
      status: String(product.status).toUpperCase(),
      variants,
    },
  };
}

/**
 * Re-stamp the generation-scoped export customId onto a remounted product so
 * future CREATE_LISTING discovery for this generation finds it (no duplicate productSet).
 */
async function stampRemountExportCustomId(input: {
  connectionId: string;
  storeItemId: string;
  shopifyProductId: string;
  fetchImpl?: ShopifyFetch;
  now?: Date;
}): Promise<
  | { ok: true }
  | {
      ok: false;
      class: "RETRY" | "DEAD";
      errorClass: string;
      errorCode: string;
      errorMessage: string;
    }
> {
  const customId = shopifyListingExportCustomId(input.connectionId, input.storeItemId);
  const result = await executeShopifyAdminGraphql<{
    metafieldsSet: {
      userErrors: Array<{ field?: string[] | null; message: string }>;
    } | null;
  }>({
    connectionId: input.connectionId,
    operationType: "mutation",
    operationName: "ShopifyRemountExportCustomId",
    document: `mutation ShopifyRemountExportCustomId($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        userErrors { field message }
      }
    }`,
    variables: {
      metafields: [
        {
          ownerId: input.shopifyProductId,
          namespace: SHOPIFY_LISTING_EXPORT_METAFIELD_NAMESPACE,
          key: SHOPIFY_LISTING_EXPORT_METAFIELD_KEY,
          type: "single_line_text_field",
          value: customId,
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
        class: "RETRY",
        errorClass: result.class,
        errorCode: result.outcomeUnknown ? "REMOUNT_METAFIELD_UNKNOWN" : "REMOUNT_METAFIELD",
        errorMessage: result.message,
      };
    }
    return {
      ok: false,
      class: "DEAD",
      errorClass: result.class,
      errorCode: "REMOUNT_METAFIELD",
      errorMessage: result.message,
    };
  }

  const userErrors = result.data?.metafieldsSet?.userErrors ?? [];
  if (userErrors.length > 0) {
    return {
      ok: false,
      class: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: "REMOUNT_METAFIELD_USER_ERROR",
      errorMessage: (userErrors[0]?.message ?? "metafieldsSet failed").slice(0, 500),
    };
  }
  return { ok: true };
}

type PriorNativeListing = {
  priorConnectionId: string;
  storeItemId: string;
  shopifyProductId: string;
  variantMaps: Array<{
    storeVariantId: string;
    shopifyVariantId: string;
    shopifyInventoryItemId: string;
  }>;
};

/**
 * REMOUNT_LISTINGS: after reconnect for the same member+shop, adopt prior NATIVE
 * remote products onto the new ACTIVE generation without a second productSet.
 */
export async function handleShopifyRemountListingsJob(
  claim: ShopifySyncJobClaim,
  deps: { fetchImpl?: ShopifyFetch; now?: Date } = {}
): Promise<ShopifyJobHandlerResult> {
  const payload = parseRemountPayload(claim.payload);
  if (!payload || payload.connectionId !== claim.shopifyConnectionId) {
    return {
      outcome: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: "INVALID_PAYLOAD",
      errorMessage: "REMOUNT_LISTINGS payload is invalid",
    };
  }

  const connection = await prisma.shopifyConnection.findUnique({
    where: { id: claim.shopifyConnectionId },
  });
  if (
    !connection ||
    connection.status !== "ACTIVE" ||
    connection.memberId !== payload.memberId ||
    connection.shopId !== payload.shopId
  ) {
    return {
      outcome: "DEAD",
      errorClass: "CONNECTION_INACTIVE",
      errorCode: "CONNECTION_INACTIVE",
      errorMessage: "Shopify connection is not active for remount",
    };
  }

  const priorConnections = await prisma.shopifyConnection.findMany({
    where: {
      memberId: connection.memberId,
      shopId: connection.shopId,
      id: { not: connection.id },
      status: { in: ["DISCONNECTED", "REVOKED"] },
    },
    orderBy: { generation: "desc" },
    select: { id: true, generation: true },
  });
  if (priorConnections.length === 0) {
    return { outcome: "SUCCESS" };
  }

  const priorIds = priorConnections.map((row) => row.id);
  const priorListings = await prisma.shopifyListingLink.findMany({
    where: {
      shopifyConnectionId: { in: priorIds },
      memberId: connection.memberId,
      importSource: "NATIVE",
    },
    include: {
      variantMaps: {
        select: {
          storeVariantId: true,
          shopifyVariantId: true,
          shopifyInventoryItemId: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  const alreadyMapped = await prisma.shopifyListingLink.findMany({
    where: { shopifyConnectionId: connection.id, memberId: connection.memberId },
    select: { storeItemId: true },
  });
  const mappedStoreItems = new Set(alreadyMapped.map((row) => row.storeItemId));

  // Prefer the newest prior mapping per store item.
  const candidates = new Map<string, PriorNativeListing>();
  for (const listing of priorListings) {
    if (mappedStoreItems.has(listing.storeItemId)) continue;
    if (candidates.has(listing.storeItemId)) continue;
    if (listing.variantMaps.length === 0) continue;
    candidates.set(listing.storeItemId, {
      priorConnectionId: listing.shopifyConnectionId,
      storeItemId: listing.storeItemId,
      shopifyProductId: listing.shopifyProductId,
      variantMaps: listing.variantMaps,
    });
  }

  let remounted = 0;
  let skippedMissing = 0;
  const failures: string[] = [];

  for (const candidate of candidates.values()) {
    // Prefer product GID from prior mapping; fall back to prior-generation customId discovery.
    let productId = candidate.shopifyProductId;
    let variantPairs = candidate.variantMaps;

    const remote = await readRemoteProductForRemount({
      connectionId: connection.id,
      shopifyProductId: productId,
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

    if (!remote.product) {
      const priorCustomId = shopifyListingExportCustomId(
        candidate.priorConnectionId,
        candidate.storeItemId
      );
      const discovered = await lookupShopifyListingProductByCustomIdValue({
        connectionId: connection.id,
        customId: priorCustomId,
        fetchImpl: deps.fetchImpl,
        now: deps.now,
      });
      if (!discovered.ok) {
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
      if (!discovered.product) {
        skippedMissing += 1;
        continue;
      }
      productId = discovered.product.productId;
      // Single-variant discovery path used when prior GID vanished.
      if (variantPairs.length === 1) {
        variantPairs = [
          {
            storeVariantId: variantPairs[0]!.storeVariantId,
            shopifyVariantId: discovered.product.variantId,
            shopifyInventoryItemId: discovered.product.inventoryItemId,
          },
        ];
      }
    } else {
      // Align inventory item ids with live remote when available.
      const byVariantId = new Map(remote.product.variants.map((row) => [row.id, row.inventoryItemId]));
      variantPairs = variantPairs.map((row) => ({
        ...row,
        shopifyInventoryItemId:
          byVariantId.get(row.shopifyVariantId) ?? row.shopifyInventoryItemId,
      }));
    }

    const stamped = await stampRemountExportCustomId({
      connectionId: connection.id,
      storeItemId: candidate.storeItemId,
      shopifyProductId: productId,
      fetchImpl: deps.fetchImpl,
      now: deps.now,
    });
    if (!stamped.ok) {
      return stamped.class === "RETRY"
        ? {
            outcome: "RETRY",
            errorClass: stamped.errorClass,
            errorCode: stamped.errorCode,
            errorMessage: stamped.errorMessage,
          }
        : {
            outcome: "DEAD",
            errorClass: stamped.errorClass,
            errorCode: stamped.errorCode,
            errorMessage: stamped.errorMessage,
          };
    }

    try {
      const mapped = await createShopifyListingMapping(prisma, {
        memberId: connection.memberId,
        connectionId: connection.id,
        storeItemId: candidate.storeItemId,
        shopifyProductId: productId,
        variants: variantPairs.map((row) => ({
          storeVariantId: row.storeVariantId,
          shopifyVariantId: row.shopifyVariantId,
          shopifyInventoryItemId: row.shopifyInventoryItemId,
        })),
      });

      try {
        const publishJob = await ensureShopifyPublishListingJob(prisma, {
          connectionId: connection.id,
          storeItemId: candidate.storeItemId,
          listingLinkId: mapped.listingLink.id,
        });
        if (publishJob.state === "DEAD") {
          await prisma.shopifySyncJob.updateMany({
            where: { id: publishJob.id, state: "DEAD" },
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
        }
      } catch (error) {
        if (!(error instanceof ShopifySyncJobConflictError)) throw error;
        failures.push(`${candidate.storeItemId}:publish_conflict`);
      }
      remounted += 1;
      mappedStoreItems.add(candidate.storeItemId);
    } catch (error) {
      if (error instanceof ShopifyMappingConflictError) {
        // Another path already mapped this generation — treat as success for this item.
        mappedStoreItems.add(candidate.storeItemId);
        continue;
      }
      if (error instanceof ShopifyMappingError) {
        failures.push(`${candidate.storeItemId}:${error.code}`);
        continue;
      }
      throw error;
    }
  }

  // Persist remount summary on the job row for Airport connection strip.
  await prisma.shopifySyncJob.update({
    where: { id: claim.id },
    data: {
      lastErrorCode: failures.length > 0 ? "REMOUNT_PARTIAL" : null,
      lastErrorMessage:
        failures.length > 0
          ? `Remounted ${remounted}; missing ${skippedMissing}; failures: ${failures.slice(0, 8).join("; ")}`.slice(
              0,
              1000
            )
          : remounted > 0 || skippedMissing > 0
            ? `Remounted ${remounted}; remote missing ${skippedMissing}`
            : null,
    },
  });

  if (failures.length > 0 && remounted === 0) {
    return {
      outcome: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: "REMOUNT_FAILED",
      errorMessage: failures.slice(0, 5).join("; ").slice(0, 500),
    };
  }

  return { outcome: "SUCCESS" };
}
