import {
  ensureShopifyProjectInventoryJob,
  ensureShopifyUpdateListingContentJob,
  persistShopifyListingHealth,
  classifyShopifyListingHealth,
  prisma,
  shopifyProductContentFingerprint,
  shopifyVariantContentFingerprint,
  shopifyCentsFromMoneyString,
} from "database";
import type { ShopifyJobHandlerResult, ShopifySyncJobClaim } from "database";
import type { ShopifyListingRemoteObservation } from "database";
import type { ShopifyFetch } from "./admin-graphql";
import { executeShopifyAdminGraphql } from "./admin-graphql";
import { notifyShopifyListingIssueOnce } from "./listing-issue-notify";

function parseReconcilePayload(payload: unknown): { listingLinkId: string; storeItemId: string } | null {
  if (!payload || typeof payload !== "object") return null;
  const row = payload as Record<string, unknown>;
  const listingLinkId = typeof row.listingLinkId === "string" ? row.listingLinkId : "";
  const storeItemId = typeof row.storeItemId === "string" ? row.storeItemId : "";
  if (!listingLinkId || !storeItemId) return null;
  return { listingLinkId, storeItemId };
}

async function readRemoteListingObservation(input: {
  connectionId: string;
  productId: string;
  variantId: string;
  inventoryItemId: string;
  locationId: string | null;
  fetchImpl?: ShopifyFetch;
  now?: Date;
}): Promise<
  | { ok: true; remote: ShopifyListingRemoteObservation }
  | {
      ok: false;
      outcome: "RETRY" | "DEAD";
      errorClass: string;
      errorCode: string;
      errorMessage: string;
    }
> {
  if (!input.locationId) {
    // Still read product/variant; inventory location checks happen in classifier.
  }
  const result = await executeShopifyAdminGraphql<{
    product: {
      id: string;
      status: string;
      title: string;
      descriptionHtml: string | null;
      variants: {
        nodes: Array<{
          id: string;
          price: string;
          sku: string | null;
          inventoryItem: { id: string; tracked: boolean } | null;
        }>;
      };
    } | null;
    inventoryItem: {
      id: string;
      tracked: boolean;
      inventoryLevel: {
        id: string;
        quantities: Array<{ name: string; quantity: number }>;
      } | null;
    } | null;
  }>({
    connectionId: input.connectionId,
    operationType: "query",
    operationName: "ShopifyListingReconcileRead",
    document: `query ShopifyListingReconcileRead($productId: ID!, $inventoryItemId: ID!, $locationId: ID!) {
      product(id: $productId) {
        id
        status
        title
        descriptionHtml
        variants(first: 10) {
          nodes {
            id
            price
            sku
            inventoryItem { id tracked }
          }
        }
      }
      inventoryItem(id: $inventoryItemId) {
        id
        tracked
        inventoryLevel(locationId: $locationId) {
          id
          quantities(names: ["available"]) { name quantity }
        }
      }
    }`,
    variables: {
      productId: input.productId,
      inventoryItemId: input.inventoryItemId,
      locationId: input.locationId ?? "gid://shopify/Location/0",
    },
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
        errorCode: "RECONCILE_READ",
        errorMessage: result.message,
      };
    }
    if (result.class === "CONNECTION_INACTIVE" || result.class === "AUTH") {
      return {
        ok: false,
        outcome: "DEAD",
        errorClass: result.class,
        errorCode: "CONNECTION",
        errorMessage: result.message,
      };
    }
    return {
      ok: false,
      outcome: "DEAD",
      errorClass: result.class,
      errorCode: "RECONCILE_READ",
      errorMessage: result.message,
    };
  }

  const product = result.data?.product ?? null;
  const nodes = product?.variants?.nodes ?? [];
  const mapped = nodes.find((row) => row.id === input.variantId) ?? null;
  const inv = result.data?.inventoryItem ?? null;
  const available =
    inv?.inventoryLevel?.quantities?.find((row) => row.name === "available")?.quantity ?? null;

  return {
    ok: true,
    remote: {
      productExists: Boolean(product),
      productStatus: product?.status ?? null,
      variantCount: nodes.length,
      mappedVariantPresent: Boolean(mapped),
      inventoryItemMatches: Boolean(
        mapped?.inventoryItem?.id === input.inventoryItemId || inv?.id === input.inventoryItemId
      ),
      inventoryTracked: inv?.tracked ?? mapped?.inventoryItem?.tracked ?? null,
      inventoryLevelExists: input.locationId ? Boolean(inv?.inventoryLevel) : null,
      remoteAvailable: typeof available === "number" ? available : null,
      remoteProductFingerprint: product
        ? shopifyProductContentFingerprint({
            title: product.title,
            description: product.descriptionHtml,
          })
        : null,
      remoteVariantFingerprint: mapped
        ? shopifyVariantContentFingerprint({
            priceCents: shopifyCentsFromMoneyString(mapped.price),
            sku: mapped.sku,
          })
        : null,
    },
  };
}

/**
 * Observe one current-generation listing, persist health/readiness, notify once per issue signature.
 * Does not create Shopify listings, mutate content/inventory/status, or publish.
 */
export async function handleShopifyReconcileListingJob(
  claim: ShopifySyncJobClaim,
  opts?: { fetchImpl?: ShopifyFetch; now?: Date; notify?: boolean }
): Promise<ShopifyJobHandlerResult> {
  const parsed = parseReconcilePayload(claim.payload);
  if (!parsed) {
    return {
      outcome: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: "INVALID_PAYLOAD",
      errorMessage: "RECONCILE_LISTING payload missing listingLinkId/storeItemId",
    };
  }

  const connection = await prisma.shopifyConnection.findUnique({
    where: { id: claim.shopifyConnectionId },
    select: {
      id: true,
      status: true,
      primaryLocationId: true,
      memberId: true,
    },
  });
  if (!connection || connection.status !== "ACTIVE") {
    return {
      outcome: "DEAD",
      errorClass: "CONNECTION_INACTIVE",
      errorCode: "CONNECTION_INACTIVE",
      errorMessage: "Shopify connection is not ACTIVE; reconcile job is terminal",
    };
  }

  const listing = await prisma.shopifyListingLink.findFirst({
    where: {
      id: parsed.listingLinkId,
      shopifyConnectionId: connection.id,
      storeItemId: parsed.storeItemId,
    },
  });
  if (!listing) {
    return {
      outcome: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: "LISTING_MISSING",
      errorMessage: "Current-generation listing mapping was not found",
    };
  }

  const variantMaps = await prisma.shopifyVariantMap.findMany({
    where: { shopifyListingLinkId: listing.id, shopifyConnectionId: connection.id },
    orderBy: { createdAt: "asc" },
  });
  if (variantMaps.length !== 1) {
    const health = classifyShopifyListingHealth({
      connectionStatus: connection.status,
      primaryLocationId: connection.primaryLocationId,
      listing,
      variantMap: variantMaps[0] ?? {
        desiredVariantContentVersion: 0,
        appliedVariantContentVersion: 0,
        desiredVariantFingerprint: null,
        appliedVariantFingerprint: null,
        variantContentConflict: false,
        inventoryInitState: "PENDING",
        inventoryDesiredVersion: 0,
        inventoryAppliedVersion: 0,
        inventoryDesiredAvailable: null,
        inventoryAppliedAvailable: null,
        inventoryDriftState: "NONE",
      },
      hasCausalSaleConflict: false,
      remote: {
        productExists: true,
        productStatus: listing.remoteProductStatus,
        variantCount: Math.max(2, variantMaps.length),
        mappedVariantPresent: variantMaps.length === 1,
        inventoryItemMatches: false,
        inventoryTracked: null,
        inventoryLevelExists: null,
        remoteAvailable: null,
        remoteProductFingerprint: null,
        remoteVariantFingerprint: null,
      },
    });
    const persisted = await persistShopifyListingHealth(prisma, {
      listingLinkId: listing.id,
      health,
      previous: listing,
      now: opts?.now,
    });
    if ((opts?.notify ?? true) && persisted.issueOpened && health.issueCode && health.issueFingerprint) {
      await notifyShopifyListingIssueOnce({
        memberId: listing.memberId,
        storeItemId: listing.storeItemId,
        connectionId: connection.id,
        listingLinkId: listing.id,
        issueCode: health.issueCode,
        issueFingerprint: health.issueFingerprint,
        severity: health.issueSeverity ?? "ACTION_REQUIRED",
        message: health.issueMessage ?? "Shopify listing needs attention",
      });
    }
    return { outcome: "SUCCESS" };
  }

  const variantMap = variantMaps[0];

  const causalConflict = await prisma.shopifyOrderLineSaleFact.findFirst({
    where: {
      shopifyConnectionId: connection.id,
      storeVariantId: variantMap.storeVariantId,
      causalConflict: true,
    },
    select: { id: true },
  });

  const remoteRead = await readRemoteListingObservation({
    connectionId: connection.id,
    productId: listing.shopifyProductId,
    variantId: variantMap.shopifyVariantId,
    inventoryItemId: variantMap.shopifyInventoryItemId,
    locationId: connection.primaryLocationId,
    fetchImpl: opts?.fetchImpl,
    now: opts?.now,
  });
  if (!remoteRead.ok) {
    return {
      outcome: remoteRead.outcome,
      errorClass: remoteRead.errorClass,
      errorCode: remoteRead.errorCode,
      errorMessage: remoteRead.errorMessage,
    };
  }

  const health = classifyShopifyListingHealth({
    connectionStatus: connection.status,
    primaryLocationId: connection.primaryLocationId,
    listing,
    variantMap,
    hasCausalSaleConflict: Boolean(causalConflict),
    remote: remoteRead.remote,
  });

  const persisted = await persistShopifyListingHealth(prisma, {
    listingLinkId: listing.id,
    health,
    previous: listing,
    now: opts?.now,
  });

  // Idempotently ensure missing outbound work for EXISTING desired versions only (no version bump).
  if (
    !health.blockContentOutbound &&
    (listing.desiredProductContentVersion > listing.appliedProductContentVersion ||
      variantMap.desiredVariantContentVersion > variantMap.appliedVariantContentVersion)
  ) {
    await ensureShopifyUpdateListingContentJob(prisma, {
      connectionId: connection.id,
      storeItemId: listing.storeItemId,
      storeVariantId: variantMap.storeVariantId,
      productDesiredVersion: listing.desiredProductContentVersion,
      variantDesiredVersion: variantMap.desiredVariantContentVersion,
    });
  }
  if (
    !health.blockInventoryOutbound &&
    variantMap.inventoryInitState !== "NOT_APPLICABLE" &&
    variantMap.inventoryDesiredVersion > variantMap.inventoryAppliedVersion
  ) {
    await ensureShopifyProjectInventoryJob(prisma, {
      connectionId: connection.id,
      storeItemId: listing.storeItemId,
      storeVariantId: variantMap.storeVariantId,
      inventoryDesiredVersion: variantMap.inventoryDesiredVersion,
    });
  }

  if ((opts?.notify ?? true) && persisted.issueOpened && health.issueCode && health.issueFingerprint) {
    await notifyShopifyListingIssueOnce({
      memberId: listing.memberId,
      storeItemId: listing.storeItemId,
      connectionId: connection.id,
      listingLinkId: listing.id,
      issueCode: health.issueCode,
      issueFingerprint: health.issueFingerprint,
      severity: health.issueSeverity ?? "ACTION_REQUIRED",
      message: health.issueMessage ?? "Shopify listing needs attention",
    });
  }

  return { outcome: "SUCCESS" };
}
