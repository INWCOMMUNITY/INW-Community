import {
  applyShopifyInventoryLevelObservation,
  applyShopifyProductsUpdateObservation,
  assertShopifyProductGid,
  markShopifyEvidenceError,
  markShopifyEvidenceIgnored,
  prisma,
  ShopifyGidValidationError,
} from "database";
import type { ShopifyJobHandlerResult, ShopifySyncJobClaim } from "database";
import type { ShopifyFetch } from "./admin-graphql";
import { executeShopifyAdminGraphql } from "./admin-graphql";
import { handleShopifyOrdersPaidEvidence } from "./process-orders-paid";
import {
  drainEtsySyncJobs,
  handleShopifyInventoryLevelsEvidence,
} from "./process-inventory-levels";
import { syncShopifyListingTopology } from "./sync-listing-topology";

function shopifyLocationNumeric(value: string): string {
  return value.split("/").pop()?.split("?")[0] ?? "";
}

function nonNegativeInt(value: number | null | undefined): number | null {
  return Number.isInteger(value) && (value ?? 0) >= 0 ? (value as number) : null;
}

/** Primary location, then the same numeric id, then the only level, then online qty. */
function shopifyAvailableForPrimary(
  levels: Array<{ locationId: string; available: number | null }>,
  primaryLocationId: string,
  sellableOnline: number | null
): number | null {
  const primaryNumeric = shopifyLocationNumeric(primaryLocationId);
  const primary = levels.find(
    (entry) =>
      entry.locationId === primaryLocationId ||
      (primaryNumeric.length > 0 && shopifyLocationNumeric(entry.locationId) === primaryNumeric)
  );
  const fromPrimary = nonNegativeInt(primary?.available);
  if (fromPrimary != null) return fromPrimary;
  const usable = levels
    .map((entry) => nonNegativeInt(entry.available))
    .filter((value): value is number => value != null);
  if (usable.length === 1) return usable[0]!;
  if (usable.length === 0) return nonNegativeInt(sellableOnline);
  return null;
}

function parseProductGidFromEvidenceBody(rawBody: string): string | null {
  try {
    const parsed = JSON.parse(rawBody) as { admin_graphql_api_id?: unknown; id?: unknown };
    if (typeof parsed.admin_graphql_api_id === "string" && parsed.admin_graphql_api_id.trim()) {
      return assertShopifyProductGid(parsed.admin_graphql_api_id.trim());
    }
    if (typeof parsed.id === "number" && Number.isFinite(parsed.id) && parsed.id > 0) {
      return assertShopifyProductGid(`gid://shopify/Product/${Math.trunc(parsed.id)}`);
    }
    if (typeof parsed.id === "string" && /^\d+$/.test(parsed.id.trim())) {
      return assertShopifyProductGid(`gid://shopify/Product/${parsed.id.trim()}`);
    }
  } catch (error) {
    if (error instanceof ShopifyGidValidationError) return null;
  }
  return null;
}

/** Authoritative product re-fetch for inbound content/media (also used by S9 recovery). */
export async function readRemoteProductForInbound(input: {
  connectionId: string;
  productId: string;
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
        updatedAt: Date;
        variants: Array<{
          id: string;
          price: string;
          sku: string | null;
          updatedAt: Date;
          inventoryItemId: string | null;
          availableByLocation: Array<{ locationId: string; available: number | null }>;
          sellableOnline: number | null;
          mediaIds: string[];
        }>;
        media: Array<{
          shopifyMediaId: string;
          sourceUrl: string | null;
          position: number;
          altText: string | null;
        }>;
      };
    }
  | {
      ok: false;
      outcome: "RETRY" | "DEAD";
      errorClass: string;
      errorCode: string;
      errorMessage: string;
      missing?: boolean;
    }
> {
  const result = await executeShopifyAdminGraphql<{
    product: {
      id: string;
      status: string;
      title: string;
      descriptionHtml: string | null;
      updatedAt: string;
      variants: {
        nodes: Array<{
          id: string;
          price: string;
          sku: string | null;
          updatedAt: string;
          sellableOnlineQuantity?: number | null;
          inventoryItem: {
            id: string;
            inventoryLevels?: {
              nodes: Array<{
                location: { id: string } | null;
                quantities: Array<{ quantity: number | null }>;
              }>;
            } | null;
          } | null;
          media?: { nodes: Array<{ id: string }> } | null;
        }>;
      };
      media: {
        nodes: Array<{
          id: string;
          alt: string | null;
          preview?: { image?: { url: string | null } | null } | null;
        }>;
      };
    } | null;
  }>({
    connectionId: input.connectionId,
    operationType: "query",
    operationName: "ShopifyInboundListingContentRead",
    document: `query ShopifyInboundListingContentRead($id: ID!) {
      product(id: $id) {
        id
        status
        title
        descriptionHtml
        updatedAt
        variants(first: 100) {
          nodes {
            id
            price
            sku
            updatedAt
            sellableOnlineQuantity
            inventoryItem {
              id
              inventoryLevels(first: 10) {
                nodes {
                  location { id }
                  quantities(names: ["available"]) { quantity }
                }
              }
            }
            media(first: 10) { nodes { id } }
          }
        }
        media(first: 50) {
          nodes {
            id
            alt
            preview { image { url } }
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
        outcome: "RETRY",
        errorClass: result.class,
        errorCode: "INBOUND_CONTENT_READ",
        errorMessage: result.message,
      };
    }
    return {
      ok: false,
      outcome: "DEAD",
      errorClass: result.class,
      errorCode: "INBOUND_CONTENT_READ",
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
      missing: true,
    };
  }

  const updatedAt = new Date(product.updatedAt);
  if (Number.isNaN(updatedAt.getTime())) {
    return {
      ok: false,
      outcome: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: "REMOTE_UPDATED_AT_INVALID",
      errorMessage: "Remote product updatedAt was invalid",
    };
  }

  const variants = (product.variants?.nodes ?? []).map((row) => {
    const variantUpdatedAt = new Date(row.updatedAt);
    return {
      id: row.id,
      price: row.price,
      sku: row.sku,
      updatedAt: Number.isNaN(variantUpdatedAt.getTime()) ? updatedAt : variantUpdatedAt,
      inventoryItemId: row.inventoryItem?.id ?? null,
      availableByLocation: (row.inventoryItem?.inventoryLevels?.nodes ?? []).map((level) => ({
        locationId: level.location?.id ?? "",
        available: level.quantities?.[0]?.quantity ?? null,
      })),
      sellableOnline:
        typeof row.sellableOnlineQuantity === "number" && Number.isInteger(row.sellableOnlineQuantity)
          ? row.sellableOnlineQuantity
          : null,
      mediaIds: (row.media?.nodes ?? []).map((m) => m.id).filter(Boolean),
    };
  });
  const media = (product.media?.nodes ?? []).map((row, index) => ({
    shopifyMediaId: row.id,
    sourceUrl: row.preview?.image?.url ?? null,
    position: index,
    altText: row.alt,
  }));

  return {
    ok: true,
    product: {
      id: product.id,
      status: product.status,
      title: product.title,
      descriptionHtml: product.descriptionHtml,
      updatedAt,
      variants,
      media,
    },
  };
}

/**
 * PROCESS_PROVIDER_EVIDENCE handler for products/update (S6).
 * Webhook body is identity only; current remote state is re-read via Admin GraphQL.
 */
export async function handleShopifyProcessProviderEvidenceJob(
  claim: ShopifySyncJobClaim,
  deps: { fetchImpl?: ShopifyFetch; now?: Date } = {}
): Promise<ShopifyJobHandlerResult> {
  if (!claim.evidenceId) {
    return {
      outcome: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: "MISSING_EVIDENCE",
      errorMessage: "Evidence id missing on job",
    };
  }

  const evidence = await prisma.shopifyProviderEvidence.findUnique({
    where: { id: claim.evidenceId },
  });
  if (!evidence) {
    return {
      outcome: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: "EVIDENCE_NOT_FOUND",
      errorMessage: "Provider evidence was not found",
    };
  }
  if (evidence.shopifyConnectionId !== claim.shopifyConnectionId) {
    return {
      outcome: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: "GENERATION_MISMATCH",
      errorMessage: "Evidence connection does not match job connection",
    };
  }

  if (
    evidence.processState === "PROCESSED" ||
    evidence.processState === "IGNORED" ||
    evidence.processState === "ERROR"
  ) {
    return { outcome: "SUCCESS" };
  }

  const topic = evidence.topic.trim().toLowerCase();
  if (topic === "orders/paid") {
    return handleShopifyOrdersPaidEvidence(claim, evidence, deps);
  }
  if (topic === "inventory_levels/update") {
    return handleShopifyInventoryLevelsEvidence(claim, evidence, deps);
  }
  if (topic !== "products/update") {
    // Other topics remain deferred until their owned processors exist.
    return { outcome: "SUCCESS" };
  }

  const connection = await prisma.shopifyConnection.findUnique({
    where: { id: claim.shopifyConnectionId },
  });
  if (!connection || connection.status !== "ACTIVE") {
    await markShopifyEvidenceIgnored(
      prisma,
      evidence.id,
      "CONNECTION_INACTIVE",
      "Evidence generation is not an active Shopify connection"
    );
    return { outcome: "SUCCESS" };
  }

  const productGid = parseProductGidFromEvidenceBody(evidence.rawBody);
  if (!productGid) {
    await markShopifyEvidenceError(
      prisma,
      evidence.id,
      "INVALID_PRODUCT_GID",
      "products/update evidence lacked a valid Product GID"
    );
    return { outcome: "SUCCESS" };
  }

  const listing = await prisma.shopifyListingLink.findUnique({
    where: {
      shopifyConnectionId_shopifyProductId: {
        shopifyConnectionId: connection.id,
        shopifyProductId: productGid,
      },
    },
  });
  if (!listing) {
    await markShopifyEvidenceIgnored(
      prisma,
      evidence.id,
      "UNMAPPED",
      "No current-generation mapping for this Shopify product"
    );
    return { outcome: "SUCCESS" };
  }

  let variantMaps = await prisma.shopifyVariantMap.findMany({
    where: { shopifyListingLinkId: listing.id, shopifyConnectionId: connection.id },
    orderBy: { createdAt: "asc" },
  });
  if (variantMaps.length < 1) {
    await markShopifyEvidenceError(
      prisma,
      evidence.id,
      "UNSUPPORTED_VARIANTS",
      "Mapped listing has no StoreVariant mappings"
    );
    return { outcome: "SUCCESS" };
  }
  // Apply product + first mapped variant content; additional mapped variants are
  // reconciled via S9 / subsequent evidence. Media inbound runs with product fields.
  let variantMap = variantMaps[0];

  const remote = await readRemoteProductForInbound({
    connectionId: connection.id,
    productId: listing.shopifyProductId,
    fetchImpl: deps.fetchImpl,
    now: deps.now,
  });
  if (!remote.ok) {
    if (remote.missing) {
      await markShopifyEvidenceError(prisma, evidence.id, remote.errorCode, remote.errorMessage);
      return { outcome: "SUCCESS" };
    }
    if (remote.outcome === "RETRY") {
      return {
        outcome: "RETRY",
        errorClass: remote.errorClass,
        errorCode: remote.errorCode,
        errorMessage: remote.errorMessage,
      };
    }
    await markShopifyEvidenceError(prisma, evidence.id, remote.errorCode, remote.errorMessage);
    return { outcome: "SUCCESS" };
  }

  if (remote.product.id !== listing.shopifyProductId) {
    await markShopifyEvidenceError(
      prisma,
      evidence.id,
      "PRODUCT_GID_MISMATCH",
      "Remote product identity does not match mapping"
    );
    return { outcome: "SUCCESS" };
  }

  // Pull Shopify→INW variant topology on every products/update (NOOP when unchanged).
  // Covers new GIDs, retired maps, and same-GID option conversions (Title→Size, renames).
  {
    // ACTIVE only — a replaced Shopify GID must not be planned as a new outbound create.
    // Maps still pointing at retired rows are removedVariants and get deleted on Shopify.
    const allStoreVariants = await prisma.storeVariant.findMany({
      where: {
        storeItemId: listing.storeItemId,
        memberId: listing.memberId,
        status: "ACTIVE",
      },
      select: { id: true, options: true, priceCents: true, sku: true },
    });
    const mapByStoreVariant = new Map(
      variantMaps.map((m) => [m.storeVariantId, m.shopifyVariantId] as const)
    );
    const localTopology = allStoreVariants.map((sv) => {
      const optsJson =
        typeof sv.options === "string"
          ? (JSON.parse(sv.options) as Record<string, string>)
          : ((sv.options ?? {}) as Record<string, string>);
      return {
        storeVariantId: sv.id,
        selectedOptions: Object.entries(optsJson).map(([name, value]) => ({
          name,
          value: String(value),
        })),
        priceCents: sv.priceCents,
        sku: sv.sku,
        shopifyVariantId: mapByStoreVariant.get(sv.id) ?? null,
      };
    });
    const activeIds = new Set(allStoreVariants.map((sv) => sv.id));
    const removedVariants = variantMaps
      .filter((map) => !activeIds.has(map.storeVariantId))
      .map((map) => ({
        storeVariantId: map.storeVariantId,
        shopifyVariantId: map.shopifyVariantId,
      }));
    const topologySync = await syncShopifyListingTopology({
      connectionId: connection.id,
      memberId: listing.memberId,
      listingLinkId: listing.id,
      productId: listing.shopifyProductId,
      storeItemId: listing.storeItemId,
      localVariants: localTopology,
      removedVariants,
      fetchImpl: deps.fetchImpl,
      now: deps.now,
    });
    if (!topologySync.ok) {
      if (topologySync.outcome === "RETRY") {
        return {
          outcome: "RETRY",
          errorClass: topologySync.errorClass,
          errorCode: topologySync.errorCode,
          errorMessage: topologySync.errorMessage,
        };
      }
      await markShopifyEvidenceError(
        prisma,
        evidence.id,
        topologySync.errorCode,
        topologySync.errorMessage
      );
      return { outcome: "SUCCESS" };
    }
    variantMaps = await prisma.shopifyVariantMap.findMany({
      where: { shopifyListingLinkId: listing.id, shopifyConnectionId: connection.id },
      orderBy: { createdAt: "asc" },
    });
    variantMap = variantMaps[0] ?? variantMap;
  }

  // Prefer the mapped variant present on the remote product (multi-variant safe).
  const activeMap =
    variantMaps.find((map) =>
      remote.product.variants.some((row) => row.id === map.shopifyVariantId)
    ) ?? variantMap;

  const applied = await applyShopifyProductsUpdateObservation(prisma, {
    evidenceId: evidence.id,
    connectionId: connection.id,
    listingLinkId: listing.id,
    mappedVariantId: activeMap.shopifyVariantId,
    mappedStoreVariantId: activeMap.storeVariantId,
    allMappedVariants: variantMaps.map((map) => ({
      shopifyVariantId: map.shopifyVariantId,
      storeVariantId: map.storeVariantId,
    })),
    remote: {
      productId: remote.product.id,
      status: remote.product.status,
      title: remote.product.title,
      descriptionHtml: remote.product.descriptionHtml,
      updatedAt: remote.product.updatedAt,
      variants: remote.product.variants.map((row) => ({
        id: row.id,
        price: row.price,
        sku: row.sku,
        updatedAt: row.updatedAt,
        inventoryItemId: row.inventoryItemId,
        mediaIds: row.mediaIds,
      })),
      media: remote.product.media,
    },
  });

  // PROCESSED / IGNORED / ERROR are terminal evidence outcomes for this delivery.
  void applied;

  // Product edits change qty on the variant, not only via inventory_levels/update.
  // Apply primary-location available into INW (which fans out to Etsy) before we return.
  if (connection.primaryLocationId && applied.status !== "ERROR") {
    let pushedQty = false;
    for (const row of remote.product.variants) {
      const available = shopifyAvailableForPrimary(
        row.availableByLocation,
        connection.primaryLocationId,
        row.sellableOnline
      );
      if (!row.inventoryItemId || available == null) continue;
      const map = variantMaps.find((entry) => entry.shopifyVariantId === row.id);
      const itemNumeric = row.inventoryItemId.split("/").pop()?.split("?")[0] ?? "";
      const pendingOrder = itemNumeric
        ? await prisma.shopifyProviderEvidence.findFirst({
            where: {
              shopifyConnectionId: connection.id,
              topic: "orders/paid",
              processState: "RECEIVED",
              rawBody: { contains: itemNumeric },
            },
            select: { id: true },
          })
        : null;
      const pendingSales = map
        ? await prisma.shopifyOrderLineSaleFact.count({
            where: {
              shopifyConnectionId: connection.id,
              applyState: "PENDING",
              storeVariantId: map.storeVariantId,
            },
          })
        : 0;
      const qtyResult = await applyShopifyInventoryLevelObservation(prisma, {
        connectionId: connection.id,
        memberId: connection.memberId,
        primaryLocationId: connection.primaryLocationId,
        observation: {
          inventoryItemId: row.inventoryItemId,
          locationId: connection.primaryLocationId,
          available,
          evidenceId: `${evidence.id}:qty:${row.id}:${available}`,
        },
        hasPendingOrderEvidence: Boolean(pendingOrder) || pendingSales > 0,
      });
      if (qtyResult.status === "APPLIED_EDIT") pushedQty = true;
    }
    if (pushedQty) await drainEtsySyncJobs("shopify-product-qty");
  }

  return { outcome: "SUCCESS" };
}
