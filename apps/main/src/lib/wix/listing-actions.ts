import {
  captureWixInventoryProjectionDesire,
  deleteWixListingMapping,
  enqueueWixSyncJob,
  WixSyncJobConflictError,
  ensureWixProjectInventoryJob,
  ensureWixUpdateListingContentJob,
  hasUnprojectedWixInventoryDesires,
  lookupWixListingByStoreItem,
  lookupWixVariantByStoreVariant,
  prisma,
  recordWixDirtyMappedVariantContentDesires,
  recordWixListingContentDesire,
  recordWixListingVariantTopologyDesire,
  recordWixMappedListingContentDesire,
  getActiveWixConnectionForMember,
  trackedAvailable,
  wixTopologyFingerprint,
  type WixPublicConnection,
} from "database";
import { readWixAppConfig } from "./config";
import { accessTokenForWixConnection } from "./connect";
import { fetchWixSiteInfo, wixApplicationRequest, type WixFetch } from "./client";
import { WIX_CATALOG_V1, WIX_V1_PRODUCT_GET, WIX_V3_PRODUCTS } from "./constants";
import { wixProductDashboardUrl, wixStorefrontProductUrl } from "./apps-airport";
import { wixPublicPhotoUrls } from "./listing-media";

export type WixListingActionResult =
  | { success: true; listingLinkId?: string; enqueued?: boolean }
  | { success: false; error: string; status?: number };

/**
 * After a store item's content changes, enqueue a job to push updates to Wix.
 */
export async function scheduleWixContentUpdate(input: {
  storeItemId: string;
  memberId: string;
}): Promise<void> {
  // Get active connection for member
  const connection = await getActiveWixConnectionForMember(prisma, input.memberId);
  if (!connection) {
    return; // No active connection
  }

  const mapping = await lookupWixListingByStoreItem(
    prisma,
    connection.id,
    input.storeItemId
  );

  if (!mapping || mapping.listingLink.readiness === "CONNECTION_REQUIRED") {
    return; // Not linked or connection inactive
  }

  // Record content desire (bumps desired version)
  await recordWixListingContentDesire(prisma, {
    listingLinkId: mapping.listingLink.id,
    productFingerprint: null, // Will be computed during push
    triggeredBy: "CONTENT_UPDATE",
  });

  // Enqueue update job (resurrects SUCCEEDED jobs on re-assert)
  await enqueueWixSyncJob(prisma, {
    wixConnectionId: mapping.listingLink.wixConnectionId,
    kind: "UPDATE_LISTING_CONTENT",
    dedupeKey: `UPDATE_LISTING_CONTENT:${mapping.listingLink.id}`,
    payload: {
      listingLinkId: mapping.listingLink.id,
    },
    nextAttemptAt: new Date(),
  });
}

/**
 * After inventory changes, enqueue a job to push quantities to Wix.
 */
export async function scheduleWixInventoryProjection(input: {
  storeVariantId: string;
  memberId: string;
  available: number;
}): Promise<void> {
  // Get active connection for member
  const connection = await getActiveWixConnectionForMember(prisma, input.memberId);
  if (!connection) {
    return;
  }

  const variantMap = await lookupWixVariantByStoreVariant(
    prisma,
    connection.id,
    input.storeVariantId
  );

  if (!variantMap) {
    return;
  }

  // Look up the listing link
  const listingLink = await prisma.wixListingLink.findUnique({
    where: { id: variantMap.wixListingLinkId },
  });

  if (!listingLink || listingLink.readiness === "CONNECTION_REQUIRED") {
    return;
  }

  // Capture inventory desire (records what we want to push)
  await captureWixInventoryProjectionDesire(prisma, {
    variantMapId: variantMap.id,
    wixConnectionId: connection.id,
    listingLinkId: listingLink.id,
    desiredAvailable: input.available,
  });

  // Ensure inventory projection job exists
  await ensureWixProjectInventoryJob(prisma, {
    listingLinkId: listingLink.id,
    wixConnectionId: connection.id,
  });
}

/**
 * Queue whatever this linked listing has not finished sending to Wix:
 * photos and title, option shape, combo prices, and quantities.
 */
export async function requeueUnappliedWixListing(input: {
  memberId: string;
  storeItemId: string;
  connectionId: string;
  listingLinkId: string;
}): Promise<boolean> {
  const link = await prisma.wixListingLink.findUnique({
    where: { id: input.listingLinkId },
    include: { variantMaps: true },
  });
  if (!link) return false;

  let enqueued = false;
  const item = await prisma.storeItem.findUnique({
    where: { id: input.storeItemId },
    select: {
      title: true,
      description: true,
      priceCents: true,
      sku: true,
      photos: true,
      storeVariants: {
        where: { status: "ACTIVE" },
        select: { id: true, options: true, inventoryState: true },
      },
    },
  });

  const photos = wixPublicPhotoUrls(item?.photos);
  const contentPending = link.desiredProductContentVersion > link.appliedProductContentVersion;
  if (item && photos.length > 0 && !contentPending) {
    const recorded = await recordWixMappedListingContentDesire(prisma, {
      memberId: input.memberId,
      storeItemId: input.storeItemId,
      before: {
        title: item.title,
        description: item.description,
        priceCents: item.priceCents,
        sku: item.sku,
        photos: [],
      },
      after: {
        title: item.title,
        description: item.description,
        priceCents: item.priceCents,
        sku: item.sku,
        photos,
      },
    });
    if (recorded.status === "RECORDED") enqueued = true;
  } else if (contentPending) {
    const job = await ensureWixUpdateListingContentJob(prisma, {
      listingLinkId: link.id,
      wixConnectionId: input.connectionId,
    });
    if (job.enqueued) enqueued = true;
  }

  const prices = await recordWixDirtyMappedVariantContentDesires(prisma, {
    memberId: input.memberId,
    storeItemId: input.storeItemId,
  });
  if (prices.status === "RECORDED") enqueued = true;

  const activeVariants = item?.storeVariants ?? [];
  const topologyNow = wixTopologyFingerprint(activeVariants);
  const topologyPending =
    (link.topologyDesiredFingerprint != null &&
      link.topologyDesiredFingerprint !== link.topologyAppliedFingerprint) ||
    topologyNow !== link.topologyAppliedFingerprint;
  if (topologyPending) {
    const recorded = await recordWixListingVariantTopologyDesire(prisma, {
      memberId: input.memberId,
      storeItemId: input.storeItemId,
    });
    if (recorded.status === "RECORDED") enqueued = true;
  }

  const inventoryByVariant = new Map(
    activeVariants.map((variant) => [variant.id, variant.inventoryState] as const)
  );
  for (const map of link.variantMaps) {
    if (map.inventoryDesiredVersion > map.inventoryAppliedVersion) continue;
    const state = inventoryByVariant.get(map.storeVariantId);
    if (!state || state.mode !== "TRACKED_FINITE" || state.onHand == null || state.reserved == null) {
      continue;
    }
    let sellable = 0;
    try {
      sellable = trackedAvailable(state.onHand, state.reserved);
    } catch {
      continue;
    }
    if (sellable <= 0) continue;
    if (map.inventoryAppliedAvailable === sellable && map.inventoryAppliedVersion > 0) continue;
    await captureWixInventoryProjectionDesire(prisma, {
      variantMapId: map.id,
      wixConnectionId: input.connectionId,
      listingLinkId: link.id,
      desiredAvailable: sellable,
    });
    enqueued = true;
  }
  if (await hasUnprojectedWixInventoryDesires(prisma, link.id)) {
    try {
      await ensureWixProjectInventoryJob(prisma, {
        wixConnectionId: input.connectionId,
        listingLinkId: link.id,
      });
      enqueued = true;
    } catch (error) {
      if (!(error instanceof WixSyncJobConflictError)) throw error;
    }
  }

  return enqueued;
}

/**
 * Create a new listing on Wix from an existing INW store item.
 */
export async function createWixListing(input: {
  storeItemId: string;
  memberId: string;
  connection: WixPublicConnection;
}): Promise<WixListingActionResult> {
  const config = readWixAppConfig();
  if (!config) {
    return { success: false, error: "Wix is not configured", status: 500 };
  }

  // Check if already linked
  const existing = await lookupWixListingByStoreItem(
    prisma,
    input.connection.id,
    input.storeItemId
  );

  if (existing) {
    const enqueued = await requeueUnappliedWixListing({
      memberId: input.memberId,
      storeItemId: input.storeItemId,
      connectionId: input.connection.id,
      listingLinkId: existing.listingLink.id,
    });
    return { success: true, listingLinkId: existing.listingLink.id, enqueued };
  }

  // Enqueue create listing job
  const dedupeKey = `create-listing-${input.connection.id}-${input.storeItemId}`;
  
  await enqueueWixSyncJob(prisma, {
    wixConnectionId: input.connection.id,
    kind: "CREATE_LISTING",
    dedupeKey,
    payload: {
      storeItemId: input.storeItemId,
      memberId: input.memberId,
    },
    nextAttemptAt: new Date(),
  });

  return { success: true, enqueued: true };
}

/**
 * Load mapping status for a store item on Wix.
 */
export async function loadMappedWixListing(input: {
  storeItemId: string;
  memberId: string;
}): Promise<
  | {
      linked: true;
      link: {
        id: string;
        wixProductId: string;
        readiness: string;
        contentHealth: string;
        inventoryHealth: string;
        issueCode: string | null;
        issueMessage: string | null;
        remoteProductVisible: boolean | null;
      };
    }
  | { linked: false }
  | { error: string; status: number }
> {
  try {
    // Get active connection for member
    const connection = await getActiveWixConnectionForMember(prisma, input.memberId);
    if (!connection) {
      return { linked: false };
    }

    const mapping = await lookupWixListingByStoreItem(
      prisma,
      connection.id,
      input.storeItemId
    );

    if (!mapping) {
      return { linked: false };
    }

    return {
      linked: true,
      link: {
        id: mapping.listingLink.id,
        wixProductId: mapping.listingLink.wixProductId,
        readiness: mapping.listingLink.readiness,
        contentHealth: mapping.listingLink.contentHealth,
        inventoryHealth: mapping.listingLink.inventoryHealth,
        issueCode: mapping.listingLink.issueCode,
        issueMessage: mapping.listingLink.issueMessage,
        remoteProductVisible: mapping.listingLink.remoteProductVisible,
      },
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unknown error",
      status: 500,
    };
  }
}

/**
 * Check if a store item has pending inventory projections to Wix.
 */
export async function hasWixPendingProjections(input: {
  storeItemId: string;
  memberId: string;
}): Promise<boolean> {
  // Get active connection for member
  const connection = await getActiveWixConnectionForMember(prisma, input.memberId);
  if (!connection) {
    return false;
  }

  const mapping = await lookupWixListingByStoreItem(
    prisma,
    connection.id,
    input.storeItemId
  );

  if (!mapping) {
    return false;
  }

  return hasUnprojectedWixInventoryDesires(prisma, mapping.listingLink.id);
}

/**
 * Trigger manual reconciliation of a Wix listing.
 */
export async function reconcileWixListing(input: {
  listingLinkId: string;
}): Promise<{ enqueued: boolean }> {
  const link = await prisma.wixListingLink.findUnique({
    where: { id: input.listingLinkId },
    include: { connection: true },
  });

  if (!link || link.connection.status !== "ACTIVE") {
    return { enqueued: false };
  }

  const topologyPending =
    link.topologyDesiredFingerprint != null &&
    link.topologyDesiredFingerprint !== link.topologyAppliedFingerprint;

  try {
    await enqueueWixSyncJob(prisma, {
      wixConnectionId: link.wixConnectionId,
      kind: "RECONCILE_LISTING",
      dedupeKey: `RECONCILE_LISTING:${link.id}:topo-push`,
      payload: { listingLinkId: link.id, pushTopology: true },
      nextAttemptAt: new Date(),
    });
  } catch (error) {
    if (!(error instanceof WixSyncJobConflictError)) throw error;
  }
  if (!topologyPending) {
    try {
      await enqueueWixSyncJob(prisma, {
        wixConnectionId: link.wixConnectionId,
        kind: "POLL_LISTING_CONTENT",
        dedupeKey: `POLL_LISTING_CONTENT:${link.id}`,
        payload: { listingLinkId: link.id },
        nextAttemptAt: new Date(),
      });
    } catch (error) {
      if (!(error instanceof WixSyncJobConflictError)) throw error;
    }
  }

  return { enqueued: true };
}

/**
 * Delete the remote Wix product and the local mapping.
 * Disconnecting the shop does not call this.
 */
export async function removeWixListing(input: {
  listingLinkId: string;
  memberId: string;
}): Promise<WixListingActionResult> {
  const config = readWixAppConfig();
  if (!config) {
    return { success: false, error: "Wix is not configured", status: 500 };
  }

  const link = await prisma.wixListingLink.findUnique({
    where: { id: input.listingLinkId },
    include: { connection: true },
  });
  if (!link || link.memberId !== input.memberId) {
    return { success: false, error: "Listing link not found", status: 404 };
  }
  if (link.connection.status !== "ACTIVE") {
    return { success: false, error: "Wix connection is not active", status: 409 };
  }

  const accessToken = await accessTokenForWixConnection({ instanceId: link.connection.instanceId });
  const isV1 = link.connection.catalogVersion === WIX_CATALOG_V1;
  const result = await wixApplicationRequest({
    method: "DELETE",
    path: `${isV1 ? WIX_V1_PRODUCT_GET : WIX_V3_PRODUCTS}/${link.wixProductId}`,
    deps: { config, accessToken, maxAttempts: 1 },
  });
  if (!result.ok && result.class !== "NOT_FOUND") {
    return { success: false, error: "Could not remove the Wix product", status: 502 };
  }

  await deleteWixListingMapping(prisma, link.id);
  return { success: true, listingLinkId: link.id };
}

function absoluteHttpUrl(value: string | null | undefined): string | null {
  const trimmed = String(value ?? "").trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : null;
}

function joinSiteBaseAndPath(
  base: string | null | undefined,
  path: string | null | undefined
): string | null {
  const site = String(base ?? "").trim().replace(/\/+$/, "");
  const relative = String(path ?? "").trim();
  if (!/^https?:\/\//i.test(site) || !relative) return null;
  return `${site}${relative.startsWith("/") ? relative : `/${relative}`}`;
}

/**
 * Resolve the best public storefront URL for a mapped Wix listing.
 * Prefers Catalog V3 `fields=URL` / V1 `productPageUrl`, then siteUrl+slug, then dashboard.
 */
export async function getWixListingViewUrl(input: {
  memberId: string;
  storeItemId: string;
  fetchImpl?: WixFetch;
}): Promise<
  | {
      ok: true;
      primaryUrl: string | null;
      adminUrl: string | null;
      storefrontUrl: string | null;
    }
  | { ok: false; status: number; error: string }
> {
  const connection = await getActiveWixConnectionForMember(prisma, input.memberId);
  if (!connection) {
    return { ok: false, status: 404, error: "Wix is not connected" };
  }

  const mapping = await lookupWixListingByStoreItem(
    prisma,
    connection.id,
    input.storeItemId
  );
  if (!mapping) {
    return { ok: false, status: 404, error: "Listing is not linked to Wix" };
  }

  const adminUrl = wixProductDashboardUrl(
    connection.siteId,
    mapping.listingLink.wixProductId
  );

  const config = readWixAppConfig();
  if (!config) {
    return { ok: true, primaryUrl: adminUrl, adminUrl, storefrontUrl: null };
  }

  let accessToken: string;
  try {
    accessToken = await accessTokenForWixConnection(
      { instanceId: connection.instanceId },
      { config, fetchImpl: input.fetchImpl }
    );
  } catch {
    return { ok: true, primaryUrl: adminUrl, adminUrl, storefrontUrl: null };
  }

  let storefrontUrl: string | null = null;
  const isV1 = connection.catalogVersion === WIX_CATALOG_V1;

  const resolveFromSlug = async (slug: string | null | undefined) => {
    if (!slug?.trim()) return null;
    try {
      const siteInfo = await fetchWixSiteInfo({
        accessToken,
        config,
        fetchImpl: input.fetchImpl,
      });
      return wixStorefrontProductUrl(siteInfo.siteUrl, slug);
    } catch {
      return null;
    }
  };

  if (isV1) {
    const result = await wixApplicationRequest<{
      product?: {
        slug?: string;
        productPageUrl?: { base?: string; path?: string };
      };
    }>({
      method: "GET",
      path: `${WIX_V1_PRODUCT_GET}/${mapping.listingLink.wixProductId}`,
      deps: { config, accessToken, fetchImpl: input.fetchImpl, maxAttempts: 2 },
    });
    if (result.ok && result.data?.product) {
      storefrontUrl = joinSiteBaseAndPath(
        result.data.product.productPageUrl?.base,
        result.data.product.productPageUrl?.path
      );
      if (!storefrontUrl) {
        storefrontUrl = await resolveFromSlug(result.data.product.slug);
      }
    }
  } else {
    const result = await wixApplicationRequest<{
      product?: {
        slug?: string;
        url?: { url?: string; relativePath?: string };
      };
    }>({
      method: "GET",
      path: `${WIX_V3_PRODUCTS}/${mapping.listingLink.wixProductId}`,
      query: { fields: "URL" },
      deps: { config, accessToken, fetchImpl: input.fetchImpl, maxAttempts: 2 },
    });
    if (result.ok && result.data?.product) {
      storefrontUrl = absoluteHttpUrl(result.data.product.url?.url);
      if (!storefrontUrl && result.data.product.url?.relativePath) {
        try {
          const siteInfo = await fetchWixSiteInfo({
            accessToken,
            config,
            fetchImpl: input.fetchImpl,
          });
          storefrontUrl = joinSiteBaseAndPath(
            siteInfo.siteUrl,
            result.data.product.url.relativePath
          );
        } catch {
          /* ignore */
        }
      }
      if (!storefrontUrl) {
        storefrontUrl = await resolveFromSlug(result.data.product.slug);
      }
    }
  }

  return {
    ok: true,
    primaryUrl: storefrontUrl || adminUrl,
    adminUrl,
    storefrontUrl,
  };
}
