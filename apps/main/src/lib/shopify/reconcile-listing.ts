import {
  applyShopifyMediaInbound,
  applyShopifyVariantMediaInbound,
  ensureShopifyProjectInventoryJob,
  ensureShopifyUpdateListingContentJob,
  persistShopifyListingHealth,
  classifyShopifyListingHealth,
  ensureShopifyPublishListingJob,
  prisma,
  requeueShopifyContentForUnpushedMedia,
  shopifyProductContentFingerprint,
  shopifyVariantContentFingerprint,
  shopifyCentsFromMoneyString,
} from "database";
import type { ShopifyJobHandlerResult, ShopifySyncJobClaim } from "database";
import type { ShopifyListingRemoteObservation } from "database";
import type { ShopifyFetch } from "./admin-graphql";
import { executeShopifyAdminGraphql } from "./admin-graphql";
import { notifyShopifyListingIssueOnce } from "./listing-issue-notify";
import { syncShopifyListingTopology } from "./sync-listing-topology";
import { readRemoteProductForInbound } from "./process-products-update";

function parseReconcilePayload(
  payload: unknown
): { listingLinkId: string; storeItemId: string; pushTopology: boolean } | null {
  if (!payload || typeof payload !== "object") return null;
  const row = payload as Record<string, unknown>;
  const listingLinkId = typeof row.listingLinkId === "string" ? row.listingLinkId : "";
  const storeItemId = typeof row.storeItemId === "string" ? row.storeItemId : "";
  if (!listingLinkId || !storeItemId) return null;
  return {
    listingLinkId,
    storeItemId,
    pushTopology: row.pushTopology === true,
  };
}

async function readRemoteListingObservation(input: {
  connectionId: string;
  productId: string;
  variantId: string;
  /** Every mapped ProductVariant GID. Health pauses only when none of these remain. */
  mappedVariantIds?: string[];
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
        variants(first: 100) {
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
  const mappedIds = input.mappedVariantIds?.length
    ? input.mappedVariantIds
    : [input.variantId];
  const presentNodes = nodes.filter((row) => mappedIds.includes(row.id));
  const observingPreferred = presentNodes.some((row) => row.id === input.variantId);
  const mapped =
    presentNodes.find((row) => row.id === input.variantId) ?? presentNodes[0] ?? null;
  const inv = result.data?.inventoryItem ?? null;
  const available =
    inv?.inventoryLevel?.quantities?.find((row) => row.name === "available")?.quantity ?? null;

  return {
    ok: true,
    remote: {
      productExists: Boolean(product),
      productStatus: product?.status ?? null,
      variantCount: nodes.length,
      mappedVariantPresent: presentNodes.length > 0,
      presentMappedVariantCount: presentNodes.length,
      inventoryItemMatches: observingPreferred
        ? Boolean(
            mapped?.inventoryItem?.id === input.inventoryItemId ||
              inv?.id === input.inventoryItemId
          )
        : Boolean(mapped?.inventoryItem?.id),
      inventoryTracked: observingPreferred
        ? inv?.tracked ?? mapped?.inventoryItem?.tracked ?? null
        : mapped?.inventoryItem?.tracked ?? null,
      inventoryLevelExists:
        observingPreferred && input.locationId ? Boolean(inv?.inventoryLevel) : null,
      remoteAvailable:
        observingPreferred && typeof available === "number" ? available : null,
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
  const fieldConflictRows = await prisma.shopifyListingFieldState.findMany({
    where: { shopifyListingLinkId: listing.id, conflict: true },
    select: { fieldKey: true },
  });
  const fieldConflictKeys = fieldConflictRows.map((row) => row.fieldKey);
  if (variantMaps.length === 0) {
    const health = classifyShopifyListingHealth({
      connectionStatus: connection.status,
      primaryLocationId: connection.primaryLocationId,
      listing,
      variantMap: {
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
      fieldConflictKeys,
      remote: {
        productExists: true,
        productStatus: listing.remoteProductStatus,
        variantCount: 0,
        mappedVariantPresent: false,
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

  // Topology recover: add/import/rename/reorder before health snapshot.
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
    pushTopology: parsed.pushTopology,
    fetchImpl: opts?.fetchImpl,
    now: opts?.now,
  });
  if (!topologySync.ok) {
    return {
      outcome: topologySync.outcome,
      errorClass: topologySync.errorClass,
      errorCode: topologySync.errorCode,
      errorMessage: topologySync.errorMessage,
    };
  }
  // Topology CONFLICT already wrote ACTION_REQUIRED on the listing. Do not continue
  // into classifyShopifyListingHealth — that path does not know TOPOLOGY_* codes and
  // would wipe the pause (false READY_TO_PUBLISH).
  if (topologySync.plan.kind === "CONFLICT") {
    return { outcome: "SUCCESS" };
  }

  const refreshedMaps = await prisma.shopifyVariantMap.findMany({
    where: { shopifyListingLinkId: listing.id, shopifyConnectionId: connection.id },
    orderBy: { createdAt: "asc" },
  });
  const variantMap = refreshedMaps[0] ?? variantMaps[0];

  // Recover product media + Variant↔Media associations after topology maps exist.
  // Order: product media ingest first, then exact GID associations (Parts 12 / 16).
  const mediaRead = await readRemoteProductForInbound({
    connectionId: connection.id,
    productId: listing.shopifyProductId,
    fetchImpl: opts?.fetchImpl,
    now: opts?.now,
  });
  if (mediaRead.ok) {
    await prisma.$transaction(async (tx) => {
      await applyShopifyMediaInbound(tx, {
        evidenceId: `reconcile-media:${listing.id}`,
        connectionId: connection.id,
        listingLinkId: listing.id,
        memberId: listing.memberId,
        storeItemId: listing.storeItemId,
        remoteMedia: mediaRead.product.media,
      });
      await applyShopifyVariantMediaInbound(tx, {
        connectionId: connection.id,
        listingLinkId: listing.id,
        memberId: listing.memberId,
        storeItemId: listing.storeItemId,
        evidenceId: `reconcile-variant-media:${listing.id}`,
        mappedVariants: refreshedMaps.map((map) => ({
          shopifyVariantId: map.shopifyVariantId,
          storeVariantId: map.storeVariantId,
        })),
        remoteVariantMedia: mediaRead.product.variants.map((row) => ({
          shopifyVariantId: row.id,
          shopifyMediaIds: row.mediaIds,
        })),
      });
    });
  }

  // Re-read field conflicts after media / variant-media apply so NEEDS_ATTENTION is current.
  const fieldConflictRowsAfterMedia = await prisma.shopifyListingFieldState.findMany({
    where: { shopifyListingLinkId: listing.id, conflict: true },
    select: { fieldKey: true },
  });
  const fieldConflictKeysAfterMedia = fieldConflictRowsAfterMedia.map((row) => row.fieldKey);

  const causalConflict = await prisma.shopifyOrderLineSaleFact.findFirst({
    where: {
      shopifyConnectionId: connection.id,
      storeVariantId: { in: refreshedMaps.map((m) => m.storeVariantId) },
      causalConflict: true,
    },
    select: { id: true },
  });

  const remoteRead = await readRemoteListingObservation({
    connectionId: connection.id,
    productId: listing.shopifyProductId,
    variantId: variantMap.shopifyVariantId,
    mappedVariantIds: refreshedMaps.map((row) => row.shopifyVariantId),
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
    variantMaps: refreshedMaps,
    hasCausalSaleConflict: Boolean(causalConflict),
    fieldConflictKeys: fieldConflictKeysAfterMedia,
    remote: {
      ...remoteRead.remote,
      mappedVariantCount: refreshedMaps.length,
      mappedVariantPresent: remoteRead.remote.mappedVariantPresent,
    },
  });

  const persisted = await persistShopifyListingHealth(prisma, {
    listingLinkId: listing.id,
    health,
    previous: listing,
    now: opts?.now,
  });

  // Idempotently ensure missing outbound work for EXISTING desired versions only (no version bump).
  // Recover every mapped variant — not just the first — so sibling qty/price lag is not stranded.
  for (const map of refreshedMaps) {
    if (
      !health.blockContentOutbound &&
      (listing.desiredProductContentVersion > listing.appliedProductContentVersion ||
        map.desiredVariantContentVersion > map.appliedVariantContentVersion)
    ) {
      await ensureShopifyUpdateListingContentJob(prisma, {
        connectionId: connection.id,
        storeItemId: listing.storeItemId,
        storeVariantId: map.storeVariantId,
        productDesiredVersion: listing.desiredProductContentVersion,
        variantDesiredVersion: map.desiredVariantContentVersion,
      });
    }
    if (
      !health.blockInventoryOutbound &&
      map.inventoryInitState !== "NOT_APPLICABLE" &&
      map.inventoryDesiredVersion > map.inventoryAppliedVersion
    ) {
      await ensureShopifyProjectInventoryJob(prisma, {
        connectionId: connection.id,
        storeItemId: listing.storeItemId,
        storeVariantId: map.storeVariantId,
        inventoryDesiredVersion: map.inventoryDesiredVersion,
      });
    }
  }

  // Photos that never landed on Shopify leave ACTIVE maps without a GID. Content
  // versions can look converged while productCreateMedia still needs a retry.
  if (!health.blockContentOutbound) {
    await requeueShopifyContentForUnpushedMedia(prisma, {
      connectionId: connection.id,
      listingLinkId: listing.id,
      storeItemId: listing.storeItemId,
      memberId: connection.memberId,
    });
  }

  if (
    remoteRead.remote.productStatus?.toUpperCase() === "DRAFT" &&
    health.readiness !== "ACTION_REQUIRED"
  ) {
    const item = await prisma.storeItem.findFirst({
      where: { id: listing.storeItemId, memberId: connection.memberId },
      select: { status: true },
    });
    if (item && item.status !== "inactive" && item.status !== "ended") {
      await ensureShopifyPublishListingJob(prisma, {
        connectionId: connection.id,
        storeItemId: listing.storeItemId,
        listingLinkId: listing.id,
      });
    }
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
